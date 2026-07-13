import { describe, expect, it } from "vitest";
import type { WorkflowSpec } from "@untilgreen/schema";
import { runWorkflow, type EngineDeps } from "../src/engine.js";
import { FakeAdapter, FakeWorkspaceProvider, type ScriptedResult } from "../src/fake-adapter.js";
import { RunStore } from "../src/store.js";
import { UnsupportedConstraintError } from "../src/adapter.js";

/** Gates run for real via /bin/sh; scripted gates use tiny shell one-liners
 * driven by a counter file so the SAME step can fail then pass. */

function wf(over: Partial<WorkflowSpec>): WorkflowSpec {
  return {
    version: 1,
    name: "t",
    defaults: { agent: "fake" },
    env_allowlist: ["PATH"],
    steps: [{ id: "a", prompt: "do it", gate: { run: "true" }, on_pass: "success" }],
    ...over,
  };
}

function makeDeps(adapter: FakeAdapter, over: Partial<EngineDeps> = {}): EngineDeps & { store: RunStore } {
  return {
    adapters: new Map([[adapter.info.id, adapter]]),
    store: new RunStore(":memory:"),
    workspace: new FakeWorkspaceProvider(["+ change 1", "+ change 2", "+ change 3", "+ change 4"]),
    parentEnv: { PATH: process.env.PATH },
    ...over,
  };
}

/** shell gate that fails until the Nth call: uses a temp counter file.
 * POSIX-sh only (Ubuntu /bin/sh is dash — no $RANDOM, no bashisms). */
function failUntil(n: number): string {
  const file = `/tmp/untilgreen-test-${Math.random().toString(36).slice(2)}`;
  return `c=$(cat ${file} 2>/dev/null || echo 0); c=$((c+1)); echo $c > ${file}; echo "attempt $c failed"; [ $c -ge ${n} ]`;
}

/** shell gate that always fails but with DISTINCT output each attempt, so
 * only the budget/iteration limit under test can end the run — never the
 * identical-failures doom-loop brake. */
function alwaysFailDistinct(): string {
  return failUntil(Number.MAX_SAFE_INTEGER);
}

describe("routing state machine", () => {
  it("succeeds when the gate passes first try", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter);
    const result = await runWorkflow(wf({}), {}, deps);
    expect(result.status).toBe("succeeded");
    expect(result.totalIterations).toBe(1);
    expect(deps.store.getRun(result.runId)?.status).toBe("succeeded");
  });

  it("money demo: agent claims success, gate rejects, loop until green", async () => {
    const adapter = new FakeAdapter([{ agentClaimedSuccess: true }]);
    const deps = makeDeps(adapter);
    const result = await runWorkflow(
      wf({
        steps: [
          {
            id: "fix",
            prompt: "fix it. previous failure: <<{{ gate.output }}>> iter {{ iteration }}",
            gate: { run: failUntil(3) },
            on_pass: "success",
            on_fail: "retry",
            max_iterations: 5,
          },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("succeeded");
    expect(result.totalIterations).toBe(3);
    // invariant 1: agentClaimedSuccess=true never routed on — gate decided
    // invariant 2/3: retry context flowed only through {{ gate.output }}
    expect(adapter.requests[0]!.prompt).toContain("<<>>");
    expect(adapter.requests[1]!.prompt).toContain("attempt 1 failed");
    expect(adapter.requests[2]!.prompt).toContain("attempt 2 failed");
    const timeline = deps.store.getTimeline(result.runId);
    expect(timeline.map((t) => t.gatePass)).toEqual([false, false, true]);
    expect(timeline.every((t) => t.agentClaimedSuccess === true)).toBe(true);
  });

  it("fails with failed:max_iterations when retries exhaust", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter, {
      workspace: new FakeWorkspaceProvider(["+ a", "+ b", "+ c", "+ d", "+ e"]),
    });
    const result = await runWorkflow(
      wf({
        steps: [
          {
            id: "a",
            prompt: "x {{ iteration }}",
            gate: { run: alwaysFailDistinct() },
            on_fail: "retry",
            max_iterations: 2,
          },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("failed:max_iterations");
    expect(result.totalIterations).toBe(2);
  });

  it("on_fail: fail terminates immediately", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter);
    const result = await runWorkflow(
      wf({ steps: [{ id: "a", prompt: "x", gate: { run: "false" }, on_fail: "fail" }] }),
      {},
      deps,
    );
    expect(result.status).toBe("failed:on_fail");
    expect(result.totalIterations).toBe(1);
  });

  it("on_pass: next walks the pipeline; next at the last step succeeds", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter);
    const result = await runWorkflow(
      wf({
        steps: [
          { id: "a", prompt: "1", gate: { run: "true" }, on_pass: "next" },
          { id: "b", prompt: "2", gate: { run: "true" }, on_pass: "next" },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("succeeded");
    expect(deps.store.getTimeline(result.runId).map((t) => t.stepId)).toEqual(["a", "b"]);
  });

  it("goto routes on pass and on fail, and cross-step gate output renders", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter, {
      workspace: new FakeWorkspaceProvider(["+ 1", "+ 2", "+ 3", "+ 4", "+ 5"]),
    });
    const result = await runWorkflow(
      wf({
        steps: [
          {
            id: "implement",
            prompt: "impl. review said: [{{ steps.review.gate.output }}]",
            gate: { run: "true" },
            on_pass: "goto:review",
            max_iterations: 5,
          },
          {
            id: "review",
            prompt: "review",
            gate: { run: failUntil(2) },
            on_pass: "success",
            on_fail: "goto:implement",
            max_iterations: 5,
          },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("succeeded");
    // implement → review(fail) → implement → review(pass)
    expect(deps.store.getTimeline(result.runId).map((t) => t.stepId)).toEqual([
      "implement",
      "review",
      "implement",
      "review",
    ]);
    // second implement render saw review's failing output
    expect(adapter.requests[2]!.prompt).toContain("attempt 1 failed");
    // goto does NOT reset the target's iteration counter
    expect(deps.store.getTimeline(result.runId)[2]!.iteration).toBe(2);
  });

  it("aborts on max_usd (engine-side metering, invariant 7)", async () => {
    const adapter = new FakeAdapter([{ costUsd: 3 }]);
    const deps = makeDeps(adapter, {
      workspace: new FakeWorkspaceProvider(["+ a", "+ b", "+ c"]),
    });
    const result = await runWorkflow(
      wf({
        budget: { max_usd: 5 },
        steps: [
          { id: "a", prompt: "x {{ iteration }}", gate: { run: alwaysFailDistinct() }, max_iterations: 10 },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("aborted:budget_usd");
    expect(result.totalUsd).toBeCloseTo(6);
  });

  it("aborts on max_iterations_total across steps", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter, {
      workspace: new FakeWorkspaceProvider(["+ a", "+ b", "+ c", "+ d"]),
    });
    const result = await runWorkflow(
      wf({
        budget: { max_iterations_total: 3 },
        steps: [
          {
            id: "a",
            prompt: "x {{ iteration }}",
            gate: { run: alwaysFailDistinct() },
            on_fail: "retry",
            max_iterations: 99,
          },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("aborted:budget_iterations");
  });

  it("aborts on wall-clock timeout with injectable clock", async () => {
    let t = 0;
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter, {
      now: () => {
        t += 10 * 60_000; // each clock read advances 10 minutes
        return t;
      },
    });
    const result = await runWorkflow(
      wf({
        budget: { timeout_minutes: 5 },
        steps: [{ id: "a", prompt: "x", gate: { run: "true" }, on_pass: "success" }],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("aborted:timeout");
  });

  it("aborts on doom loop: identical gate failures", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter, {
      workspace: new FakeWorkspaceProvider(["+ a", "+ b", "+ c", "+ d"]),
    });
    const result = await runWorkflow(
      wf({
        steps: [
          { id: "a", prompt: "x {{ iteration }}", gate: { run: "echo same failure; false" }, max_iterations: 99 },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("aborted:doom_loop");
    expect(result.totalIterations).toBe(3); // default identical_gate_failures
  });

  it("aborts on doom loop: empty diffs (agent doing nothing)", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter, { workspace: new FakeWorkspaceProvider(["", ""]) });
    const result = await runWorkflow(
      wf({
        steps: [
          { id: "a", prompt: "x {{ iteration }}", gate: { run: alwaysFailDistinct() }, max_iterations: 99 },
        ],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("aborted:doom_loop");
    expect(result.totalIterations).toBe(2); // default empty_diffs
  });

  it("cancels via AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter, { signal: controller.signal });
    const result = await runWorkflow(wf({}), {}, deps);
    expect(result.status).toBe("canceled");
    expect(adapter.requests).toHaveLength(0);
  });

  it("ungated steps pass unconditionally", async () => {
    const adapter = new FakeAdapter();
    const deps = makeDeps(adapter);
    const result = await runWorkflow(
      wf({ steps: [{ id: "a", prompt: "x", on_pass: "success" }] }),
      {},
      deps,
    );
    expect(result.status).toBe("succeeded");
    expect(deps.store.getTimeline(result.runId)[0]!.gatePass).toBeNull();
  });

  it("UnsupportedConstraintError propagates before any invocation (invariant 5)", async () => {
    const adapter = new FakeAdapter([], { id: "fake-no-sandbox" });
    const deps = makeDeps(adapter);
    await expect(
      runWorkflow(
        wf({
          defaults: { agent: "fake-no-sandbox" },
          steps: [
            { id: "a", prompt: "x", constraints: { network: false }, gate: { run: "true" }, on_pass: "success" },
          ],
        }),
        {},
        deps,
      ),
    ).rejects.toThrow(UnsupportedConstraintError);
    expect(adapter.requests).toHaveLength(0);
  });

  it("throws on missing required input; applies defaults for optional ones", async () => {
    const adapter = new FakeAdapter();
    await expect(
      runWorkflow(wf({ inputs: { task: { required: true } } }), {}, makeDeps(adapter)),
    ).rejects.toThrow(/missing required input/);

    const deps = makeDeps(adapter);
    const result = await runWorkflow(
      wf({
        inputs: { tone: { default: "brief" } },
        steps: [{ id: "a", prompt: "be {{ inputs.tone }}", gate: { run: "true" }, on_pass: "success" }],
      }),
      {},
      deps,
    );
    expect(result.status).toBe("succeeded");
    expect(adapter.requests[0]!.prompt).toBe("be brief");
  });

  it("throws for unregistered adapters", async () => {
    const adapter = new FakeAdapter();
    await expect(
      runWorkflow(wf({ defaults: { agent: "ghost" } }), {}, makeDeps(adapter)),
    ).rejects.toThrow(/no adapter registered/);
  });

  it("passes only allowlisted env + adapter requiredEnv to the agent (never full env)", async () => {
    process.env.UNTILGREEN_SECRET = "leaked";
    process.env.UNTILGREEN_AUTH = "token";
    try {
      const adapter = new FakeAdapter([], { requiredEnv: ["UNTILGREEN_AUTH"] });
      const deps = makeDeps(adapter, {
        parentEnv: process.env as Record<string, string | undefined>,
      });
      await runWorkflow(wf({ env_allowlist: ["PATH"] }), {}, deps);
      const env = adapter.requests[0]!.env;
      expect(env.UNTILGREEN_AUTH).toBe("token");
      expect(env.UNTILGREEN_SECRET).toBeUndefined();
      expect(env.PATH).toBeDefined();
    } finally {
      delete process.env.UNTILGREEN_SECRET;
      delete process.env.UNTILGREEN_AUTH;
    }
  });

  it("marks runs with unknown cost (Cursor-style adapters, invariant 7 note)", async () => {
    const adapter = new FakeAdapter([{ costUsd: 0, costUnknown: true }]);
    const deps = makeDeps(adapter);
    const result = await runWorkflow(wf({}), {}, deps);
    expect(result.costUnknown).toBe(true);
    expect(deps.store.getRun(result.runId)?.costUnknown).toBe(true);
  });

  it("keeps the workspace on failure and removes it on success by default", async () => {
    const adapter = new FakeAdapter();
    const ok = new FakeWorkspaceProvider();
    await runWorkflow(wf({}), {}, makeDeps(adapter, { workspace: ok }));
    expect(ok.cleanups).toEqual([false]); // keep=false → removed

    const bad = new FakeWorkspaceProvider(["+ a", "+ b"]);
    await runWorkflow(
      wf({ steps: [{ id: "a", prompt: "x", gate: { run: "false" }, on_fail: "fail" }] }),
      {},
      makeDeps(adapter, { workspace: bad }),
    );
    expect(bad.cleanups).toEqual([true]); // keep=true → preserved for debugging
  });
});

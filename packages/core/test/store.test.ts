import { describe, expect, it } from "vitest";
import { RunStore } from "../src/store.js";

describe("SQLite run store (invariant 6: local-first)", () => {
  it("round-trips a run with a per-iteration timeline", () => {
    const store = new RunStore(":memory:");
    const runId = store.createRun("fix-tests", { task: "do it" }, 1000);

    store.recordIteration({
      runId,
      seq: 1,
      stepId: "fix",
      iteration: 1,
      agentId: "fake",
      prompt: "p1",
      agent: { outputText: "done!", costUsd: 0.5, costUnknown: false, agentClaimedSuccess: true },
      gate: { pass: false, exitCode: 1, output: "1 failing", timedOut: false },
      diff: "+ attempt 1",
      now: 1001,
    });
    store.recordIteration({
      runId,
      seq: 2,
      stepId: "fix",
      iteration: 2,
      agentId: "fake",
      prompt: "p2",
      agent: { outputText: "done again", costUsd: 0.7, costUnknown: false, agentClaimedSuccess: true },
      gate: { pass: true, exitCode: 0, output: "0 failing", timedOut: false },
      diff: "+ attempt 2",
      now: 1002,
    });
    store.finishRun(runId, "succeeded", { usd: 1.2, iterations: 2, costUnknown: false }, 1003);

    const run = store.getRun(runId)!;
    expect(run.status).toBe("succeeded");
    expect(run.totalUsd).toBeCloseTo(1.2);
    expect(run.inputs).toEqual({ task: "do it" });
    expect(run.finishedAt).toBe(1003);

    const timeline = store.getTimeline(runId);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.gatePass).toBe(false);
    expect(timeline[0]!.diff).toBe("+ attempt 1");
    expect(timeline[1]!.gatePass).toBe(true);
    expect(timeline[1]!.agentClaimedSuccess).toBe(true);

    expect(store.listRuns()[0]!.id).toBe(runId);
    store.close();
  });

  it("returns null for unknown runs", () => {
    const store = new RunStore(":memory:");
    expect(store.getRun("nope")).toBeNull();
    store.close();
  });
});

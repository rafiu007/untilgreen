import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProject, parseInputArgs, fixTestsTemplate } from "../src/helpers.js";
import { parseWorkflow } from "@untilgreen/schema";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(cwd: string, args: string[], expectFail = false): string {
  try {
    return execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (expectFail) return `${e.stdout ?? ""}${e.stderr ?? ""}`;
    throw new Error(`CLI failed (${e.status}): ${e.stdout}\n${e.stderr}`);
  }
}

describe("helpers", () => {
  it("parseInputArgs handles k=v with = in values", () => {
    expect(parseInputArgs(["task=fix a=b", "x=1"])).toEqual({ task: "fix a=b", x: "1" });
    expect(() => parseInputArgs(["oops"])).toThrow(/key=value/);
  });

  it("detectProject guesses node vs python vs unknown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ug-detect-"));
    expect(detectProject(dir).kind).toBe("unknown");
    writeFileSync(join(dir, "pyproject.toml"), "");
    expect(detectProject(dir)).toEqual({ kind: "python", gateCommand: "pytest -q" });
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detectProject(dir).kind).toBe("node");
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(detectProject(dir).gateCommand).toBe("pnpm test");
    await rm(dir, { recursive: true, force: true });
  });

  it("fixTestsTemplate emits a valid workflow", () => {
    const { workflow, issues } = parseWorkflow(fixTestsTemplate("pnpm test", "claude-code"));
    expect(workflow.name).toBe("fix-tests");
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });
});

describe("CLI end-to-end (fake adapter, real gates, real git worktrees)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "ug-cli-"));
    const git = (...a: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", ...a], { cwd: repo });
    git("init", "-b", "main");
    writeFileSync(join(repo, "README.md"), "demo\n");
    git("add", "-A");
    git("commit", "-m", "init");
    mkdirSync(join(repo, ".untilgreen"));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("lint reports errors and warnings", () => {
    writeFileSync(
      join(repo, ".untilgreen", "bad.yaml"),
      `version: 1\nsteps:\n  - id: a\n    prompt: hi\n    on_fail: goto:nope\n`,
    );
    const out = run(repo, ["lint", "bad"], true);
    expect(out).toContain("unknown-goto");
  });

  it("money demo wiring: run retries until the gate goes green, history shows the timeline", () => {
    const counter = join(repo, ".counter");
    // gate fails twice, passes on the 3rd attempt — the fake agent claims
    // success every time; only the gate decides (invariant 1)
    writeFileSync(
      join(repo, ".untilgreen", "demo.yaml"),
      `version: 1
name: demo
defaults: { agent: fake }
budget: { max_usd: 1, max_iterations_total: 10, timeout_minutes: 5 }
steps:
  - id: fix
    prompt: "attempt {{ iteration }}: {{ gate.output }}"
    gate:
      run: "c=$(cat ${counter} 2>/dev/null || echo 0); c=$((c+1)); echo $c > ${counter}; echo attempt $c; [ $c -ge 3 ]"
    on_pass: success
    on_fail: retry
    max_iterations: 5
`,
    );
    const out = run(repo, ["run", "demo", "--json"]);
    const result = JSON.parse(out.trim().split("\n").at(-1)!) as { status: string; totalIterations: number; runId: string };
    expect(result.status).toBe("succeeded");
    expect(result.totalIterations).toBe(3);

    const history = run(repo, ["history", "--json"]);
    const runs = JSON.parse(history.trim()) as { id: string; status: string }[];
    expect(runs[0]!.status).toBe("succeeded");

    const timelineOut = run(repo, ["history", "--run", result.runId, "--json"]);
    const { timeline } = JSON.parse(timelineOut.trim()) as { timeline: { gatePass: boolean }[] };
    expect(timeline.map((t) => t.gatePass)).toEqual([false, false, true]);
  });

  it("run exits nonzero when the gate never passes", () => {
    writeFileSync(
      join(repo, ".untilgreen", "never.yaml"),
      `version: 1
name: never
defaults: { agent: fake }
steps:
  - id: fix
    prompt: "attempt {{ iteration }}"
    gate: { run: "c=$(cat .nc 2>/dev/null || echo 0); c=$((c+1)); echo $c > .nc; echo failure $c; false" }
    max_iterations: 2
`,
    );
    const out = run(repo, ["run", "never", "--json"], true);
    expect(out).toContain("failed:max_iterations");
  });

  it("init detects the project and writes a lintable workflow, refusing to overwrite", () => {
    writeFileSync(join(repo, "package.json"), "{}");
    const out = run(repo, ["init", "--agent", "claude-code"]);
    expect(out).toContain("fix-tests.yaml");
    const lintOut = run(repo, ["lint", "fix-tests"]);
    expect(lintOut).toContain("✔ fix-tests");
    const second = run(repo, ["init"], true);
    expect(second).toContain("not overwriting");
  });

  it("doctor reports node and git", () => {
    const out = run(repo, ["doctor", "--json"], true);
    const checks = JSON.parse(out.trim()) as { name: string; ok: boolean }[];
    expect(checks.find((c) => c.name === "node")?.ok).toBe(true);
    expect(checks.find((c) => c.name === "git")?.ok).toBe(true);
  });
});

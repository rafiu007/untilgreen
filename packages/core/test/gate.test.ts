import { describe, expect, it } from "vitest";
import { runGate } from "../src/gate.js";

const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
const cwd = process.cwd();

describe("gate runner (invariant 1: the engine executes gates)", () => {
  it("passes on exit code 0 by default", async () => {
    const r = await runGate({ run: "true" }, { cwd, env });
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("fails on nonzero exit and captures output", async () => {
    const r = await runGate({ run: "echo boom; exit 3" }, { cwd, env });
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(3);
    expect(r.output).toContain("boom");
  });

  it("supports pass_when.exit_code", async () => {
    const r = await runGate({ run: "exit 7", pass_when: { exit_code: 7 } }, { cwd, env });
    expect(r.pass).toBe(true);
  });

  it("supports pass_when.output_matches (regex)", async () => {
    const ok = await runGate(
      { run: "echo '0 failing'", pass_when: { output_matches: "\\d+ failing" } },
      { cwd, env },
    );
    expect(ok.pass).toBe(true);
    const bad = await runGate(
      { run: "echo 'all good'", pass_when: { output_matches: "\\d+ failing" } },
      { cwd, env },
    );
    expect(bad.pass).toBe(false);
  });

  it("requires BOTH exit_code and output_matches when both present", async () => {
    const r = await runGate(
      { run: "echo '0 failing'; exit 1", pass_when: { exit_code: 0, output_matches: "failing" } },
      { cwd, env },
    );
    expect(r.pass).toBe(false);
  });

  it("captures stderr too", async () => {
    const r = await runGate({ run: "echo oops 1>&2; exit 1" }, { cwd, env });
    expect(r.output).toContain("oops");
  });

  it("times out and fails", async () => {
    const r = await runGate({ run: "sleep 10", timeout_seconds: 1 }, { cwd, env });
    expect(r.timedOut).toBe(true);
    expect(r.pass).toBe(false);
  }, 15_000);

  it("passes ONLY the allowlisted env (never process.env)", async () => {
    process.env.UNTILGREEN_TEST_SECRET = "leaked";
    try {
      const r = await runGate({ run: 'echo "[$UNTILGREEN_TEST_SECRET]"' }, { cwd, env });
      expect(r.output).toContain("[]");
      expect(r.output).not.toContain("leaked");
    } finally {
      delete process.env.UNTILGREEN_TEST_SECRET;
    }
  });
});

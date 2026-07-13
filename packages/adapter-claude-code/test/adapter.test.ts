import { describe, expect, it } from "vitest";
import { UnsupportedConstraintError } from "@untilgreen/core";
import { buildClaudeArgs, parseClaudeJson, ClaudeCodeAdapter } from "../src/index.js";

describe("buildClaudeArgs", () => {
  it("always runs headless json with --bare (stateless, invariant 2)", () => {
    const args = buildClaudeArgs({});
    expect(args).toContain("-p");
    expect(args).toContain("--bare");
    expect(args.join(" ")).toContain("--output-format json");
    expect(args.join(" ")).not.toContain("--continue");
    expect(args.join(" ")).not.toContain("--resume");
  });

  it("maps max_turns and allowed_tools (camelCase --allowedTools)", () => {
    const args = buildClaudeArgs({ max_turns: 12, allowed_tools: ["Bash(git diff *)", "Read"] });
    expect(args.join(" ")).toContain("--max-turns 12");
    expect(args.join(" ")).toContain("--allowedTools Bash(git diff *),Read");
  });

  it("locks down permission mode to dontAsk when tools are allowlisted", () => {
    expect(buildClaudeArgs({ allowed_tools: ["Read"] }).join(" ")).toContain("--permission-mode dontAsk");
    expect(buildClaudeArgs({}).join(" ")).toContain("--permission-mode acceptEdits");
  });
});

describe("parseClaudeJson", () => {
  it("extracts result, total_cost_usd, is_error", () => {
    const payload = parseClaudeJson(
      `{"type":"result","subtype":"success","is_error":false,"result":"done","total_cost_usd":0.42,"session_id":"abc"}`,
    );
    expect(payload.result).toBe("done");
    expect(payload.total_cost_usd).toBe(0.42);
    expect(payload.is_error).toBe(false);
  });

  it("tolerates stray log lines around the JSON object", () => {
    const payload = parseClaudeJson(`warming up...\n{"result":"ok","total_cost_usd":0.1}\n`);
    expect(payload.result).toBe("ok");
  });

  it("throws when there is no JSON at all", () => {
    expect(() => parseClaudeJson("command not found")).toThrow(/no JSON payload/);
  });
});

describe("constraint validation (invariant 5)", () => {
  it("throws UnsupportedConstraintError for network:false rather than degrading", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(() => adapter.validateConstraints({ network: false })).toThrow(UnsupportedConstraintError);
    expect(() => adapter.validateConstraints({ max_turns: 5 })).not.toThrow();
  });
});

describe("invoke against a stub binary", () => {
  it("parses a scripted CLI response end-to-end (stdin prompt, json stdout)", async () => {
    // Stub "claude": a shell script that ignores the flags, reads the prompt
    // from stdin (like claude -p does), and emits an --output-format json
    // shaped payload.
    const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "untilgreen-claude-stub-"));
    const stub = join(dir, "claude");
    await writeFile(
      stub,
      `#!/bin/sh\ninput=$(cat)\nprintf '{"result":"stubbed:%s","total_cost_usd":0.05,"is_error":false}\\n' "$input"\n`,
    );
    await chmod(stub, 0o755);
    try {
      const adapter = new ClaudeCodeAdapter({ binary: stub });
      const result = await adapter.invoke({
        prompt: "hello",
        workspacePath: process.cwd(),
        constraints: {},
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 15_000,
      });
      expect(result.outputText).toBe("stubbed:hello");
      expect(result.costUsd).toBe(0.05);
      expect(result.costUnknown).toBe(false);
      expect(result.agentClaimedSuccess).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

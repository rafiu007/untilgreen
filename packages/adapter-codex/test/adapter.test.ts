import { describe, expect, it } from "vitest";
import { UnsupportedConstraintError } from "@untilgreen/core";
import { buildCodexArgs, parseCodexJsonl, usageToUsd, CodexAdapter } from "../src/index.js";

describe("buildCodexArgs", () => {
  it("is stateless and sandboxed by default (invariant 2)", () => {
    const args = buildCodexArgs({});
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args.join(" ")).toContain("--sandbox workspace-write");
    expect(args.join(" ")).not.toContain("resume");
  });

  it("enables network only when asked, via inline config override", () => {
    expect(buildCodexArgs({ network: true }).join(" ")).toContain(
      "-c sandbox_workspace_write.network_access=true",
    );
    expect(buildCodexArgs({}).join(" ")).not.toContain("network_access");
  });
});

describe("parseCodexJsonl", () => {
  const stream = [
    `{"type":"thread.started","thread_id":"t1"}`,
    `{"type":"turn.started"}`,
    `{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}`,
    `{"type":"item.completed","item":{"type":"agent_message","text":"first draft"}}`,
    `not json noise`,
    `{"type":"item.completed","item":{"type":"agent_message","text":"final answer"}}`,
    `{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":500,"output_tokens":200,"reasoning_output_tokens":300}}`,
  ].join("\n");

  it("keeps the last agent message and accumulates usage", () => {
    const parsed = parseCodexJsonl(stream);
    expect(parsed.finalMessage).toBe("final answer");
    expect(parsed.usage).toEqual({
      input_tokens: 1000,
      cached_input_tokens: 500,
      output_tokens: 200,
      reasoning_output_tokens: 300,
    });
    expect(parsed.turnFailed).toBe(false);
  });

  it("flags turn.failed and error events", () => {
    expect(parseCodexJsonl(`{"type":"turn.failed"}`).turnFailed).toBe(true);
    expect(parseCodexJsonl(`{"type":"error","message":"boom"}`).turnFailed).toBe(true);
  });

  it("sums usage across multiple turns", () => {
    const two = [
      `{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":10}}`,
      `{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":5}}`,
    ].join("\n");
    const parsed = parseCodexJsonl(two);
    expect(parsed.usage.input_tokens).toBe(150);
    expect(parsed.usage.output_tokens).toBe(15);
  });
});

describe("usageToUsd (tokens → USD, invariant 7 note)", () => {
  it("converts with the price table, cached input at a discount", () => {
    const usd = usageToUsd(
      { input_tokens: 1_000_000, cached_input_tokens: 1_000_000, output_tokens: 500_000, reasoning_output_tokens: 500_000 },
      { inputPerM: 2, outputPerM: 8 },
    );
    // 1M input @$2 + 1M cached @$0.2 + 1M output-ish @$8 = 10.2
    expect(usd).toBeCloseTo(10.2);
  });
});

describe("constraint validation (invariant 5)", () => {
  const adapter = new CodexAdapter();
  it("throws for max_turns and allowed_tools", () => {
    expect(() => adapter.validateConstraints({ max_turns: 5 })).toThrow(UnsupportedConstraintError);
    expect(() => adapter.validateConstraints({ allowed_tools: ["Bash"] })).toThrow(
      UnsupportedConstraintError,
    );
  });
  it("accepts network in both directions (enforceable via sandbox)", () => {
    expect(() => adapter.validateConstraints({ network: false })).not.toThrow();
    expect(() => adapter.validateConstraints({ network: true })).not.toThrow();
  });
});

describe("cost honesty", () => {
  it("reports costUnknown without a price table", async () => {
    const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "untilgreen-codex-stub-"));
    const stub = join(dir, "codex");
    await writeFile(
      stub,
      `#!/bin/sh
cat > /dev/null
echo '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
`,
    );
    await chmod(stub, 0o755);
    try {
      const bare = new CodexAdapter({ binary: stub });
      const result = await bare.invoke({
        prompt: "x",
        workspacePath: process.cwd(),
        constraints: {},
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 15_000,
      });
      expect(result.costUnknown).toBe(true);
      expect(result.costUsd).toBe(0);
      expect(result.outputText).toBe("done");

      const priced = new CodexAdapter({ binary: stub, priceTable: { inputPerM: 2, outputPerM: 8 } });
      const result2 = await priced.invoke({
        prompt: "x",
        workspacePath: process.cwd(),
        constraints: {},
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 15_000,
      });
      expect(result2.costUnknown).toBe(false);
      expect(result2.costUsd).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

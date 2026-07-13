/**
 * OpenAI Codex CLI adapter (`codex exec --json`).
 *
 * ⚠ Flag surface researched July 2026 from developers.openai.com/codex and
 * openai/codex docs, but NOT adversarially verified (verification budget ran
 * out) and the docs themselves moved twice recently — treat as
 * needs-reconfirmation. `untilgreen doctor` probes actual behavior; the
 * nightly smoke matrix catches drift. See CONSTITUTION.md.
 *
 * Statelessness (invariant 2): codex persists sessions by default, so we
 * pass --ephemeral (no session files) and --ignore-user-config (no
 * $CODEX_HOME/config.toml). `codex exec resume` is never used.
 *
 * Cost (invariant 7 note): turn.completed reports TOKEN counts, not USD.
 * The adapter converts via a caller-supplied price table; without one it
 * reports costUnknown: true rather than inventing prices.
 */
import type { Constraints } from "@untilgreen/schema";
import {
  execCollect,
  UnsupportedConstraintError,
  type AgentAdapter,
  type AdapterInfo,
  type InvocationRequest,
  type InvocationResult,
} from "@untilgreen/core";

export interface CodexPriceTable {
  /** USD per 1M input tokens */
  inputPerM: number;
  /** USD per 1M output tokens (also applied to reasoning output) */
  outputPerM: number;
  /** USD per 1M cached input tokens (defaults to inputPerM / 10) */
  cachedInputPerM?: number;
}

export interface CodexAdapterOptions {
  binary?: string;
  model?: string;
  /** without a price table, cost is reported as unknown */
  priceTable?: CodexPriceTable;
  extraArgs?: string[];
}

export function buildCodexArgs(constraints: Constraints, opts: CodexAdapterOptions = {}): string[] {
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
  ];
  if (constraints.network === true) {
    // network is off by default in workspace-write; enable via inline config
    args.push("-c", "sandbox_workspace_write.network_access=true");
  }
  if (opts.model) args.push("--model", opts.model);
  // prompt is passed as "-" i.e. read from stdin
  args.push("-");
  return args;
}

export interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

export interface ParsedCodexStream {
  finalMessage: string;
  usage: CodexUsage;
  turnFailed: boolean;
  events: unknown[];
}

/** Parse the JSONL event stream (thread.started, turn.*, item.*, error). */
export function parseCodexJsonl(stdout: string): ParsedCodexStream {
  const events: unknown[] = [];
  const usage: CodexUsage = {};
  let finalMessage = "";
  let turnFailed = false;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // interleaved non-JSON noise
    }
    events.push(event);
    const type = event.type as string | undefined;
    if (type === "turn.completed") {
      const u = (event.usage ?? {}) as CodexUsage;
      usage.input_tokens = (usage.input_tokens ?? 0) + (u.input_tokens ?? 0);
      usage.cached_input_tokens = (usage.cached_input_tokens ?? 0) + (u.cached_input_tokens ?? 0);
      usage.output_tokens = (usage.output_tokens ?? 0) + (u.output_tokens ?? 0);
      usage.reasoning_output_tokens =
        (usage.reasoning_output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0);
    } else if (type === "turn.failed" || type === "error") {
      turnFailed = true;
    } else if (type === "item.completed") {
      const item = event.item as { type?: string; text?: string } | undefined;
      if (item?.type === "agent_message" && typeof item.text === "string") {
        finalMessage = item.text; // keep the last agent message
      }
    }
  }
  return { finalMessage, usage, turnFailed, events };
}

export function usageToUsd(usage: CodexUsage, price: CodexPriceTable): number {
  const cachedRate = price.cachedInputPerM ?? price.inputPerM / 10;
  return (
    ((usage.input_tokens ?? 0) * price.inputPerM +
      (usage.cached_input_tokens ?? 0) * cachedRate +
      ((usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0)) * price.outputPerM) /
    1_000_000
  );
}

export class CodexAdapter implements AgentAdapter {
  readonly info: AdapterInfo;
  private readonly opts: CodexAdapterOptions;

  constructor(opts: CodexAdapterOptions = {}) {
    this.opts = opts;
    this.info = {
      id: "codex",
      displayName: "OpenAI Codex CLI (codex exec --json)",
      binary: opts.binary ?? "codex",
      testedAgentVersions: ["docs snapshot 2026-07 (UNVERIFIED — re-probe via doctor)"],
      // USER: keychain-backed auth on macOS fails without it (same failure
      // mode field-tested with the claude CLI)
      requiredEnv: ["OPENAI_API_KEY", "CODEX_API_KEY", "USER"],
      supportsCostReporting: this.opts.priceTable !== undefined,
    };
  }

  validateConstraints(constraints: Constraints): void {
    if (constraints.max_turns !== undefined) {
      throw new UnsupportedConstraintError(
        this.info.id,
        "max_turns",
        "codex exec has no turn-limit flag; rely on engine budgets",
      );
    }
    if (constraints.allowed_tools !== undefined) {
      throw new UnsupportedConstraintError(
        this.info.id,
        "allowed_tools",
        "codex exec has no per-tool allowlist flag",
      );
    }
    // network:false = workspace-write default (network off) → enforceable.
    // network:true → enabled via -c override in buildCodexArgs.
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    this.validateConstraints(req.constraints);
    const args = [...buildCodexArgs(req.constraints, this.opts), ...(this.opts.extraArgs ?? [])];
    const proc = await execCollect(this.info.binary, args, {
      cwd: req.workspacePath,
      env: req.env,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      stdinText: req.prompt,
    });

    if (proc.timedOut) {
      return {
        outputText: `codex timed out after ${req.timeoutMs}ms\n${proc.stderr.slice(-2000)}`,
        costUsd: 0,
        costUnknown: true,
        agentClaimedSuccess: null,
        raw: proc,
      };
    }

    const parsed = parseCodexJsonl(proc.stdout);
    const priced = this.opts.priceTable !== undefined;
    return {
      outputText: parsed.finalMessage,
      costUsd: priced ? usageToUsd(parsed.usage, this.opts.priceTable!) : 0,
      costUnknown: !priced,
      // telemetry only (invariant 3)
      agentClaimedSuccess: parsed.turnFailed ? false : parsed.finalMessage ? true : null,
      raw: { usage: parsed.usage, eventCount: parsed.events.length },
    };
  }
}

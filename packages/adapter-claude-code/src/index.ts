/**
 * Claude Code adapter. Flag surface verified against
 * https://code.claude.com/docs/en/headless (adversarially verified 3-0,
 * July 2026) — see CONSTITUTION.md "Adapter ground truth". Flags drift
 * monthly; the nightly smoke matrix and `untilgreen doctor` re-probe.
 *
 * Statelessness (invariant 2): --bare skips hooks/skills/plugins/MCP/auto
 * memory/CLAUDE.md; --continue/--resume are never passed.
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

export interface ClaudeCodeAdapterOptions {
  /** binary name/path (default "claude") */
  binary?: string;
  /** extra args appended verbatim (escape hatch for flag drift) */
  extraArgs?: string[];
}

export function buildClaudeArgs(constraints: Constraints): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    // recommended for scripted calls; will become the -p default upstream
    "--bare",
    // locked-down baseline: deny anything not explicitly allowed
    "--permission-mode",
    constraints.allowed_tools ? "dontAsk" : "acceptEdits",
  ];
  if (constraints.max_turns !== undefined) {
    args.push("--max-turns", String(constraints.max_turns));
  }
  if (constraints.allowed_tools !== undefined) {
    args.push("--allowedTools", constraints.allowed_tools.join(","));
  }
  return args;
}

export interface ClaudeJsonPayload {
  result?: string;
  total_cost_usd?: number;
  is_error?: boolean;
  subtype?: string;
  [k: string]: unknown;
}

export function parseClaudeJson(stdout: string): ClaudeJsonPayload {
  // stdout is a single JSON object in --output-format json mode; tolerate
  // stray log lines before/after by extracting the outermost object
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`claude produced no JSON payload (got: ${stdout.slice(0, 200)}…)`);
  }
  return JSON.parse(stdout.slice(start, end + 1)) as ClaudeJsonPayload;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly info: AdapterInfo;
  private readonly binary: string;
  private readonly extraArgs: string[];

  constructor(opts: ClaudeCodeAdapterOptions = {}) {
    this.binary = opts.binary ?? "claude";
    this.extraArgs = opts.extraArgs ?? [];
    this.info = {
      id: "claude-code",
      displayName: "Claude Code (claude -p)",
      binary: this.binary,
      testedAgentVersions: ["2.1.x (docs verified 2026-07)"],
      // Auth: API key if present; subscription auth lives under HOME, which
      // the default env allowlist already passes through.
      requiredEnv: ["ANTHROPIC_API_KEY"],
      supportsCostReporting: true,
    };
  }

  validateConstraints(constraints: Constraints): void {
    if (constraints.network === false) {
      // Enforceable upstream via sandbox settings.json (verified), but this
      // adapter does not generate settings files yet. Invariant 5: throw,
      // never silently degrade. Tracked for v0.2.
      throw new UnsupportedConstraintError(
        this.info.id,
        "network",
        "sandbox settings-file wiring is not implemented yet (v0.2); remove network:false or use a different agent",
      );
    }
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    this.validateConstraints(req.constraints);
    const args = [...buildClaudeArgs(req.constraints), ...this.extraArgs];
    const proc = await execCollect(this.binary, args, {
      cwd: req.workspacePath,
      env: req.env,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      stdinText: req.prompt, // prompt via stdin: no ARG_MAX limits, no shell quoting
    });

    if (proc.timedOut) {
      return {
        outputText: `claude timed out after ${req.timeoutMs}ms\n${proc.stderr.slice(-2000)}`,
        costUsd: 0,
        costUnknown: true,
        agentClaimedSuccess: null,
        raw: proc,
      };
    }

    const payload = parseClaudeJson(proc.stdout);
    return {
      outputText: payload.result ?? "",
      costUsd: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : 0,
      costUnknown: typeof payload.total_cost_usd !== "number",
      // telemetry only (invariant 3): the CLI's own error/success marker
      agentClaimedSuccess: payload.is_error === undefined ? null : !payload.is_error,
      raw: payload,
    };
  }
}

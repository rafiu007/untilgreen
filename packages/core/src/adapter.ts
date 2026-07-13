/**
 * The adapter plugin contract.
 *
 * ADAPTER INVARIANTS — violating any of these is a bug, not a feature:
 *
 * 1. Adapters EXECUTE, the engine DECIDES. An adapter never runs gates,
 *    never retries, never judges success. It turns one InvocationRequest
 *    into one agent-CLI process and reports what happened.
 * 2. Every invocation is a STATELESS fresh session. Adapters must actively
 *    opt out of CLI session persistence (claude: --bare, never
 *    --continue/--resume; codex: --ephemeral, --ignore-user-config) and
 *    must not thread any context between invocations.
 * 3. `agentClaimedSuccess` is TELEMETRY ONLY. The engine records it and
 *    routes exclusively on gate results.
 * 4. Constraints an adapter cannot enforce THROW UnsupportedConstraintError
 *    from validateConstraints() — at lint/spawn time, never silently
 *    degraded at run time.
 * 5. Cost is reported honestly: `costUsd` with `costUnknown: false` only
 *    when the CLI reports spend (or the adapter converts documented token
 *    counts with a maintained price table). If cost cannot be known,
 *    `costUsd: 0, costUnknown: true`.
 */
import type { Constraints } from "@untilgreen/schema";

export interface AdapterInfo {
  /** stable id used in workflow YAML `agent:` fields, e.g. "claude-code" */
  id: string;
  displayName: string;
  /** executable name probed by `untilgreen doctor` */
  binary: string;
  /** agent CLI versions this adapter was last verified against */
  testedAgentVersions: string[];
  /** env var NAMES the adapter needs passed through (auth etc.) — the
   * engine copies exactly these from the parent env, never the whole env */
  requiredEnv: string[];
  supportsCostReporting: boolean;
}

export interface InvocationRequest {
  prompt: string;
  workspacePath: string;
  constraints: Constraints;
  /** fully-resolved env for the child process (allowlist + requiredEnv) */
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface InvocationResult {
  /** the agent's final output text (for the run record) */
  outputText: string;
  /** adapter-normalized cost in USD; 0 when unknown */
  costUsd: number;
  costUnknown: boolean;
  /** what the agent claimed — telemetry only (invariant 3) */
  agentClaimedSuccess: boolean | null;
  /** raw CLI payload for debugging */
  raw?: unknown;
}

export interface AgentAdapter {
  readonly info: AdapterInfo;
  /** Throw UnsupportedConstraintError for anything not enforceable. */
  validateConstraints(constraints: Constraints): void;
  invoke(req: InvocationRequest): Promise<InvocationResult>;
}

export class UnsupportedConstraintError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly constraint: string,
    detail?: string,
  ) {
    super(
      `adapter "${adapterId}" cannot enforce constraint "${constraint}"${detail ? `: ${detail}` : ""}`,
    );
    this.name = "UnsupportedConstraintError";
  }
}

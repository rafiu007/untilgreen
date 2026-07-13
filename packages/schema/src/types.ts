export interface WorkflowInput {
  required?: boolean;
  description?: string;
  default?: string;
}

export interface Constraints {
  network?: boolean;
  max_turns?: number;
  allowed_tools?: string[];
}

export interface PassWhen {
  exit_code?: number;
  output_matches?: string;
}

export interface GateSpec {
  run: string;
  timeout_seconds?: number;
  pass_when?: PassWhen;
}

export type OnPass = "next" | "success" | `goto:${string}`;
export type OnFail = "retry" | "fail" | `goto:${string}`;

export interface StepSpec {
  id: string;
  agent?: string;
  prompt: string;
  constraints?: Constraints;
  gate?: GateSpec;
  on_pass?: OnPass;
  on_fail?: OnFail;
  max_iterations?: number;
}

export interface BudgetSpec {
  max_usd?: number;
  max_iterations_total?: number;
  timeout_minutes?: number;
}

export interface BrakeSpec {
  identical_gate_failures?: number;
  identical_diffs?: number;
  empty_diffs?: number;
}

export interface WorkspaceSpec {
  base_ref?: string;
  keep?: boolean;
}

export interface WorkflowSpec {
  version: 1;
  name?: string;
  inputs?: Record<string, WorkflowInput>;
  defaults?: { agent?: string; constraints?: Constraints };
  budget?: BudgetSpec;
  brake?: BrakeSpec;
  workspace?: WorkspaceSpec;
  env_allowlist?: string[];
  steps: StepSpec[];
}

export type IssueSeverity = "error" | "warning";

export interface Issue {
  rule: string;
  severity: IssueSeverity;
  message: string;
  /** JSON-pointer-ish location, e.g. /steps/2/on_pass */
  path?: string;
}

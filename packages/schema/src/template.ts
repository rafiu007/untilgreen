/**
 * Template scanning shared by the linter (here) and the renderer (core).
 * Invariant 3: five variables, substitution only. `{{` that does not open a
 * valid `{{ var }}` expression is treated as literal text.
 */

export const TEMPLATE_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export type TemplateVar =
  | { kind: "input"; name: string }
  | { kind: "gate_output" }
  | { kind: "step_gate_output"; stepId: string }
  | { kind: "iteration" }
  | { kind: "workspace_path" };

/** Classify a raw variable name; returns null if it is not one of the five. */
export function classifyVar(raw: string): TemplateVar | null {
  if (raw === "gate.output") return { kind: "gate_output" };
  if (raw === "iteration") return { kind: "iteration" };
  if (raw === "workspace.path") return { kind: "workspace_path" };
  const input = /^inputs\.([a-z0-9][a-z0-9_-]*)$/.exec(raw);
  if (input) return { kind: "input", name: input[1]! };
  const step = /^steps\.([a-z0-9][a-z0-9_-]*)\.gate\.output$/.exec(raw);
  if (step) return { kind: "step_gate_output", stepId: step[1]! };
  return null;
}

export interface TemplateRef {
  raw: string;
  var: TemplateVar | null;
}

export function scanTemplate(text: string): TemplateRef[] {
  const refs: TemplateRef[] = [];
  for (const m of text.matchAll(TEMPLATE_RE)) {
    const raw = m[1]!;
    refs.push({ raw, var: classifyVar(raw) });
  }
  return refs;
}

import { TEMPLATE_RE, classifyVar } from "@untilgreen/schema";

export interface RenderContext {
  inputs: Record<string, string>;
  /** previous gate output of the CURRENT step ("" on iteration 1) */
  gateOutput: string;
  /** most recent gate output per step id ("" when a step has not run) */
  stepGateOutputs: Record<string, string>;
  iteration: number;
  workspacePath: string;
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

/**
 * Substitution-only templating (invariant 3). Exactly five variables; an
 * expression matching the variable syntax but naming anything else is an
 * error; `{{` that does not open a valid expression is literal text.
 */
export function render(template: string, ctx: RenderContext): string {
  return template.replace(TEMPLATE_RE, (whole, raw: string) => {
    const v = classifyVar(raw);
    if (v === null) {
      throw new RenderError(`unknown template variable "{{ ${raw} }}"`);
    }
    switch (v.kind) {
      case "input": {
        const value = ctx.inputs[v.name];
        if (value === undefined) throw new RenderError(`undeclared input "${v.name}"`);
        return value;
      }
      case "gate_output":
        return ctx.gateOutput;
      case "step_gate_output":
        return ctx.stepGateOutputs[v.stepId] ?? "";
      case "iteration":
        return String(ctx.iteration);
      case "workspace_path":
        return ctx.workspacePath;
    }
  });
}

import type { Issue, StepSpec, WorkflowSpec } from "./types.js";
import { scanTemplate } from "./template.js";

function gotoTarget(route: string | undefined): string | null {
  if (route?.startsWith("goto:")) return route.slice("goto:".length);
  return null;
}

/**
 * Semantic checks the JSON Schema cannot express. Assumes the document has
 * already passed schema validation.
 */
export function lintWorkflow(wf: WorkflowSpec): Issue[] {
  const issues: Issue[] = [];
  const stepIds = new Map<string, number>();

  wf.steps.forEach((step, i) => {
    if (stepIds.has(step.id)) {
      issues.push({
        rule: "duplicate-step-id",
        severity: "error",
        message: `step id "${step.id}" is declared more than once`,
        path: `/steps/${i}/id`,
      });
    } else {
      stepIds.set(step.id, i);
    }
  });

  for (const [name, input] of Object.entries(wf.inputs ?? {})) {
    if (input.required && input.default !== undefined) {
      issues.push({
        rule: "default-forbidden-with-required",
        severity: "error",
        message: `input "${name}" cannot be both required and have a default`,
        path: `/inputs/${name}`,
      });
    }
  }

  wf.steps.forEach((step, i) => {
    for (const route of ["on_pass", "on_fail"] as const) {
      const target = gotoTarget(step[route]);
      if (target !== null && !stepIds.has(target)) {
        issues.push({
          rule: "unknown-goto",
          severity: "error",
          message: `step "${step.id}" ${route} targets unknown step "${target}"`,
          path: `/steps/${i}/${route}`,
        });
      }
    }

    for (const ref of scanTemplate(step.prompt)) {
      if (ref.var === null) {
        issues.push({
          rule: "unknown-template-variable",
          severity: "error",
          message: `step "${step.id}" references "{{ ${ref.raw} }}", which is not one of the five template variables`,
          path: `/steps/${i}/prompt`,
        });
      } else if (ref.var.kind === "input" && !(wf.inputs && ref.var.name in wf.inputs)) {
        issues.push({
          rule: "unknown-input",
          severity: "error",
          message: `step "${step.id}" references undeclared input "${ref.var.name}"`,
          path: `/steps/${i}/prompt`,
        });
      } else if (ref.var.kind === "step_gate_output" && !stepIds.has(ref.var.stepId)) {
        issues.push({
          rule: "unknown-template-variable",
          severity: "error",
          message: `step "${step.id}" references gate output of unknown step "${ref.var.stepId}"`,
          path: `/steps/${i}/prompt`,
        });
      }
    }

    if (!step.gate) {
      issues.push({
        rule: "ungated-step",
        severity: "warning",
        message: `step "${step.id}" has no gate; it will pass unconditionally (agent output is never verified)`,
        path: `/steps/${i}`,
      });
    }
  });

  // Reachability. Edges follow §2.2 of the spec. Retry stays on the same
  // node so it adds no edge; retry exhaustion terminates in failure.
  const reachable = new Set<number>();
  let successReachable = false;
  const queue: number[] = wf.steps.length > 0 ? [0] : [];
  while (queue.length > 0) {
    const i = queue.shift()!;
    if (reachable.has(i)) continue;
    reachable.add(i);
    const step = wf.steps[i] as StepSpec;
    const edges: number[] = [];
    const onPass = step.on_pass ?? "next";
    if (onPass === "success") successReachable = true;
    else if (onPass === "next") {
      if (i + 1 < wf.steps.length) edges.push(i + 1);
      else successReachable = true;
    } else {
      const t = stepIds.get(gotoTarget(onPass)!);
      if (t !== undefined) edges.push(t);
    }
    const onFail = step.on_fail ?? "retry";
    const failTarget = gotoTarget(onFail);
    if (failTarget !== null) {
      const t = stepIds.get(failTarget);
      if (t !== undefined) edges.push(t);
    }
    for (const e of edges) if (!reachable.has(e)) queue.push(e);
  }

  if (!successReachable && wf.steps.length > 0) {
    issues.push({
      rule: "no-success-path",
      severity: "error",
      message: "no reachable route terminates in success",
      path: "/steps",
    });
  }

  wf.steps.forEach((step, i) => {
    if (!reachable.has(i) && stepIds.get(step.id) === i) {
      issues.push({
        rule: "unreachable-step",
        severity: "warning",
        message: `step "${step.id}" is unreachable`,
        path: `/steps/${i}`,
      });
    }
  });

  return issues;
}

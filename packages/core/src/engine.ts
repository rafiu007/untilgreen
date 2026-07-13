import type { Constraints, StepSpec, WorkflowSpec } from "@untilgreen/schema";
import type { AgentAdapter } from "./adapter.js";
import { BudgetMeter } from "./budget.js";
import { DoomLoopBrake } from "./doomloop.js";
import { runGate, type GateResult } from "./gate.js";
import { render } from "./render.js";
import type { RunStore } from "./store.js";
import type { WorkspaceProvider } from "./workspace.js";

export type TerminalStatus =
  | "succeeded"
  | `failed:${string}`
  | "aborted:budget_usd"
  | "aborted:budget_iterations"
  | "aborted:timeout"
  | "aborted:doom_loop"
  | "canceled";

export interface RunResult {
  runId: string;
  status: TerminalStatus;
  totalUsd: number;
  totalIterations: number;
  costUnknown: boolean;
}

export interface IterationEvent {
  stepId: string;
  iteration: number;
  seq: number;
  gate: GateResult | null;
  agentClaimedSuccess: boolean | null;
  costUsd: number;
  totalUsd: number;
}

export interface RunReporter {
  onStepStart?(stepId: string, iteration: number): void;
  onIteration?(event: IterationEvent): void;
  onFinish?(result: RunResult): void;
}

export interface EngineDeps {
  adapters: Map<string, AgentAdapter>;
  store: RunStore;
  workspace: WorkspaceProvider;
  reporter?: RunReporter;
  /** injectable clock for tests */
  now?: () => number;
  signal?: AbortSignal;
  /** parent env to copy allowlisted vars from (default process.env) */
  parentEnv?: Record<string, string | undefined>;
}

const DEFAULT_ENV_ALLOWLIST = ["PATH", "HOME"];

function resolveEnv(
  wf: WorkflowSpec,
  adapter: AgentAdapter | null,
  parentEnv: Record<string, string | undefined>,
): Record<string, string> {
  // Invariant: allowlist only — never inherit full process.env. Adapter
  // requiredEnv names (auth) are copied explicitly, not wholesale.
  const names = new Set([...(wf.env_allowlist ?? DEFAULT_ENV_ALLOWLIST), ...(adapter?.info.requiredEnv ?? [])]);
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = parentEnv[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function mergeConstraints(wf: WorkflowSpec, step: StepSpec): Constraints {
  return { ...wf.defaults?.constraints, ...step.constraints };
}

/**
 * The routing state machine. Routing decisions come exclusively from gate
 * results this function executes (invariant 1); adapters only execute
 * (invariant 4); budgets and the doom-loop brake are engine-side
 * (invariant 7).
 */
export async function runWorkflow(
  wf: WorkflowSpec,
  inputs: Record<string, string>,
  deps: EngineDeps,
): Promise<RunResult> {
  const now = deps.now ?? Date.now;
  const parentEnv = deps.parentEnv ?? (process.env as Record<string, string | undefined>);

  for (const [name, decl] of Object.entries(wf.inputs ?? {})) {
    if (inputs[name] === undefined) {
      if (decl.required) throw new Error(`missing required input "${name}"`);
      inputs[name] = decl.default ?? "";
    }
  }

  const runId = deps.store.createRun(wf.name ?? "unnamed", inputs, now());
  const meter = new BudgetMeter(wf.budget, now);
  const brake = new DoomLoopBrake(wf.brake);
  const workspace = await deps.workspace.create();

  const stepIndexById = new Map(wf.steps.map((s, i) => [s.id, i] as const));
  const iterationByStep = new Map<string, number>();
  const gateOutputByStep: Record<string, string> = {};
  let stepIndex = 0;
  let seq = 0;
  let status: TerminalStatus | null = null;

  try {
    while (status === null) {
      if (deps.signal?.aborted) {
        status = "canceled";
        break;
      }

      const step = wf.steps[stepIndex];
      if (!step) throw new Error(`internal: step index ${stepIndex} out of range`);

      meter.startIteration();
      const preVerdict = meter.check();
      if (preVerdict !== "ok") {
        status = preVerdict === "timeout" ? "aborted:timeout" : `aborted:${preVerdict}`;
        break;
      }

      const iteration = (iterationByStep.get(step.id) ?? 0) + 1;
      iterationByStep.set(step.id, iteration);
      seq += 1;
      deps.reporter?.onStepStart?.(step.id, iteration);

      const agentId = step.agent ?? wf.defaults?.agent;
      if (!agentId) throw new Error(`step "${step.id}" has no agent and no defaults.agent`);
      const adapter = deps.adapters.get(agentId);
      if (!adapter) throw new Error(`no adapter registered for agent "${agentId}"`);

      const constraints = mergeConstraints(wf, step);
      adapter.validateConstraints(constraints); // throws UnsupportedConstraintError (invariant 5)

      const prompt = render(step.prompt, {
        inputs,
        gateOutput: gateOutputByStep[step.id] ?? "",
        stepGateOutputs: gateOutputByStep,
        iteration,
        workspacePath: workspace.path,
      });

      const env = resolveEnv(wf, adapter, parentEnv);
      const agentResult = await adapter.invoke({
        prompt,
        workspacePath: workspace.path,
        constraints,
        env,
        timeoutMs: 30 * 60_000,
        signal: deps.signal,
      });
      meter.addCost(agentResult.costUsd, agentResult.costUnknown);

      const { diff } = await workspace.checkpoint(`${wf.name}: ${step.id} #${iteration}`);

      const gate: GateResult | null = step.gate
        ? await runGate(step.gate, { cwd: workspace.path, env, signal: deps.signal })
        : null;
      const gatePassed = gate?.pass ?? true; // ungated steps pass unconditionally (lint warns)
      if (gate) gateOutputByStep[step.id] = gate.output;

      deps.store.recordIteration({
        runId,
        seq,
        stepId: step.id,
        iteration,
        agentId,
        prompt,
        agent: agentResult,
        gate,
        diff,
        now: now(),
      });
      deps.reporter?.onIteration?.({
        stepId: step.id,
        iteration,
        seq,
        gate,
        agentClaimedSuccess: agentResult.agentClaimedSuccess,
        costUsd: agentResult.costUsd,
        totalUsd: meter.totalUsd,
      });

      const postVerdict = meter.check();
      if (postVerdict !== "ok") {
        status = postVerdict === "timeout" ? "aborted:timeout" : `aborted:${postVerdict}`;
        break;
      }

      const brakeVerdict = brake.observe({ gatePassed, gateOutput: gate?.output ?? "", diff });
      if (brakeVerdict.tripped) {
        status = "aborted:doom_loop";
        break;
      }

      if (gatePassed) {
        const route = step.on_pass ?? "next";
        if (route === "success") {
          status = "succeeded";
        } else if (route === "next") {
          if (stepIndex + 1 < wf.steps.length) stepIndex += 1;
          else status = "succeeded";
        } else {
          stepIndex = stepIndexById.get(route.slice("goto:".length))!;
        }
      } else {
        const route = step.on_fail ?? "retry";
        if (route === "fail") {
          status = "failed:on_fail";
        } else if (route === "retry") {
          if (iteration >= (step.max_iterations ?? 3)) status = "failed:max_iterations";
          // else: stay on the same step; gate output feeds the next render
        } else {
          stepIndex = stepIndexById.get(route.slice("goto:".length))!;
        }
      }
    }
  } finally {
    const finalStatus = status ?? "failed:engine_error";
    deps.store.finishRun(
      runId,
      finalStatus,
      { usd: meter.totalUsd, iterations: meter.totalIterations, costUnknown: meter.hadUnknownCost },
      now(),
    );
    const keep = wf.workspace?.keep ?? finalStatus !== "succeeded";
    await workspace.cleanup(keep);
  }

  const result: RunResult = {
    runId,
    status,
    totalUsd: meter.totalUsd,
    totalIterations: meter.totalIterations,
    costUnknown: meter.hadUnknownCost,
  };
  deps.reporter?.onFinish?.(result);
  return result;
}

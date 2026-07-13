import type { BudgetSpec } from "@untilgreen/schema";

export const BUDGET_DEFAULTS = {
  max_usd: 10,
  max_iterations_total: 50,
  timeout_minutes: 60,
} as const;

export type BudgetVerdict = "ok" | "budget_usd" | "budget_iterations" | "timeout";

/** Engine-side meters (invariant 7) — enforced even when CLIs lack flags. */
export class BudgetMeter {
  private usd = 0;
  private iterations = 0;
  private costUnknownSeen = false;
  private readonly maxUsd: number;
  private readonly maxIterations: number;
  private readonly deadlineMs: number;

  constructor(
    budget: BudgetSpec | undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.maxUsd = budget?.max_usd ?? BUDGET_DEFAULTS.max_usd;
    this.maxIterations = budget?.max_iterations_total ?? BUDGET_DEFAULTS.max_iterations_total;
    this.deadlineMs =
      this.now() + (budget?.timeout_minutes ?? BUDGET_DEFAULTS.timeout_minutes) * 60_000;
  }

  addCost(usd: number, unknown: boolean): void {
    this.usd += usd;
    if (unknown) this.costUnknownSeen = true;
  }

  /** Call once per iteration BEFORE invoking the agent. */
  startIteration(): void {
    this.iterations += 1;
  }

  check(): BudgetVerdict {
    if (this.now() > this.deadlineMs) return "timeout";
    if (this.iterations > this.maxIterations) return "budget_iterations";
    if (this.usd > this.maxUsd) return "budget_usd";
    return "ok";
  }

  get totalUsd(): number {
    return this.usd;
  }
  get totalIterations(): number {
    return this.iterations;
  }
  get hadUnknownCost(): boolean {
    return this.costUnknownSeen;
  }
}

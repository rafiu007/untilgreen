import { createHash } from "node:crypto";
import type { BrakeSpec } from "@untilgreen/schema";

export const BRAKE_DEFAULTS = {
  identical_gate_failures: 3,
  identical_diffs: 2,
  empty_diffs: 2,
} as const;

export type BrakeVerdict =
  | { tripped: false }
  | { tripped: true; reason: "identical_gate_failures" | "identical_diffs" | "empty_diffs" };

function hash(text: string): string {
  const normalized = text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Doom-loop brake (invariant 7): hashes consecutive FAILING iterations'
 * gate outputs and diffs and trips on repeats. A passing gate resets all
 * counters — the run is making verified progress.
 */
export class DoomLoopBrake {
  private readonly limits: Required<BrakeSpec>;
  private lastFailureHash: string | null = null;
  private failureRepeats = 0;
  private lastDiffHash: string | null = null;
  private diffRepeats = 0;
  private emptyDiffs = 0;

  constructor(brake?: BrakeSpec) {
    this.limits = {
      identical_gate_failures: brake?.identical_gate_failures ?? BRAKE_DEFAULTS.identical_gate_failures,
      identical_diffs: brake?.identical_diffs ?? BRAKE_DEFAULTS.identical_diffs,
      empty_diffs: brake?.empty_diffs ?? BRAKE_DEFAULTS.empty_diffs,
    };
  }

  observe(iter: { gatePassed: boolean; gateOutput: string; diff: string }): BrakeVerdict {
    if (iter.gatePassed) {
      this.lastFailureHash = null;
      this.failureRepeats = 0;
      this.lastDiffHash = null;
      this.diffRepeats = 0;
      this.emptyDiffs = 0;
      return { tripped: false };
    }

    const failureHash = hash(iter.gateOutput);
    this.failureRepeats = failureHash === this.lastFailureHash ? this.failureRepeats + 1 : 1;
    this.lastFailureHash = failureHash;
    if (this.failureRepeats >= this.limits.identical_gate_failures) {
      return { tripped: true, reason: "identical_gate_failures" };
    }

    if (iter.diff.trim() === "") {
      this.emptyDiffs += 1;
      this.lastDiffHash = null;
      this.diffRepeats = 0;
      if (this.emptyDiffs >= this.limits.empty_diffs) {
        return { tripped: true, reason: "empty_diffs" };
      }
    } else {
      this.emptyDiffs = 0;
      const diffHash = hash(iter.diff);
      this.diffRepeats = diffHash === this.lastDiffHash ? this.diffRepeats + 1 : 1;
      this.lastDiffHash = diffHash;
      if (this.diffRepeats >= this.limits.identical_diffs) {
        return { tripped: true, reason: "identical_diffs" };
      }
    }

    return { tripped: false };
  }
}

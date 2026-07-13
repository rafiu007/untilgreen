import { tmpdir } from "node:os";
import type { Constraints } from "@untilgreen/schema";
import type { AgentAdapter, AdapterInfo, InvocationRequest, InvocationResult } from "./adapter.js";
import { UnsupportedConstraintError } from "./adapter.js";

export type ScriptedResult =
  | Partial<InvocationResult>
  | ((req: InvocationRequest, callIndex: number) => Partial<InvocationResult>);

/**
 * Test double for the engine state machine: returns scripted results in
 * order (last one repeats) and records every request it receives. Also used
 * by `untilgreen doctor --self-test`. Honors invariants 1–5 trivially: it
 * executes nothing and decides nothing.
 */
export class FakeAdapter implements AgentAdapter {
  readonly info: AdapterInfo;
  readonly requests: InvocationRequest[] = [];
  private readonly script: ScriptedResult[];

  constructor(script: ScriptedResult[] = [], info: Partial<AdapterInfo> = {}) {
    this.script = script;
    this.info = {
      id: "fake",
      displayName: "Fake adapter (scripted)",
      binary: "true",
      testedAgentVersions: ["0.0.0"],
      requiredEnv: [],
      supportsCostReporting: true,
      ...info,
    };
  }

  validateConstraints(constraints: Constraints): void {
    if (constraints.network === false && this.info.id === "fake-no-sandbox") {
      throw new UnsupportedConstraintError(this.info.id, "network");
    }
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    const callIndex = this.requests.length;
    this.requests.push(req);
    const scripted = this.script[Math.min(callIndex, this.script.length - 1)];
    const partial = typeof scripted === "function" ? scripted(req, callIndex) : (scripted ?? {});
    return {
      outputText: "fake output",
      costUsd: 0.01,
      costUnknown: false,
      agentClaimedSuccess: true,
      ...partial,
    };
  }
}

/** Scripted workspace: yields the given diffs in order (last repeats). */
export class FakeWorkspaceProvider {
  constructor(
    private readonly diffs: string[] = ["+ fake change"],
    // a real directory: engine gates spawn with cwd = workspace path
    public readonly path = tmpdir(),
  ) {}
  cleanups: boolean[] = [];
  checkpoints = 0;

  async create() {
    const self = this;
    return {
      path: self.path,
      async checkpoint(_label: string) {
        const diff = self.diffs[Math.min(self.checkpoints, self.diffs.length - 1)] ?? "";
        self.checkpoints += 1;
        return { diff };
      },
      async cleanup(keep: boolean) {
        self.cleanups.push(keep);
      },
    };
  }
}

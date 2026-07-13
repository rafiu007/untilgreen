import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** parse repeated --input k=v flags */
export function parseInputArgs(pairs: string[]): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) throw new Error(`--input expects key=value, got "${pair}"`);
    inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return inputs;
}

export function binaryOnPath(binary: string, pathVar = process.env.PATH ?? ""): string | null {
  if (binary.includes("/")) return existsSync(binary) ? binary : null;
  for (const dir of pathVar.split(delimiter)) {
    if (dir && existsSync(join(dir, binary))) return join(dir, binary);
  }
  return null;
}

export interface ProjectGuess {
  kind: "node" | "python" | "unknown";
  gateCommand: string;
}

/** init wizard heuristic: guess the test gate from project files */
export function detectProject(dir: string): ProjectGuess {
  if (existsSync(join(dir, "package.json"))) {
    const gate = existsSync(join(dir, "pnpm-lock.yaml"))
      ? "pnpm test"
      : existsSync(join(dir, "yarn.lock"))
        ? "yarn test"
        : "npm test";
    return { kind: "node", gateCommand: gate };
  }
  if (existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "setup.py"))) {
    return { kind: "python", gateCommand: "pytest -q" };
  }
  return { kind: "unknown", gateCommand: "echo 'TODO: replace with your test command'; exit 1" };
}

export function fixTestsTemplate(gateCommand: string, agent: string): string {
  return `version: 1
name: fix-tests
inputs:
  task: { required: true }
defaults:
  agent: ${agent}
budget: { max_usd: 5, max_iterations_total: 20, timeout_minutes: 30 }
env_allowlist: [PATH, HOME]
steps:
  - id: fix
    prompt: |
      {{ inputs.task }}

      You are working in {{ workspace.path }} (iteration {{ iteration }}).
      Run nothing interactive. If a previous attempt failed, the test output
      was:
      {{ gate.output }}
    gate:
      run: ${gateCommand}
      timeout_seconds: 600
    on_pass: success
    on_fail: retry
    max_iterations: 5
`;
}

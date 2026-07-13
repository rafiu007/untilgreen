import { spawn } from "node:child_process";
import type { GateSpec } from "@untilgreen/schema";

export interface GateResult {
  pass: boolean;
  exitCode: number | null;
  /** combined stdout+stderr, last MAX_GATE_OUTPUT bytes */
  output: string;
  timedOut: boolean;
}

export const MAX_GATE_OUTPUT = 64 * 1024;

/**
 * Execute a gate command (invariant 1: the engine runs gates, nothing else
 * does). The child receives ONLY the env passed in — never process.env.
 */
export function runGate(
  gate: GateSpec,
  opts: { cwd: string; env: Record<string, string>; signal?: AbortSignal },
): Promise<GateResult> {
  const timeoutMs = (gate.timeout_seconds ?? 600) * 1000;
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", gate.run], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal: opts.signal,
    });

    let output = "";
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_GATE_OUTPUT) output = output.slice(-MAX_GATE_OUTPUT);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const passWhen = gate.pass_when ?? { exit_code: 0 };
      let pass = !timedOut;
      if (pass && passWhen.exit_code !== undefined) pass = code === passWhen.exit_code;
      if (pass && passWhen.output_matches !== undefined) {
        pass = new RegExp(passWhen.output_matches).test(output);
      }
      resolve({ pass, exitCode: code, output, timedOut });
    });
  });
}

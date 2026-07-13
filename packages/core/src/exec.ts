import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Spawn helper for adapters: explicit env only (never process.env),
 * timeout kill, AbortSignal support, prompt delivery via stdin.
 */
export function execCollect(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
    stdinText?: string;
  },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      signal: opts.signal,
    });

    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr!.on("data", (c: Buffer) => (stderr += c.toString("utf8")));

    if (opts.stdinText !== undefined) {
      child.stdin!.write(opts.stdinText);
      child.stdin!.end();
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

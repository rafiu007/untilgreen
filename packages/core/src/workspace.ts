import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Workspace {
  readonly path: string;
  /** Commit everything and return the diff of exactly this iteration. */
  checkpoint(label: string): Promise<{ diff: string }>;
  cleanup(keep: boolean): Promise<void>;
}

export interface WorkspaceProvider {
  create(): Promise<Workspace>;
}

/** Identity args so engine commits never depend on user git config. */
const GIT_ID = ["-c", "user.name=untilgreen", "-c", "user.email=engine@untilgreen.invalid"];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...GIT_ID, ...args], {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Isolation via `git worktree add` from base_ref (invariant 6). Each
 * iteration ends in a checkpoint commit so the run store can show a
 * per-iteration diff timeline.
 */
export class GitWorkspaceProvider implements WorkspaceProvider {
  constructor(
    private readonly repoRoot: string,
    private readonly opts: { baseRef?: string } = {},
  ) {}

  async create(): Promise<Workspace> {
    const dir = await mkdtemp(join(tmpdir(), "untilgreen-ws-"));
    const baseRef = this.opts.baseRef ?? "HEAD";
    await git(this.repoRoot, ["worktree", "add", "--detach", dir, baseRef]);
    const repoRoot = this.repoRoot;

    return {
      path: dir,
      async checkpoint(label: string) {
        await git(dir, ["add", "-A"]);
        // --allow-empty keeps one commit per iteration even when the agent
        // changed nothing; the empty diff is what the doom-loop brake sees.
        await git(dir, ["commit", "--allow-empty", "--no-verify", "-m", label]);
        const diff = await git(dir, ["show", "--format=", "--patch", "HEAD"]);
        return { diff };
      },
      async cleanup(keep: boolean) {
        if (keep) return;
        await git(repoRoot, ["worktree", "remove", "--force", dir]).catch(() => undefined);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  }
}

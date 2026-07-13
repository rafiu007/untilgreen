import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWorkspaceProvider } from "../src/workspace.js";

let repo: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t.invalid", ...args],
    { cwd, encoding: "utf8" },
  );
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "untilgreen-repo-"));
  git(repo, "init", "-b", "main");
  await writeFile(join(repo, "a.txt"), "hello\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "init");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("git worktree workspace", () => {
  it("creates an isolated worktree, checkpoints per iteration, and cleans up", async () => {
    const provider = new GitWorkspaceProvider(repo);
    const ws = await provider.create();
    expect(ws.path).not.toBe(repo);

    // iteration 1: a change → diff contains it
    await writeFile(join(ws.path, "a.txt"), "changed\n");
    const first = await ws.checkpoint("iter 1");
    expect(first.diff).toContain("-hello");
    expect(first.diff).toContain("+changed");

    // iteration 2: no change → empty diff (what the doom-loop brake sees)
    const second = await ws.checkpoint("iter 2");
    expect(second.diff.trim()).toBe("");

    // the main repo's working tree is untouched (isolation)
    expect(git(repo, "status", "--porcelain").trim()).toBe("");

    await ws.cleanup(false);
    expect(existsSync(ws.path)).toBe(false);
  });

  it("keeps the worktree when asked", async () => {
    const provider = new GitWorkspaceProvider(repo);
    const ws = await provider.create();
    await ws.cleanup(true);
    expect(existsSync(ws.path)).toBe(true);
    await rm(ws.path, { recursive: true, force: true });
  });

  it("creates the worktree from base_ref", async () => {
    await writeFile(join(repo, "a.txt"), "second commit\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "second");
    const provider = new GitWorkspaceProvider(repo, { baseRef: "HEAD~1" });
    const ws = await provider.create();
    const content = execFileSync("cat", [join(ws.path, "a.txt")], { encoding: "utf8" });
    expect(content).toBe("hello\n");
    await ws.cleanup(false);
  });
});

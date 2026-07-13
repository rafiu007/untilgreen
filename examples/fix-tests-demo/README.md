# fix-tests demo

The untilgreen "money demo": a repo with a seeded bug (`median` uses
JavaScript's lexicographic default sort on numbers), a failing test suite,
and a workflow that loops a coding agent until `npm test` — run by the
engine, not the agent — actually exits 0.

```bash
# from this directory
git init -b main && git add -A && git commit -m "seed"   # worktrees need a repo
npm test                     # watch it fail first

npx untilgreen run fix-tests --input task="make the failing tests pass without changing the tests"
npx untilgreen history       # per-iteration diff + gate timeline
```

What you should observe: the agent often *claims* success on an early
iteration while `npm test` still fails — the gate rejects the claim, feeds
the failure back into the next prompt, and only a genuinely green test run
ends the loop.

Requires the `claude` CLI on your PATH (or edit `defaults.agent` to `codex`).

# untilgreen

**Run your coding agent until green.**

GitHub Actions for coding agents — define the workflow once, in your repo,
run it on any agent, with machine-verified completion.

```
┌─────────────────────────────────────────────────────────────┐
│  agent: "All tests pass now! ✅"                             │
│  gate:  pnpm test → exit 1                                   │
│  engine: REJECTED. iteration 2/5, feeding failure back…      │
│  agent: (actually fixes it)                                  │
│  gate:  pnpm test → exit 0                                   │
│  engine: PASS → done.                                        │
└─────────────────────────────────────────────────────────────┘
```

Coding agents routinely claim success while tests still fail. **untilgreen**
inverts the trust model: the agent *never* decides control flow. Every step
sends one stateless prompt to an agent (Claude Code, Codex — Cursor coming),
then the engine runs a deterministic **gate** — a shell command whose exit
code (or a regex on its output) alone decides what happens next: pass, retry
with the failure fed back, jump to another step, or fail.

## Why untilgreen and not …

| | decides "done" by | runs |
|---|---|---|
| GitHub Agentic Workflows | permissions + human review of "safe outputs" | GitHub Actions cloud |
| Open SWE (LangChain) | prompting the agent to run checks | cloud sandboxes |
| OpenHands | agent autonomy | cloud platform |
| LLM-judge harnesses | another model's opinion | varies |
| **untilgreen** | **a shell command's exit code, executed by the engine** | **your machine** |

- **Deterministic gates.** `pnpm test` either exits 0 or it doesn't. No
  model judges completion, ever.
- **Local-first.** No server, no account, no Redis. SQLite for run state,
  git worktrees for isolation. `npx untilgreen init` and you're running.
- **Cross-vendor.** One YAML workflow, any agent CLI via adapters. Retry
  context flows through templates, so every invocation is a fresh,
  reproducible session.
- **Budgeted & braked.** `max_usd`, `max_iterations_total`, timeouts, and a
  doom-loop brake that halts on repeated identical failures or empty diffs
  — enforced by the engine even when the agent CLI has no such flags.

## Quick start

```bash
npx untilgreen init          # detects your project + agent CLIs, writes .untilgreen/fix-tests.yaml
npx untilgreen run fix-tests --input task="make the failing test pass"
npx untilgreen history       # per-iteration diff + gate timeline from SQLite
```

## A workflow

```yaml
# .untilgreen/fix-tests.yaml
version: 1
name: fix-tests
inputs:
  task: { required: true }
defaults:
  agent: claude-code
budget: { max_usd: 5, max_iterations_total: 20, timeout_minutes: 30 }
steps:
  - id: fix
    prompt: |
      {{ inputs.task }}

      Iteration {{ iteration }}. If a previous attempt failed, the test
      output was:
      {{ gate.output }}
    gate:
      run: pnpm test
    on_pass: success
    on_fail: retry
    max_iterations: 5
```

Five template variables (`inputs.*`, `gate.output`, `steps.<id>.gate.output`,
`iteration`, `workspace.path`), substitution only. No conditionals, no loops,
no expressions — logic lives in `on_pass` / `on_fail` routing where the
engine can see it. See [docs/workflow-spec-v1.md](docs/workflow-spec-v1.md).

## Status

Pre-0.1. The schema, engine, claude-code and codex adapters, and CLI are
under active development. See [CONSTITUTION.md](CONSTITUTION.md) for the
project's invariants and [docs/adr/](docs/adr/) for design decisions.

## Contributing

We welcome issues and PRs — see [CONTRIBUTING.md](CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)

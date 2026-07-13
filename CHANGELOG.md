# Changelog

## Unreleased (v0.1.0 in progress)

- Workflow schema v1 (JSON Schema 2020-12), validator, and linter
  (`unknown-goto`, `no-success-path`, `ungated-step`, template checks).
- Deterministic engine: substitution-only template renderer, gate runner
  with env allowlisting, routing state machine, git-worktree isolation with
  per-iteration checkpoint commits, engine-side budgets
  (max_usd / max_iterations_total / timeout), doom-loop brake, SQLite run
  store with per-iteration diff timeline.
- Adapters: claude-code (`claude -p`, verified flag surface 2026-07) and
  codex (`codex exec --json`, flag surface pending re-verification), plus a
  scripted fake adapter for tests and demos.
- CLI: `untilgreen init | run | lint | doctor | history`.
- Deferred past v0.1 (seams left): Cursor adapter, ink TUI, web UI, GitHub
  Action, llm-judge gates, parallel steps.

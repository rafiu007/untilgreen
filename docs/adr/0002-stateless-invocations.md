# ADR-0002: Stateless agent invocations

Status: accepted · Date: 2026-07-13

## Context

Both major agent CLIs persist session state by default (research, July
2026): Claude Code offers `--continue`/`--resume` and auto-discovers
CLAUDE.md, memory, hooks and MCP servers; Codex persists sessions to disk
and offers `codex exec resume`. Hidden state makes runs irreproducible and
makes retry behavior depend on invisible context.

## Decision

Every invocation is a fresh session. Retry context flows only through
rendered template variables (`{{ gate.output }}` etc.). Adapters must
actively opt out of CLI statefulness: Claude Code adapters pass `--bare`
and never pass `--continue`/`--resume`; Codex adapters pass `--ephemeral`
and `--ignore-user-config`.

## Consequences

- Reproducibility: a run record (prompts + gate outputs) fully determines
  what each invocation saw.
- Token cost is higher than a resumed conversation would be — accepted; the
  budget meter makes it visible.
- Adapters carry the burden of tracking upstream statefulness flags as CLIs
  drift (nightly smoke matrix).

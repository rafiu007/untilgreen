# ADR-0004: Plain structured console output for v0.1 (ink TUI deferred)

Status: accepted · Date: 2026-07-13

## Context

The original plan called for an ink TUI in `run` (current step, iteration,
gate tail, cost ticker). ink adds React + reconciler dependencies to the
CLI, complicates CI/pipe usage, and is presentation-only.

## Decision

v0.1 `untilgreen run` emits structured, line-oriented progress to stderr
(step, iteration, gate verdict, cost so far) and supports `--json` for
machine consumption. The renderer is an interface (`RunReporter`) so an
ink implementation can be added as a drop-in later.

## Consequences

- Works identically in terminals, CI logs, and pipes from day one.
- The TUI remains on the roadmap; nothing in core knows about rendering.

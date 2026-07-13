# ADR-0003: Project name "untilgreen"

Status: accepted · Date: 2026-07-13

## Context

The original working name `agentflow` collides with five live projects
(deep-research survey, July 2026): Flowise's AgentFlow V2 product
(`@flowiseai/agentflow`), Stanford's lupantech/AgentFlow (~2k stars, ICLR
2026 paper, agentflow.stanford.edu), lebrunel/agentflow (owns the
`@agentflow` npm scope), the aiagentflow org (same category + stack, owns
aiagentflow.dev), and 10xHub/Agentflow (PyPI `10xscale-agentflow`).

## Decision

**untilgreen** — "run your coding agent until green." Checked 2026-07-13:
npm registry returns 404 (unclaimed); GitHub repo search returns zero
name matches. It states the product's promise literally and is pronounceable,
greppable, and short enough for a CLI binary.

Runners-up that also cleared npm, kept in reserve: `gatewright`,
`stepgate`, `verigate`, `turngate`, `relaykit`.

## Consequences

- CLI binary `untilgreen`, workflow dir `.untilgreen/`, npm scope
  `@untilgreen/*`.
- Before first publish: re-verify npm/GitHub, register the npm package and
  GitHub org, claim untilgreen.dev, run a trademark knock-out search.
- If a conflict surfaces later, the name is a single grep away from
  replaceable — no product concept is embedded in it beyond the gate/green
  metaphor.

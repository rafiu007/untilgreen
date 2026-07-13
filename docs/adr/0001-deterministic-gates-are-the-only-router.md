# ADR-0001: Deterministic engine-executed gates are the only router

Status: accepted · Date: 2026-07-13

## Context

Every surveyed competitor lets something other than a deterministic check
decide completion: GitHub Agentic Workflows uses permissions + human review
(verified against official docs, July 2026); Open SWE prompts the agent to
run its own checks; OpenHands trusts agent autonomy; Aeon and the existing
`aiagentflow` use LLM judges. Agents demonstrably claim success while tests
fail.

## Decision

Routing (pass / retry / goto / fail) is decided exclusively by gate results
the engine itself executes: a shell command's exit code and/or a regex over
its output. The agent's self-assessment is recorded as telemetry
(`agentClaimedSuccess`) and never routed on. LLM-judge gates are deferred
and, if ever added, will be a distinct gate type that cannot be the only
gate on a success path.

## Consequences

- The "money demo" (agent claims done → gate rejects → loop → green) is the
  product's identity and is not reproducible by permission-based or
  prompt-based competitors.
- Gates must be cheap to run repeatedly; gate timeout and output capture are
  engine concerns.
- Some tasks without a mechanical check are a poor fit for v0.1 — accepted.

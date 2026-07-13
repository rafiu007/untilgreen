# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security
Advisories ("Report a vulnerability" on the repo's Security tab). Do not
open public issues for security reports. You should receive a response
within 72 hours.

## Scope & threat model

untilgreen executes two kinds of untrusted-ish processes on your machine:

1. **Agent CLIs** (claude, codex, …) which can edit files and run commands
   inside a git worktree.
2. **Gate commands** defined in workflow YAML.

Design guarantees you can rely on (violations are vulnerabilities):

- Gate and agent processes receive **only** the env vars named in the
  workflow's `env_allowlist` — never the full parent environment.
- Agent invocations are stateless: adapters must not resume sessions or
  inherit user-level agent config (`--bare` for Claude Code, `--ephemeral`
  + `--ignore-user-config` for Codex).
- A declared constraint an adapter cannot enforce (e.g. `network: false` on
  a platform without sandbox support) throws `UnsupportedConstraintError`
  at lint/spawn time. Silent degradation is a vulnerability.
- Workflows run in git worktrees, not your working tree; the engine never
  pushes, merges, or deletes branches on its own.

Out of scope: vulnerabilities in the agent CLIs themselves, and malicious
workflow YAML you choose to run (workflows are code; review them like code).

## Supported versions

Pre-1.0: only the latest minor release receives security fixes.

# Contributing to untilgreen

Thanks for your interest! This document covers how to get a change merged.

## Ground rules

- Read [CONSTITUTION.md](CONSTITUTION.md) first. The **non-negotiable
  invariants** section is exactly that: PRs that make the agent decide
  control flow, add logic to templates, add a server dependency, or let
  adapters silently degrade constraints will be declined regardless of code
  quality. Open a discussion if you think an invariant is wrong.
- Every behavior change needs a test. The engine state machine is tested
  against `FakeAdapter` — most changes need no real agent CLI.
- Adapter changes must update `AdapterInfo.testedAgentVersions` and pass the
  nightly smoke matrix.

## Development setup

```bash
corepack enable            # pnpm via corepack
pnpm install
pnpm build                 # tsc -b across the workspace
pnpm test                  # vitest across the workspace
pnpm lint
```

Node >= 20 required. `better-sqlite3` compiles natively on install.

## Making changes

1. Fork and branch from `main`.
2. Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
   `chore:`), scoped by package when useful: `feat(core): …`.
3. Add a changeset if the change is user-visible: `pnpm changeset`.
4. Sign off your commits (DCO): `git commit -s`. By signing off you certify
   the [Developer Certificate of Origin](https://developercertificate.org/).
5. Open the PR against `main`. CI must be green: build, test, lint on
   Node 20 and 22.

## Architecture decisions

Significant design choices are recorded as ADRs in [docs/adr/](docs/adr/).
If your PR changes an architectural decision, include a new ADR that
supersedes the old one — don't edit history.

## Releases

Maintainers release from `main` via changesets: versions are bumped
per-package, a changelog is generated, and packages are published to npm
with provenance. All packages share the `@untilgreen/*` scope except the
`untilgreen` CLI meta-package.

## Where help is most useful right now

- Exhaustive state-machine tests (routing edge cases, budget/brake
  interactions).
- Adapter smoke tests against new agent CLI releases (flags drift monthly).
- The Cursor adapter (deferred, seam exists — see constitution for its
  documented limitations).

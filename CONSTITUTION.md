# untilgreen — project constitution

> **Name status (July 2026).** Working name is **untilgreen** — "run your coding
> agent until green." Chosen after a collision survey killed the original
> `agentflow` placeholder (see § Naming). At time of writing: `untilgreen` is a
> 404 on the npm registry (unclaimed), zero GitHub repos match the name, and no
> product/trademark conflict surfaced. Re-verify npm + GitHub + a trademark
> search immediately before first publish. The name is used consistently
> (`untilgreen` CLI, `.untilgreen/` workflow dir, `@untilgreen/*` packages) —
> grep-rename if it changes.

## What this is

An open-source, deterministic control plane for coding agents. One-liner:
**GitHub Actions for coding agents — define the workflow once, in your repo,
run it on any agent, with machine-verified completion.**

Users write YAML workflows in `.untilgreen/`. Each step sends one stateless
prompt to a coding agent (Claude Code, Codex, Cursor via adapters), then the
engine runs a deterministic *gate* (shell command → exit code / regex) that
alone decides routing: pass, retry with the gate output fed back, jump, or
fail. The agent NEVER decides control flow.

## Market position (deep-research findings, verified July 2026)

A fan-out research pass (21 primary sources, 104 extracted claims, 17
adversarially verified 3-0) mapped the landscape. Summary of what it means
for this project:

**Already absorbed by vendors — do NOT pitch these as differentiators:**

- *Cross-vendor agent engines.* GitHub Agentic Workflows (gh-aw, Public
  Preview, GitHub Next + Microsoft Research) already runs Copilot, Claude
  Code, Codex, and Gemini as interchangeable engines. [verified 3-0,
  github.github.com/gh-aw]
- *Repo-versioned workflow definitions.* gh-aw workflows live in the repo as
  Markdown + YAML frontmatter, compiled to hardened Actions `.lock.yml`.
  [verified 3-0]
- *Engine-side cost budgets.* gh-aw has `max-ai-credits` hard budgets per run
  plus `gh aw logs` / `gh aw audit`.
- *"Run until verified" loops generally.* zeroshot (planner/implementer/
  validator loop), ORCH (typed todo→review→done state machine with
  auto-retry), OpenCastle ("quality gates"), ralph-harness (git hooks + CI
  verification + hard iteration/time caps) all exist. AgentSPEX (UIUC) is
  prior art for YAML agent-workflow specs. "Verification loops" is a named
  pattern in the harness-engineering community — we enter a recognized
  category, we do not create one.

**Genuinely un-absorbed — this IS the identity, defend it:**

- *Deterministic, engine-executed gates as the ONLY router.* gh-aw's safety
  model is permission-based (read-only default, "safe outputs", mandatory
  human review — never gate-routed) [verified 3-0]. Open SWE (LangChain, MIT)
  decides "done" by prompting the agent to run checks, with middleware only
  as a backstop [verified 3-0]. OpenHands is agent-autonomy-driven. Several
  competitors judge completion with an LLM (Aeon scores 1–5 via Haiku; the
  existing `aiagentflow` uses a Judge agent). Nobody ships shell-command
  exit-code/regex gates as the exclusive control-flow authority.
- *Local-first.* gh-aw is Actions-cloud-native; Open SWE is cloud-sandbox-
  first (Modal, Daytona, Runloop). Local SQLite + git worktrees + no server
  remains open ground.
- *The combination.* Deterministic gates × cross-vendor adapters ×
  local-first × pure-YAML logic-free workflows exists nowhere as one product
  (90+-entry CLI-coding-agent catalog, updated 2026-07-06, has no equivalent;
  nearest name is `claude-flow`, a swarm orchestrator).

**Supporting evidence for the thesis:** harness-only changes reportedly moved
a LangChain coding agent from rank 30 to top 5 on Terminal Bench 2.0 without
touching the model — the engine layer is a real lever. (Single source,
unverified; treat as directional.)

**Sobering datum:** the same-category, same-stack `aiagentflow` (TypeScript,
local-first, launched by mid-2026, actively maintained) has 41 stars. Being
in the right category is not distribution. See § Adoption.

## Non-negotiable invariants (do not "improve" these away)

1. **Done means verified.** Routing decisions come exclusively from gate
   results the ENGINE executes. `agentClaimedSuccess` is telemetry only.
2. **Stateless invocations.** Every agent call is a fresh session; retry
   context flows only through rendered templates ({{ gate.output }} etc.).
   No hidden conversation state. NOTE (research): both Claude Code and Codex
   persist sessions by default — adapters must actively opt out (Codex:
   `--ephemeral`; Claude Code: never pass `--continue`/`--resume`, use
   `--bare` to skip auto-discovered state like CLAUDE.md/memory/hooks).
3. **Templating has no logic.** Five variables (inputs.*, gate.output,
   steps.<id>.gate.output, iteration, workspace.path), substitution only.
   No conditionals/loops/expressions in templates — logic lives in
   on_pass/on_fail routing.
4. **Adapters execute, engine decides.** Adapters never run gates, never
   retry, never judge success. See packages/core/src/adapter.ts header
   invariants 1–5.
5. **Unenforceable constraints throw.** If an adapter can't honor e.g.
   network:false, it raises UnsupportedConstraintError at lint/spawn time —
   never silently degrades. (Research confirms this matters: Cursor's CLI
   documents no sandbox/permission granularity at all; Codex network access
   is TOML-config, not per-invocation flag.)
6. **Local-first.** No server, no Redis, no account. SQLite for run state,
   git worktrees for isolation. Zero infra is an adoption feature — and per
   the landscape scan, the un-absorbed ground.
7. **Everything is cancellable and budgeted.** Engine-side meters enforce
   max_usd / max_iterations_total / timeout even when CLIs lack native flags.
   Doom-loop brake: hash consecutive gate outputs and diffs, abort on
   repeats (defaults: 3 identical failures, 2 identical diffs, 2 empty diffs).
   NOTE (research): only Claude Code reports USD directly (`total_cost_usd`).
   Codex reports token counts only; Cursor reports neither. The budget meter
   therefore takes adapter-normalized cost, with a maintained token→USD price
   table for Codex and a documented "cost unknown ⇒ iteration/time budgets
   only" degradation for Cursor.

## Source-of-truth files (implement against them, don't rewrite)

- `docs/workflow-spec-v1.md` — execution semantics + 3 canonical examples
- `packages/schema/workflow.schema.json` — JSON Schema 2020-12 for the YAML
  (validated with ajv/dist/2020; "regex" format needs ajv-formats or
  strict:false)
- `packages/core/src/adapter.ts` — the adapter plugin contract (typechecks
  under tsc --strict)

## Stack & layout decisions (settled)

- TypeScript, Node >= 20, pnpm workspaces monorepo. License: Apache-2.0.
  (Research: TypeScript became GitHub's #1 language Aug 2025, +1M
  contributors YoY — stack is ecosystem-mainstream.)
- packages/schema  → JSON Schema + generated types, published for editor
  autocomplete
- packages/core    → engine: workflow loader/linter, step executor, gate
  evaluator, template renderer, worktree manager (git worktree add from
  base_ref, checkpoint commit per iteration), budget meter, doom-loop
  detector, SQLite run store (better-sqlite3), run timeline model, adapter
  contract
- packages/adapter-claude-code → wraps `claude -p`
- packages/adapter-codex       → wraps `codex exec --json`
- packages/cli     → `untilgreen init | run | lint | doctor | history`
- Cursor adapter, web UI, GitHub Action, llm-judge gates, parallel steps,
  ink TUI: all DEFERRED past v0.1. Leave seams, don't build them.
  (v0.1 `run` uses structured plain-console progress output; ink is a
  presentation-layer seam, see ADR-0004.)
- Distribution: npm / npx first; Bun single-binary packaging later.

## Adapter ground truth (researched July 2026 — flags drift monthly)

### Claude Code (all facts below adversarially verified 3-0 against code.claude.com/docs)

- Headless: `claude -p` / `--print`. `--output-format text|json|stream-json`.
- `--allowedTools` (camelCase) with permission-rule syntax and prefix
  matching: `Bash(git diff *)`.
- `--output-format json` payload includes `total_cost_usd` + per-model cost
  breakdown → direct max_usd metering.
- `--bare` skips auto-discovery of hooks, skills, plugins, MCP servers, auto
  memory, and CLAUDE.md; Anthropic recommends it for scripted calls.
  ⚠ FIELD-TESTED CORRECTION (2026-07-13, claude 2.1.207 on macOS): `--bare`
  also skips keychain credential discovery — subscription-authenticated CLIs
  report "Not logged in". The adapter therefore makes it opt-in
  (safe with ANTHROPIC_API_KEY auth only). Same test found keychain auth
  requires USER in the child env, so adapters declare it in requiredEnv.
  Statelessness holds regardless: --continue/--resume are never passed.
- `--permission-mode`: `dontAsk` denies everything not explicitly allowed
  (locked-down CI); `acceptEdits` auto-approves file writes + mkdir/touch/
  mv/cp but not other shell or network.
- Sessions: `--continue` / `--resume <id>`; `.session_id` in JSON output;
  lookup scoped to project dir and its git worktrees. Adapters never use
  these (invariant 2).
- Structured output: `--json-schema`, result in `structured_output` field.
  Streaming: `stream-json` + `--verbose` + `--include-partial-messages`.
- Sandbox: settings.json `sandbox` key (`enabled`, `filesystem.allowWrite/
  denyWrite/denyRead/allowRead`); macOS Seatbelt, Linux/WSL2 bubblewrap
  (+socat); NO native Windows/WSL1. Network: proxy + `allowedDomains`/
  `deniedDomains`, nothing pre-allowed; proxy does not TLS-terminate by
  default. Hard mode: `sandbox.failIfUnavailable: true`,
  `allowUnsandboxedCommands: false`. Version-gated: `sandbox.credentials`
  ≥ v2.1.187, env-var `mask` + `network.tlsTerminate` ≥ v2.1.199.
  ⇒ network:false IS enforceable for claude-code; wire it via a generated
  settings file, and raise UnsupportedConstraintError on Windows.

### Codex CLI (⚠ UNVERIFIED — verification agents died on budget; facts consistent across two primary sources but re-confirm against live docs before hardcoding)

- Headless: `codex exec`. `--json` (a.k.a. `--experimental-json` in some
  docs) → JSONL event stream: `thread.started`, `turn.started`,
  `turn.completed`, `turn.failed`, `item.*` (messages, reasoning, command
  executions, file changes, MCP calls, web searches, plan updates), `error`.
- Usage on `turn.completed`: `input_tokens`, `cached_input_tokens`,
  `output_tokens`, `reasoning_output_tokens` — TOKENS, no USD field.
  Adapter converts via price table (config-overridable).
- Sandbox: `--sandbox read-only|workspace-write|danger-full-access`
  (`-s`). Sources conflict on the default: one doc says read-only, another
  says workspace-write for version-controlled folders — TEST AT RUNTIME in
  `untilgreen doctor`. `--full-auto` is deprecated (warns). `--yolo` alias
  = danger-full-access, no approvals.
- Approvals: `--ask-for-approval` / `-a`, policy `on-request|never|
  untrusted`; TOML `approval_policy`.
- Network in workspace-write: OFF by default; `[sandbox_workspace_write]
  network_access = true` in TOML; finer control via network_proxy domain
  allowlisting. ⇒ network:false enforceable; network:true requires config
  injection (`-c key=value` repeatable inline overrides).
- Statelessness: sessions persist by default; `--ephemeral` prevents disk
  persistence (adapters MUST pass it); `--ignore-user-config` skips
  $CODEX_HOME/config.toml; `--skip-git-repo-check`. Resume exists
  (`codex exec resume --last|<id>`) — never used by adapters.
- Output capture: `-o/--output-last-message <path>`; `--output-schema
  <path>` enforces JSON Schema on final response. Model: `--model/-m`.
- ⚠ Doc location drift: openai/codex `docs/exec.md` is now a stub →
  developers.openai.com/codex/noninteractive → 308 →
  learn.chatgpt.com/docs/non-interactive-mode. Cite the final target.

### Cursor CLI (deferred adapter; facts from cursor.com/docs, unverified)

- Headless exists: `agent` command, `-p/--print` (required for output-format
  selection), `--output-format text|json|stream-json`,
  `--stream-partial-output`. Auth: `CURSOR_API_KEY`. `--force`/`--yolo`
  permits unconfirmed edits.
- json result object: `type, subtype, is_error, duration_ms,
  duration_api_ms, result, session_id, request_id` — NO cost or token
  fields. stream-json: typed events (`system` init with model/
  permissionMode, `assistant`, `tool_call` started/completed, terminal
  `result`); thinking suppressed in print mode; schema documented as
  additive-only.
- No documented sandbox granularity, no session/resume flags, no usage
  reporting ⇒ a Cursor adapter must declare cost-reporting and network
  constraints unsupported (invariant 5) and rely on engine-side iteration/
  time budgets only.

## Naming (settled by collision survey, July 2026)

`agentflow` and near-variants are unusable — every niche of the namespace is
occupied by live, maintained projects:

| Collision | What it is | Why it kills the name |
|---|---|---|
| Flowise **AgentFlow V2** | Flagship orchestration product of a major OSS platform; `@flowiseai/agentflow` npm package, actively developed | Direct product-name + npm collision |
| **lupantech/AgentFlow** | Stanford RL agent framework, ~2k stars, ICLR 2026 paper (arXiv 2510.05592), agentflow.stanford.edu | Durable academic search footprint; even has a "Verifier" module — compounds confusion with our "verified" identity |
| **lebrunel/agentflow** | TS agent framework, Apache-2.0; owns the `@agentflow` npm scope (`@agentflow/cli`, `@agentflow/core`) | npm scope squatted |
| **aiagentflow** (org + repo + aiagentflow.dev) | Local-first CLI multi-agent orchestrator, TypeScript, active May 2026 | Same category, same stack; owns the .dev domain |
| **10xHub/Agentflow** | Python multi-agent framework, PyPI `10xscale-agentflow`, v0.8.0 June 2026 | PyPI presence |

Decision: **untilgreen**. Checked 2026-07-13: npm 404 (available), 0 GitHub
name-match repos. Runner-up candidates that also cleared npm, kept in
reserve: `gatewright` (4 tiny GitHub repos, ★≤1), `stepgate`, `verigate`,
`turngate`, `relaykit`. Taken/rejected: `sluice`, `tollgate`, `agentgate`,
`gatecheck`, `greenloop`, `lockstep`, `floodgate`, `gateline`, `donegate`
(all npm 200). Before npm publish: re-check npm/GitHub, claim the
`untilgreen` npm package + GitHub org + untilgreen.dev, and run a USPTO/EUIPO
knock-out search.

## Adoption strategy (evidence-based, July 2026)

- The space is crowded and vendor-absorbing: 4.3M AI repos on GitHub, 1.1M
  using LLM SDKs (+178% YoY); GitHub's Copilot coding agent alone created
  1M+ PRs May–Sep 2025. Category membership earns nothing (`aiagentflow`:
  41 stars).
- Channels with evidence behind them: npm/npx one-liner install (OpenHands
  distributes via npm and SDK-ified; our `npx untilgreen init` is the front
  door), awesome-lists (the harness-engineering list: ~3k stars, 9
  languages, actively curated — get listed in it and in
  bradAGI/awesome-cli-coding-agents), gh CLI-extension-style low-friction
  installs (gh-aw's channel), Show HN with the money demo.
- The money demo IS the marketing: agent claims done → gate rejects → loop →
  green, as a GIF at the top of the README. It demonstrates the one thing
  research confirmed nobody else does.
- Positioning language: lead with "the agent never decides it's done" —
  differentiate from permission-based (gh-aw) and prompt-based (Open SWE)
  safety models by name.

## Operational cautions

- Agent CLI flags drift monthly — confirmed by research (Codex `--full-auto`
  deprecated; `--json` vs `--experimental-json` naming drift; exec.md docs
  moved twice). Pin AdapterInfo.testedAgentVersions; nightly CI matrix runs
  a smoke workflow against latest CLI versions; `untilgreen doctor` probes
  actual behavior (e.g. Codex default sandbox mode) instead of trusting
  docs.
- Vendors keep absorbing loop features (gh-aw absorbed budgets + cross-
  vendor + repo-versioning in one product). Identity = neutral,
  cross-vendor, LOCAL-FIRST, deterministic-gate layer. Don't couple to any
  one agent's niceties.
- Gate commands run with the workflow's env allowlist only — never inherit
  full process.env into agent or gate processes.
- Cursor adapter risk: no cost reporting at all — document loudly that
  max_usd is best-effort-zero for Cursor and iteration/time budgets carry
  the load.

## Build order for v0.1

1. packages/schema: load + validate + lint (unknown goto ids, unreachable
   success path, ungated-step warning). Golden tests = the 3 spec examples
   plus rejection tests.
2. packages/core: template renderer → gate runner → routing state machine →
   worktree manager → budget meter + brakes → SQLite run store. Unit-test
   the state machine exhaustively with a FakeAdapter (scripted results) — no
   real agent needed for 90% of tests.
3. claude-code adapter + `untilgreen doctor`.
4. CLI `run`; then `init` wizard (detect package.json / pyproject, detect
   CLIs on PATH, write .untilgreen/fix-tests.yaml).
5. codex adapter.
6. README with the money demo: agent claims done → gate rejects → loop →
   green. Record as GIF.

## Definition of done for v0.1

`npx untilgreen init && npx untilgreen run fix-tests "make the failing test
pass"` works end-to-end on a sample repo with a seeded failing test, for both
claude-code and codex adapters, staying under budget, producing a resumable
run record and a per-iteration diff timeline in SQLite.

# untilgreen workflow specification — v1

Status: source of truth for `@untilgreen/schema` and `@untilgreen/core`.
Implement against this document; changes to it require an ADR.

## 1. File location and shape

Workflows are YAML files in `.untilgreen/` at the repository root. The file
name (minus `.yaml`/`.yml`) is the workflow's invocable name unless `name`
overrides it.

Top-level keys:

```yaml
version: 1                # required, literal 1
name: fix-tests           # optional, defaults to file name
inputs: { ... }           # optional, declared workflow inputs
defaults: { ... }         # optional, per-step defaults
budget: { ... }           # optional, engine-enforced ceilings
brake: { ... }            # optional, doom-loop brake tuning
workspace: { ... }        # optional, worktree settings
env_allowlist: [ ... ]    # optional, env vars passed to agent+gate procs
steps: [ ... ]            # required, ≥ 1 step
```

### 1.1 inputs

```yaml
inputs:
  task:
    required: true          # default false
    description: what to do # optional
    default: ""             # optional; forbidden with required: true
```

Inputs are strings. They are supplied at run time
(`untilgreen run fix-tests --input task="…"`).

### 1.2 defaults

```yaml
defaults:
  agent: claude-code        # adapter id applied to steps without `agent`
  constraints: { ... }      # merged under each step's constraints
```

### 1.3 budget (engine-enforced; invariant 7)

```yaml
budget:
  max_usd: 5                # abort run when total adapter-reported cost exceeds
  max_iterations_total: 20  # across all steps
  timeout_minutes: 30       # wall clock for the whole run
```

All optional; defaults: `max_usd: 10`, `max_iterations_total: 50`,
`timeout_minutes: 60`. `max_usd` is checked after each invocation using
adapter-normalized cost. Adapters that cannot report cost contribute 0 and
MUST set `costUnknown: true` on results; the run record surfaces this.

### 1.4 brake (doom-loop detector)

```yaml
brake:
  identical_gate_failures: 3   # abort after N consecutive identical failing gate outputs
  identical_diffs: 2           # abort after N consecutive identical non-empty diffs
  empty_diffs: 2               # abort after N consecutive empty diffs
```

Those are the defaults. "Identical" means equal SHA-256 of the normalized
text (trailing whitespace stripped per line).

### 1.5 workspace

```yaml
workspace:
  base_ref: HEAD            # git ref the worktree is created from (default HEAD)
  keep: false               # keep worktree after run (default false on success, true on failure)
```

Each run executes in a fresh `git worktree` created from `base_ref`. After
every iteration the engine makes a checkpoint commit; the per-iteration diff
recorded in the run store is the diff of that commit.

### 1.6 env_allowlist

```yaml
env_allowlist: [PATH, HOME, CI]
```

Agent and gate subprocesses receive ONLY these variables (plus adapter-
required auth variables the adapter itself declares, e.g. `ANTHROPIC_API_KEY`
— declared, not inherited wholesale). Default: `[PATH, HOME]`.

## 2. Steps

```yaml
steps:
  - id: fix                     # required, unique, [a-z0-9-_]+
    agent: claude-code          # optional if defaults.agent set
    prompt: |                   # required, template (see §3)
      {{ inputs.task }}
    constraints:                # optional, adapter-enforced or throw (invariant 5)
      network: false
      max_turns: 30
      allowed_tools: ["Bash", "Read", "Edit"]
    gate:                       # optional but linted-warned if absent
      run: pnpm test            # required, /bin/sh -c command in workspace
      timeout_seconds: 600      # default 600
      pass_when:                # default { exit_code: 0 }
        exit_code: 0            # and/or:
        output_matches: "0 failing"   # ECMAScript regex on combined stdout+stderr
    on_pass: success            # next | success | goto:<id>   (default: next)
    on_fail: retry              # retry | fail | goto:<id>     (default: retry)
    max_iterations: 5           # per-step retry ceiling, default 3
```

### 2.1 Gate semantics (invariant 1)

The gate is executed by the ENGINE after the agent invocation completes,
with `cwd` = workspace path and the allowlisted env. The gate result is:

- `pass` — every condition in `pass_when` holds (`exit_code` matches AND
  `output_matches` matches, when both present).
- `fail` — otherwise. The combined output (last 64 KiB) becomes
  `{{ gate.output }}` for the next render.

A step with no `gate` is treated as `pass` unconditionally (and generates a
lint warning: `ungated-step`). The agent's own claim of success is recorded
as telemetry (`agentClaimedSuccess`) and never routed on.

### 2.2 Routing

- `on_pass: next` — proceed to the following step in file order; if this is
  the last step, the run **succeeds**.
- `on_pass: success` — the run succeeds immediately.
- `on_pass: goto:<id>` — jump to step `<id>` (iteration counter of the
  target step is NOT reset; total-iterations budget still applies).
- `on_fail: retry` — re-run the same step with `iteration + 1` and
  `{{ gate.output }}` refreshed, until `max_iterations` is reached, after
  which the run **fails** (terminal status `failed:max_iterations`).
- `on_fail: fail` — the run fails immediately.
- `on_fail: goto:<id>` — jump to step `<id>`.

Terminal statuses: `succeeded`, `failed:<reason>`, `aborted:budget_usd`,
`aborted:budget_iterations`, `aborted:timeout`, `aborted:doom_loop`,
`canceled`.

## 3. Templates (invariant 3)

Exactly five variables, `{{ … }}` substitution only:

| variable | meaning |
|---|---|
| `{{ inputs.<name> }}` | declared workflow input |
| `{{ gate.output }}` | gate output of the PREVIOUS iteration of the CURRENT step ("" on iteration 1) |
| `{{ steps.<id>.gate.output }}` | most recent gate output of another step ("" if not yet run) |
| `{{ iteration }}` | 1-based iteration counter of the current step |
| `{{ workspace.path }}` | absolute path of the run's worktree |

Unknown variables are a **render error** (the run fails at lint or spawn
time, not silently). There are no conditionals, loops, filters, or
expressions; `{{` that does not open a valid variable is a literal.

## 4. Agent invocation contract (invariants 2, 4)

Every invocation is a fresh, stateless agent session. The adapter receives
the rendered prompt, the workspace path, the constraints, and the env
allowlist — nothing else. Adapters MUST NOT: resume sessions, run gates,
retry, or interpret success. Adapters MUST throw `UnsupportedConstraintError`
for constraints they cannot enforce.

## 5. Canonical examples

### 5.1 fix-tests (retry loop)

```yaml
version: 1
name: fix-tests
inputs:
  task: { required: true }
defaults:
  agent: claude-code
budget: { max_usd: 5, max_iterations_total: 20, timeout_minutes: 30 }
env_allowlist: [PATH, HOME]
steps:
  - id: fix
    prompt: |
      {{ inputs.task }}

      You are in {{ workspace.path }}. Iteration {{ iteration }}.
      Previous test failure (empty on first attempt):
      {{ gate.output }}
    constraints: { max_turns: 30 }
    gate:
      run: pnpm test
      timeout_seconds: 600
    on_pass: success
    on_fail: retry
    max_iterations: 5
```

### 5.2 implement-then-review (two steps, jump-back)

```yaml
version: 1
name: implement-then-review
inputs:
  feature: { required: true }
defaults: { agent: claude-code }
budget: { max_usd: 8 }
steps:
  - id: implement
    prompt: |
      Implement: {{ inputs.feature }}
      Reviewer feedback from last round (empty first time):
      {{ steps.review.gate.output }}
    gate: { run: "pnpm build && pnpm test" }
    on_pass: next
    on_fail: retry
    max_iterations: 4
  - id: review
    agent: codex
    prompt: |
      Review the diff in {{ workspace.path }} for the feature
      "{{ inputs.feature }}". Write findings to review.txt.
      Exit by summarizing PASS or FAIL reasons in review.txt.
    gate:
      run: "grep -q '^PASS$' review.txt"
    on_pass: success
    on_fail: goto:implement
    max_iterations: 2
```

### 5.3 migrate-with-checkpoint (linear pipeline)

```yaml
version: 1
name: migrate-with-checkpoint
inputs:
  from: { required: true }
  to: { required: true }
steps:
  - id: codemod
    agent: claude-code
    prompt: "Migrate the codebase from {{ inputs.from }} to {{ inputs.to }}. Only mechanical changes."
    gate: { run: "pnpm lint" }
    on_pass: next
    on_fail: retry
    max_iterations: 3
  - id: typecheck
    agent: claude-code
    prompt: |
      Fix remaining type errors after the {{ inputs.from }} → {{ inputs.to }}
      migration. Compiler output:
      {{ gate.output }}
    gate: { run: "pnpm tsc --noEmit" }
    on_pass: next
    on_fail: retry
    max_iterations: 5
  - id: tests
    agent: claude-code
    prompt: |
      Make the test suite pass. Failure output:
      {{ gate.output }}
    gate: { run: "pnpm test" }
    on_pass: success
    on_fail: retry
    max_iterations: 5
```

## 6. Lint rules

| rule | severity |
|---|---|
| `unknown-goto` — `goto:<id>` references a nonexistent step | error |
| `duplicate-step-id` | error |
| `unknown-input` — template references an undeclared input | error |
| `unknown-template-variable` — not one of the five | error |
| `no-success-path` — no reachable route terminates in success | error |
| `ungated-step` — step has no gate | warning |
| `unreachable-step` — step no route can reach | warning |
| `default-forbidden-with-required` — input has both | error |

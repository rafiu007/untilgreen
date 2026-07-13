import { describe, expect, it } from "vitest";
import { parseWorkflow, WorkflowValidationError, validateWorkflow, lintWorkflow } from "../src/index.js";
import type { WorkflowSpec } from "../src/index.js";

const FIX_TESTS = `
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
`;

const IMPLEMENT_THEN_REVIEW = `
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
    gate:
      run: "grep -q '^PASS$' review.txt"
    on_pass: success
    on_fail: goto:implement
    max_iterations: 2
`;

const MIGRATE = `
version: 1
name: migrate-with-checkpoint
inputs:
  from: { required: true }
  to: { required: true }
defaults: { agent: claude-code }
steps:
  - id: codemod
    prompt: "Migrate the codebase from {{ inputs.from }} to {{ inputs.to }}. Only mechanical changes."
    gate: { run: "pnpm lint" }
    on_pass: next
    on_fail: retry
    max_iterations: 3
  - id: typecheck
    prompt: |
      Fix remaining type errors. Compiler output:
      {{ gate.output }}
    gate: { run: "pnpm tsc --noEmit" }
    on_pass: next
    on_fail: retry
    max_iterations: 5
  - id: tests
    prompt: |
      Make the test suite pass. Failure output:
      {{ gate.output }}
    gate: { run: "pnpm test" }
    on_pass: success
    on_fail: retry
    max_iterations: 5
`;

describe("golden examples from workflow-spec-v1", () => {
  it("accepts fix-tests with no issues", () => {
    const { workflow, issues } = parseWorkflow(FIX_TESTS);
    expect(workflow.name).toBe("fix-tests");
    expect(workflow.steps).toHaveLength(1);
    expect(issues).toHaveLength(0);
  });

  it("accepts implement-then-review (cross-step gate output, goto back-edge)", () => {
    const { workflow, issues } = parseWorkflow(IMPLEMENT_THEN_REVIEW);
    expect(workflow.steps.map((s) => s.id)).toEqual(["implement", "review"]);
    expect(issues).toHaveLength(0);
  });

  it("accepts migrate-with-checkpoint (linear pipeline)", () => {
    const { workflow, issues } = parseWorkflow(MIGRATE);
    expect(workflow.steps).toHaveLength(3);
    expect(issues).toHaveLength(0);
  });

  it("derives name from file name when omitted", () => {
    const { workflow } = parseWorkflow(FIX_TESTS.replace("name: fix-tests\n", ""), {
      fileName: "/repo/.untilgreen/my-flow.yaml",
    });
    expect(workflow.name).toBe("my-flow");
  });
});

describe("schema rejections", () => {
  it("rejects missing version", () => {
    expect(() => parseWorkflow(`steps: [{ id: a, prompt: hi }]`)).toThrow(WorkflowValidationError);
  });

  it("rejects version 2", () => {
    expect(() => parseWorkflow(`version: 2\nsteps: [{ id: a, prompt: hi }]`)).toThrow(/schema/);
  });

  it("rejects empty steps", () => {
    expect(() => parseWorkflow(`version: 1\nsteps: []`)).toThrow(WorkflowValidationError);
  });

  it("rejects unknown top-level keys", () => {
    const issues = validateWorkflow({ version: 1, steps: [{ id: "a", prompt: "x" }], server: "http://nope" });
    expect(issues.some((i) => i.message.includes("additional properties"))).toBe(true);
  });

  it("rejects malformed on_pass route", () => {
    expect(() =>
      parseWorkflow(`version: 1\nsteps: [{ id: a, prompt: hi, on_pass: "maybe" }]`),
    ).toThrow(WorkflowValidationError);
  });

  it("rejects invalid regex in output_matches (ajv-formats regex format)", () => {
    const issues = validateWorkflow({
      version: 1,
      steps: [{ id: "a", prompt: "x", gate: { run: "true", pass_when: { output_matches: "([" } } }],
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects YAML syntax errors", () => {
    expect(() => parseWorkflow(`version: 1\nsteps: [ {{{`)).toThrow(/YAML syntax/);
  });
});

describe("lint rules", () => {
  const base = (over: Partial<WorkflowSpec>): WorkflowSpec => ({
    version: 1,
    name: "t",
    steps: [{ id: "a", prompt: "hi", gate: { run: "true" }, on_pass: "success" }],
    ...over,
  });

  it("unknown-goto is an error", () => {
    const issues = lintWorkflow(
      base({ steps: [{ id: "a", prompt: "x", gate: { run: "true" }, on_pass: "success", on_fail: "goto:nope" }] }),
    );
    expect(issues.find((i) => i.rule === "unknown-goto")?.severity).toBe("error");
  });

  it("duplicate-step-id is an error", () => {
    const issues = lintWorkflow(
      base({
        steps: [
          { id: "a", prompt: "x", gate: { run: "true" }, on_pass: "success" },
          { id: "a", prompt: "y", gate: { run: "true" }, on_pass: "success" },
        ],
      }),
    );
    expect(issues.some((i) => i.rule === "duplicate-step-id")).toBe(true);
  });

  it("unknown-input is an error", () => {
    const issues = lintWorkflow(
      base({ steps: [{ id: "a", prompt: "{{ inputs.nope }}", gate: { run: "true" }, on_pass: "success" }] }),
    );
    expect(issues.some((i) => i.rule === "unknown-input")).toBe(true);
  });

  it("unknown-template-variable is an error (logic-free templating, invariant 3)", () => {
    // NB: "{{ if x }}" contains a space so it never parses as a variable —
    // it is literal text per spec §3, covered by the literal-braces test.
    for (const bad of ["{{ steps.b.gate.output }}", "{{ env.HOME }}", "{{ gate.exit_code }}"]) {
      const issues = lintWorkflow(
        base({ steps: [{ id: "a", prompt: bad, gate: { run: "true" }, on_pass: "success" }] }),
      );
      expect(issues.some((i) => i.rule === "unknown-template-variable"), bad).toBe(true);
    }
  });

  it("literal braces that are not valid refs are ignored", () => {
    const issues = lintWorkflow(
      base({ steps: [{ id: "a", prompt: "css: body {{ color: red; }} end", gate: { run: "true" }, on_pass: "success" }] }),
    );
    // "color:" contains ":" so it never matches the variable regex — literal.
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("ungated-step is a warning", () => {
    const issues = lintWorkflow(base({ steps: [{ id: "a", prompt: "x", on_pass: "success" }] }));
    expect(issues.find((i) => i.rule === "ungated-step")?.severity).toBe("warning");
  });

  it("no-success-path is an error", () => {
    const issues = lintWorkflow(
      base({
        steps: [
          { id: "a", prompt: "x", gate: { run: "true" }, on_pass: "goto:b", on_fail: "fail" },
          { id: "b", prompt: "y", gate: { run: "true" }, on_pass: "goto:a", on_fail: "fail" },
        ],
      }),
    );
    expect(issues.some((i) => i.rule === "no-success-path")).toBe(true);
  });

  it("unreachable-step is a warning", () => {
    const issues = lintWorkflow(
      base({
        steps: [
          { id: "a", prompt: "x", gate: { run: "true" }, on_pass: "success", on_fail: "fail" },
          { id: "orphan", prompt: "y", gate: { run: "true" }, on_pass: "success" },
        ],
      }),
    );
    expect(issues.find((i) => i.rule === "unreachable-step")?.severity).toBe("warning");
  });

  it("default-forbidden-with-required is an error", () => {
    const issues = lintWorkflow(base({ inputs: { task: { required: true, default: "x" } } }));
    expect(issues.some((i) => i.rule === "default-forbidden-with-required")).toBe(true);
  });

  it("goto targets and next-at-end both count as success paths", () => {
    const issues = lintWorkflow(
      base({
        steps: [
          { id: "a", prompt: "x", gate: { run: "true" }, on_pass: "next" },
          { id: "b", prompt: "y", gate: { run: "true" }, on_pass: "next" },
        ],
      }),
    );
    expect(issues.some((i) => i.rule === "no-success-path")).toBe(false);
  });
});

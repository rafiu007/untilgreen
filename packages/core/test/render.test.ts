import { describe, expect, it } from "vitest";
import { render, RenderError, type RenderContext } from "../src/render.js";

const ctx: RenderContext = {
  inputs: { task: "fix the tests", from: "v1" },
  gateOutput: "2 tests failed",
  stepGateOutputs: { review: "needs error handling" },
  iteration: 3,
  workspacePath: "/tmp/ws",
};

describe("render (invariant 3: substitution only)", () => {
  it("substitutes all five variables", () => {
    const out = render(
      "{{ inputs.task }} | {{ gate.output }} | {{ steps.review.gate.output }} | {{ iteration }} | {{ workspace.path }}",
      ctx,
    );
    expect(out).toBe("fix the tests | 2 tests failed | needs error handling | 3 | /tmp/ws");
  });

  it("renders empty string for steps that have not run", () => {
    expect(render("[{{ steps.other.gate.output }}]", ctx)).toBe("[]");
  });

  it("throws on unknown variable names", () => {
    expect(() => render("{{ env.HOME }}", ctx)).toThrow(RenderError);
    expect(() => render("{{ gate.exit_code }}", ctx)).toThrow(RenderError);
  });

  it("throws on undeclared inputs", () => {
    expect(() => render("{{ inputs.nope }}", ctx)).toThrow(RenderError);
  });

  it("leaves non-variable braces as literals", () => {
    expect(render("body {{ color: red; }}", ctx)).toBe("body {{ color: red; }}");
    expect(render("{{}}", ctx)).toBe("{{}}");
  });

  it("is whitespace-tolerant inside delimiters", () => {
    expect(render("{{iteration}} {{  iteration  }}", ctx)).toBe("3 3");
  });
});

import { describe, expect, it } from "vitest";
import { DoomLoopBrake } from "../src/doomloop.js";

const fail = (gateOutput: string, diff = "+ change") => ({ gatePassed: false, gateOutput, diff });
const pass = () => ({ gatePassed: true, gateOutput: "ok", diff: "+ change" });

describe("doom-loop brake (invariant 7)", () => {
  it("trips after 3 identical consecutive gate failures", () => {
    const b = new DoomLoopBrake();
    expect(b.observe(fail("same error", "+ a")).tripped).toBe(false);
    expect(b.observe(fail("same error", "+ b")).tripped).toBe(false);
    const third = b.observe(fail("same error", "+ c"));
    expect(third).toEqual({ tripped: true, reason: "identical_gate_failures" });
  });

  it("normalizes trailing whitespace before hashing", () => {
    const b = new DoomLoopBrake();
    b.observe(fail("err  \nline", "+ a"));
    b.observe(fail("err\nline  ", "+ b"));
    expect(b.observe(fail("err\nline", "+ c")).tripped).toBe(true);
  });

  it("different failures do not trip", () => {
    const b = new DoomLoopBrake();
    expect(b.observe(fail("error A", "+ a")).tripped).toBe(false);
    expect(b.observe(fail("error B", "+ b")).tripped).toBe(false);
    expect(b.observe(fail("error C", "+ c")).tripped).toBe(false);
  });

  it("trips after 2 identical consecutive non-empty diffs", () => {
    const b = new DoomLoopBrake();
    expect(b.observe(fail("error A", "+ same diff")).tripped).toBe(false);
    expect(b.observe(fail("error B", "+ same diff"))).toEqual({
      tripped: true,
      reason: "identical_diffs",
    });
  });

  it("trips after 2 consecutive empty diffs", () => {
    const b = new DoomLoopBrake();
    expect(b.observe(fail("error A", "")).tripped).toBe(false);
    expect(b.observe(fail("error B", "  \n"))).toEqual({ tripped: true, reason: "empty_diffs" });
  });

  it("a passing gate resets all counters", () => {
    const b = new DoomLoopBrake();
    b.observe(fail("same", "+ d"));
    b.observe(fail("same", "+ d2"));
    b.observe(pass());
    expect(b.observe(fail("same", "+ d3")).tripped).toBe(false);
  });

  it("respects custom limits", () => {
    const b = new DoomLoopBrake({ identical_gate_failures: 2 });
    b.observe(fail("x", "+ a"));
    expect(b.observe(fail("x", "+ b")).tripped).toBe(true);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { median } from "../src/math.js";

test("median of odd-length numeric arrays", () => {
  assert.equal(median([9, 100, 2]), 9);
});

test("median of even-length numeric arrays", () => {
  assert.equal(median([10, 2, 100, 4]), 7);
});

test("median rejects empty input", () => {
  assert.throws(() => median([]), TypeError);
});

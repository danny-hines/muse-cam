import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjusted,
  adjustment,
  colorMatrixValues,
  editSummary,
  NO_ADJUSTMENTS,
  signed,
} from "../src/edit-math.ts";

const close = (actual: number[], expected: number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) < 1e-5, `${value} ≠ ${expected[index]}`),
  );
};

test("the preview uses the camera's numbers", () => {
  // device/tests/test_edits.py checks the camera against these.
  let { exponent, matrix } = adjustment({ light: 40, contrast: -30, color: 50, warmth: 20 });
  close([exponent], [0.80107]);
  close(matrix.flat(), [
    1.159569, -0.247327, -0.024468, 0.069552,
    -0.074991, 0.963025, -0.024468, 0.067655,
    -0.074991, -0.247327, 1.161677, 0.065759,
  ]);
  ({ exponent, matrix } = adjustment({ light: -100, contrast: 100, color: -100, warmth: -100 }));
  close([exponent], [1.741101]);
  close(matrix.flat(), Array(3).fill([0.310833, 1.161846, 0.129018, -0.307868]).flat());
});

test("no adjustment is the identity filter", () => {
  const { exponent, matrix } = adjustment(NO_ADJUSTMENTS);
  assert.equal(exponent, 1);
  assert.equal(
    colorMatrixValues(matrix),
    "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0",
  );
  assert.equal(adjusted(NO_ADJUSTMENTS), false);
  assert.equal(adjusted({ ...NO_ADJUSTMENTS, warmth: -1 }), true);
});

test("an edit is summarized in a line", () => {
  const name = (id: string) => ({ "look-warm-film": "Warm Film" })[id] ?? id;
  assert.equal(
    editSummary(
      { look: "look-warm-film", light: 20, contrast: 0, color: -10, warmth: 0, from: "First Contact" },
      name,
    ),
    "From First Contact · Warm Film · Light +20 · Color −10",
  );
  assert.equal(editSummary({ look: null, ...NO_ADJUSTMENTS, from: null }, name), "No changes");
  assert.equal(signed(0), "0");
});

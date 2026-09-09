import assert from "node:assert/strict";
import { test } from "node:test";
import { focusMarker, previewPoint } from "../src/focus-geometry.ts";

const image = { width: 800, height: 480 };
test("native touch coordinates map directly into the preview", () => {
  assert.deepEqual(previewPoint({ x: 200, y: 288 }, image, image), { x: 0.25, y: 0.6 });
});
test("wide displays crop the image vertically", () => {
  assert.deepEqual(previewPoint({ x: 640, y: 0 }, { width: 1280, height: 480 }, image),
    { x: 0.5, y: 0.1875 });
});
test("tall displays crop the image horizontally", () => {
  assert.deepEqual(previewPoint({ x: 0, y: 480 }, { width: 800, height: 960 }, image),
    { x: 0.25, y: 0.5 });
});
test("marker follows the same cover transform in both directions", () => {
  for (const view of [image, { width: 1280, height: 480 }, { width: 800, height: 960 }]) {
    const tap = { x: 230, y: 280 };
    const marker = focusMarker(previewPoint(tap, view, image), view, image);
    assert.ok(Math.abs(marker.x - tap.x) < 0.001);
    assert.ok(Math.abs(marker.y - tap.y) < 0.001);
  }
});
test("out-of-bounds pointer releases clamp and edge labels stay visible", () => {
  assert.deepEqual(previewPoint({ x: -5, y: 490 }, image, image), { x: 0, y: 1 });
  assert.deepEqual(focusMarker({ x: 0, y: 1 }, image, image), { x: 65, y: 416 });
});

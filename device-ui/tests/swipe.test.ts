import assert from "node:assert/strict";
import { test } from "node:test";
import { swipeDirection } from "../src/swipe.ts";

const gesture = { dx: -120, dy: 12, elapsedMs: 220, startScale: 1, endScale: 1 };

test("a left swipe advances and a right swipe returns to the previous photo", () => {
  assert.equal(swipeDirection(gesture), "next");
  assert.equal(swipeDirection({ ...gesture, dx: 120 }), "previous");
});

test("taps, vertical drags, and long holds do not change photos", () => {
  assert.equal(swipeDirection({ ...gesture, dx: -20 }), null);
  assert.equal(swipeDirection({ ...gesture, dy: 110 }), null);
  assert.equal(swipeDirection({ ...gesture, elapsedMs: 1100 }), null);
});

test("panning a zoomed photo and finishing a pinch never change photos", () => {
  assert.equal(swipeDirection({ ...gesture, startScale: 2, endScale: 2 }), null);
  assert.equal(swipeDirection({ ...gesture, startScale: 2, endScale: 1 }), null);
  assert.equal(swipeDirection({ ...gesture, startScale: 1, endScale: 2 }), null);
});

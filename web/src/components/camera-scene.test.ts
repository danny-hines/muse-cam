import { describe, expect, it } from "vitest";

import { colorwayCycle } from "./camera-scene";

describe("colorwayCycle", () => {
  it("holds the first colorway before reprinting the next", () => {
    expect(colorwayCycle(0, 5)).toEqual({ current: 0, next: 1, progress: 0 });
    expect(colorwayCycle(3.4, 5)).toEqual({ current: 0, next: 1, progress: 0 });
    expect(colorwayCycle(4.6, 5).progress).toBeCloseTo(0.5);
  });

  it("starts the next cycle at the bottom as soon as a reprint finishes", () => {
    expect(colorwayCycle(5.799, 5)).toMatchObject({ current: 0, next: 1 });
    expect(colorwayCycle(5.799, 5).progress).toBeGreaterThan(0.99);
    expect(colorwayCycle(5.8, 5)).toEqual({ current: 1, next: 2, progress: 0 });
  });

  it("wraps around the colorways", () => {
    expect(colorwayCycle(5.8 * 4 + 1, 5)).toMatchObject({ current: 4, next: 0 });
    expect(colorwayCycle(5.8 * 5 + 1, 5)).toMatchObject({ current: 0, next: 1 });
  });
});

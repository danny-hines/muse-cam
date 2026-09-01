import { describe, expect, it } from "vitest";

import { relativeTime } from "./time";

describe("relativeTime", () => {
  const now = new Date("2026-08-31T20:00:00.000Z");

  it("formats minutes", () => {
    expect(relativeTime(new Date("2026-08-31T19:53:00.000Z"), now)).toBe("7 minutes ago");
  });

  it("formats singular hours", () => {
    expect(relativeTime(new Date("2026-08-31T19:00:00.000Z"), now)).toBe("1 hour ago");
  });
});

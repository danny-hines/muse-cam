import { describe, expect, it } from "vitest";

import { normalizeClaimCode } from "./route";

describe("claim code normalization", () => {
  it("accepts human-friendly spacing, dashes, and case", () => {
    expect(normalizeClaimCode(" abcd-2345 efgh-6789 ")).toBe("ABCD2345EFGH6789");
  });
});

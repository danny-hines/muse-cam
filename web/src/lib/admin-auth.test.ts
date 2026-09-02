import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { adminAuthIsConfigured, verifyAdminKey } from "./admin-auth";

const originalKey = process.env.ADMIN_KEY;
const originalHash = process.env.ADMIN_KEY_SHA256;
const originalSecret = process.env.ADMIN_SESSION_SECRET;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("ADMIN_KEY", originalKey);
  restore("ADMIN_KEY_SHA256", originalHash);
  restore("ADMIN_SESSION_SECRET", originalSecret);
});

describe("admin authentication", () => {
  it("validates a key without storing its plaintext value", () => {
    delete process.env.ADMIN_KEY;
    process.env.ADMIN_KEY_SHA256 = createHash("sha256").update("operator-key").digest("hex");
    process.env.ADMIN_SESSION_SECRET = "independent-cookie-secret";

    expect(adminAuthIsConfigured()).toBe(true);
    expect(verifyAdminKey("operator-key")).toBe(true);
    expect(verifyAdminKey("wrong-key")).toBe(false);
  });
});

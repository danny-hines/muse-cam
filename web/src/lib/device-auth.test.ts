import { afterEach, describe, expect, it } from "vitest";

import { authenticateDevice, DeviceAuthError, sha256 } from "./device-auth";

const originalToken = process.env.DEVICE_API_TOKEN;
const originalTokenHash = process.env.DEVICE_API_TOKEN_SHA256;
const originalDeviceId = process.env.DEVICE_ID;

afterEach(() => {
  process.env.DEVICE_API_TOKEN = originalToken;
  process.env.DEVICE_API_TOKEN_SHA256 = originalTokenHash;
  process.env.DEVICE_ID = originalDeviceId;
});

describe("device authentication", () => {
  it("authenticates against a stored token hash", () => {
    delete process.env.DEVICE_API_TOKEN;
    process.env.DEVICE_API_TOKEN_SHA256 = sha256("camera-secret");
    process.env.DEVICE_ID = "bench-camera";

    const request = new Request("https://example.test/api", {
      headers: { Authorization: "Bearer camera-secret" },
    });

    expect(authenticateDevice(request)).toEqual({ deviceId: "bench-camera" });
  });

  it("rejects an invalid token", () => {
    process.env.DEVICE_API_TOKEN = "expected";
    delete process.env.DEVICE_API_TOKEN_SHA256;

    const request = new Request("https://example.test/api", {
      headers: { Authorization: "Bearer incorrect" },
    });

    expect(() => authenticateDevice(request)).toThrow(DeviceAuthError);
  });
});

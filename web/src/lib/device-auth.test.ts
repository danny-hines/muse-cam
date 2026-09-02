import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getFleetRepository } from "./fleet";
import { authenticateDevice, DeviceAuthError, sha256 } from "./device-auth";

const originalToken = process.env.DEVICE_API_TOKEN;
const originalTokenHash = process.env.DEVICE_API_TOKEN_SHA256;
const originalDeviceId = process.env.DEVICE_ID;

afterEach(() => {
  for (const [key, value] of [
    ["DEVICE_API_TOKEN", originalToken],
    ["DEVICE_API_TOKEN_SHA256", originalTokenHash],
    ["DEVICE_ID", originalDeviceId],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("device authentication", () => {
  it("authenticates against a stored token hash", async () => {
    delete process.env.DEVICE_API_TOKEN;
    process.env.DEVICE_API_TOKEN_SHA256 = sha256("camera-secret");
    process.env.DEVICE_ID = "bench-camera";

    const request = new Request("https://example.test/api", {
      headers: { Authorization: "Bearer camera-secret" },
    });

    await expect(authenticateDevice(request)).resolves.toEqual({
      deviceId: "bench-camera",
      eventId: null,
    });
  });

  it("rejects an invalid token", async () => {
    process.env.DEVICE_API_TOKEN = "expected";
    delete process.env.DEVICE_API_TOKEN_SHA256;

    const request = new Request("https://example.test/api", {
      headers: { Authorization: "Bearer incorrect" },
    });

    await expect(authenticateDevice(request)).rejects.toThrow(DeviceAuthError);
  });

  it("authenticates and revokes an individually claimed device", async () => {
    delete process.env.DEVICE_API_TOKEN;
    delete process.env.DEVICE_API_TOKEN_SHA256;
    const token = `token-${randomUUID()}`;
    const codeHash = randomUUID();
    const repository = getFleetRepository();
    await repository.createClaim({
      id: randomUUID(),
      codeHash,
      suggestedName: "Test camera",
      eventId: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const device = await repository.claimDevice({
      codeHash,
      deviceId: randomUUID(),
      deviceName: "",
      tokenHash: sha256(token),
    });
    expect(device).not.toBeNull();
    const request = new Request("https://example.test/api", {
      headers: { Authorization: `Bearer ${token}` },
    });

    await expect(authenticateDevice(request)).resolves.toEqual({
      deviceId: device!.id,
      eventId: null,
    });
    await repository.updateDeviceStatus(device!.id, "revoked");
    await expect(authenticateDevice(request)).rejects.toThrow(DeviceAuthError);
  });
});

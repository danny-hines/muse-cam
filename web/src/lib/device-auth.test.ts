import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getFleetRepository } from "./fleet";
import { authenticateDevice, DeviceAuthError, sha256, syncConfiguredDevice } from "./device-auth";

const originalToken = process.env.DEVICE_API_TOKEN;
const originalTokenHash = process.env.DEVICE_API_TOKEN_SHA256;
const originalDeviceId = process.env.DEVICE_ID;

afterEach(() => {
  vi.unstubAllEnvs();
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
  it("lists the configured camera before its next request and respects event assignment and revocation", async () => {
    const deviceId = `legacy-${randomUUID()}`;
    const token = `legacy-token-${randomUUID()}`;
    process.env.DEVICE_ID = deviceId;
    process.env.DEVICE_API_TOKEN = token;
    delete process.env.DEVICE_API_TOKEN_SHA256;
    const repository = getFleetRepository();

    await syncConfiguredDevice();
    const device = (await repository.listDevices()).find((item) => item.id === deviceId);
    expect(device).toMatchObject({
      name: deviceId,
      tokenHash: sha256(token),
      eventId: null,
      status: "active",
      lastSeenAt: null,
    });

    const event = await repository.createEvent({
      id: randomUUID(),
      slug: randomUUID(),
      name: "Offsite",
      publishOriginals: false,
      autoShare: true,
    });
    await repository.updateDeviceEvent(deviceId, event.id);
    const request = new Request("https://example.test/api", {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expect(authenticateDevice(request)).resolves.toEqual({ deviceId, eventId: event.id });
    expect((await repository.findDeviceById(deviceId))?.lastSeenAt).toBeInstanceOf(Date);

    await repository.updateDeviceStatus(deviceId, "revoked");
    await syncConfiguredDevice();
    await expect(authenticateDevice(request)).rejects.toThrow(DeviceAuthError);
    expect((await repository.listDevices()).filter((item) => item.id === deviceId)).toHaveLength(1);
    expect(await repository.findDeviceById(deviceId)).toMatchObject({
      status: "revoked", eventId: event.id, createdAt: device!.createdAt,
    });
  });

  it("invalidates a rotated configured token without resetting the camera's settings", async () => {
    const deviceId = `legacy-${randomUUID()}`;
    process.env.DEVICE_ID = deviceId;
    delete process.env.DEVICE_API_TOKEN;
    const oldToken = `old-${randomUUID()}`;
    const newToken = `new-${randomUUID()}`;
    process.env.DEVICE_API_TOKEN_SHA256 = sha256(oldToken);
    await syncConfiguredDevice();
    const repository = getFleetRepository();
    await repository.updateDeviceStatus(deviceId, "revoked");

    process.env.DEVICE_API_TOKEN_SHA256 = sha256(newToken).toUpperCase();
    const request = (token: string) => new Request("https://example.test/api", {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expect(authenticateDevice(request(oldToken))).rejects.toThrow(DeviceAuthError);
    await expect(authenticateDevice(request(newToken))).rejects.toThrow(DeviceAuthError);
    await repository.updateDeviceStatus(deviceId, "active");
    await expect(authenticateDevice(request(newToken))).resolves.toEqual({ deviceId, eventId: null });
    await expect(authenticateDevice(request(oldToken))).rejects.toThrow(DeviceAuthError);
  });

  it("keeps the original token-only mode working without a production database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    process.env.DEVICE_API_TOKEN = "standalone-secret";
    delete process.env.DEVICE_API_TOKEN_SHA256;
    process.env.DEVICE_ID = `standalone-${randomUUID()}`;
    const request = new Request("https://example.test/api", {
      headers: { Authorization: "Bearer standalone-secret" },
    });
    await expect(authenticateDevice(request)).resolves.toEqual({
      deviceId: process.env.DEVICE_ID, eventId: null,
    });
    expect(await getFleetRepository().findDeviceById(process.env.DEVICE_ID)).toBeNull();
  });

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

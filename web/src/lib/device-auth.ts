import { createHash, timingSafeEqual } from "node:crypto";

import { getFleetRepository } from "@/lib/fleet";
import { hasPersistentDatabase } from "@/lib/repository";

export class DeviceAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 503,
  ) {
    super(message);
    this.name = "DeviceAuthError";
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function expectedTokenHash(): string | null {
  if (process.env.DEVICE_API_TOKEN_SHA256) {
    return process.env.DEVICE_API_TOKEN_SHA256.toLowerCase();
  }
  return process.env.DEVICE_API_TOKEN ? sha256(process.env.DEVICE_API_TOKEN) : null;
}

function fleetAuthIsAvailable(): boolean {
  return hasPersistentDatabase() || process.env.NODE_ENV !== "production";
}

export type AuthenticatedDevice = { deviceId: string; eventId: string | null };

function hashMatches(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

// Bring the original environment-configured camera into the same registry as
// claimed cameras, without replacing its credential or operator settings.
export async function syncConfiguredDevice(): Promise<void> {
  const tokenHash = expectedTokenHash();
  if (!tokenHash || !/^[a-f0-9]{64}$/.test(tokenHash) || !fleetAuthIsAvailable()) return;
  await getFleetRepository().syncConfiguredDevice({
    id: process.env.DEVICE_ID ?? "muse-cam-01",
    tokenHash,
  });
}

export async function authenticateDevice(request: Request): Promise<AuthenticatedDevice> {
  const expected = expectedTokenHash();
  if (!expected && !fleetAuthIsAvailable()) {
    throw new DeviceAuthError("Device authentication is not configured", 503);
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new DeviceAuthError("Invalid device credential", 401);
  const actual = sha256(token);

  if (fleetAuthIsAvailable()) {
    // Sync before looking up any credential so an old environment token cannot
    // keep authenticating from the registry after it has been rotated.
    await syncConfiguredDevice();
    const repository = getFleetRepository();
    const device = await repository.findDeviceByTokenHash(actual);
    if (device?.status === "active") {
      await repository.touchDevice(device.id);
      return { deviceId: device.id, eventId: device.eventId };
    }
  } else if (expected && hashMatches(actual, expected)) {
    return { deviceId: process.env.DEVICE_ID ?? "muse-cam-01", eventId: null };
  }

  throw new DeviceAuthError("Invalid device credential", 401);
}

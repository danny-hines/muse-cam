import { createHash, timingSafeEqual } from "node:crypto";

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

export function authenticateDevice(request: Request): { deviceId: string } {
  const expected = expectedTokenHash();
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new DeviceAuthError("Device authentication is not configured", 503);
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const actual = sha256(token);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");

  if (!token || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new DeviceAuthError("Invalid device credential", 401);
  }

  return { deviceId: process.env.DEVICE_ID ?? "muse-cam-01" };
}

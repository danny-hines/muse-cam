import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { sha256 } from "@/lib/device-auth";
import { getFleetRepository } from "@/lib/fleet";
import { hasPersistentDatabase } from "@/lib/repository";

const claimRequest = z.object({
  code: z.string().min(12).max(80),
  name: z.string().trim().min(1).max(80).optional(),
});

export function normalizeClaimCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && !hasPersistentDatabase()) {
    return apiError("Device registration is not configured", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Expected a JSON request", 400);
  }
  const parsed = claimRequest.safeParse(body);
  if (!parsed.success) return apiError("Invalid claim request", 400);

  const code = normalizeClaimCode(parsed.data.code);
  if (code.length < 12) return apiError("Invalid or expired claim code", 400);

  const token = randomBytes(32).toString("base64url");
  const device = await getFleetRepository().claimDevice({
    codeHash: sha256(code),
    deviceId: `cam_${randomUUID()}`,
    deviceName: parsed.data.name ?? "",
    tokenHash: sha256(token),
  });
  if (!device) return apiError("Invalid or expired claim code", 400);

  return Response.json(
    {
      deviceId: device.id,
      deviceName: device.name,
      eventId: device.eventId,
      token,
      serverUrl: new URL(request.url).origin,
    },
    { status: 201 },
  );
}

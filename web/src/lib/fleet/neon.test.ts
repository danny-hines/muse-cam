import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite, types } from "@electric-sql/pglite";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/device/claim/route";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { authenticateDevice, sha256 } from "@/lib/device-auth";
import { NeonFleetRepository } from "./neon";
import type { ClaimDeviceInput, CreateClaimInput } from "./types";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

describe("Neon HTTP camera registration", () => {
  let postgres: PGlite;
  const repository = new NeonFleetRepository();

  beforeAll(async () => {
    postgres = await PGlite.create();
    const migrations = new URL("../../../drizzle/", import.meta.url);
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await postgres.exec(await readFile(new URL(file, migrations), "utf8"));
    }

    // Keep the production Drizzle HTTP driver (including its unsupported
    // transaction API), but execute its SQL against isolated Postgres.
    const client = {
      query: (query: string, params: unknown[], options: { arrayMode: boolean }) =>
        postgres.query(query, params, {
          rowMode: options.arrayMode ? "array" : "object",
          parsers: { [types.TIMESTAMPTZ]: (value) => value },
        }),
    } as unknown as NeonQueryFunction<false, false>;
    vi.mocked(getDb).mockReturnValue(drizzle(client, { schema }));
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/registration");
    vi.stubEnv("DEVICE_API_TOKEN", "");
    vi.stubEnv("DEVICE_API_TOKEN_SHA256", "");
  });

  beforeEach(async () => {
    await postgres.exec("TRUNCATE devices, device_claims, events CASCADE");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await postgres?.close();
  });

  function input(overrides: Partial<ClaimDeviceInput> = {}): ClaimDeviceInput {
    return {
      codeHash: "test-code-hash",
      deviceId: randomUUID(),
      deviceName: "",
      tokenHash: randomUUID(),
      ...overrides,
    };
  }

  async function createClaim(overrides: Partial<CreateClaimInput> = {}) {
    return repository.createClaim({
      id: randomUUID(),
      codeHash: "test-code-hash",
      suggestedName: "Lobby Camera",
      eventId: null,
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    });
  }

  it("registers through the API, assigns the event, and authenticates the issued credential", async () => {
    const event = await repository.createEvent({
      id: randomUUID(), slug: "launch", name: "Launch", publishOriginals: false,
    });
    await createClaim({ codeHash: sha256("ABCD2345EFGH6789"), eventId: event.id });
    const request = () => new Request("https://camera.example/api/device/claim", {
      method: "POST",
      body: JSON.stringify({ code: "abcd-2345-efgh-6789" }),
    });

    const response = await POST(request());
    expect(response.status).toBe(201);
    const registration = await response.json();
    expect(registration).toMatchObject({
      deviceName: "Lobby Camera", eventId: event.id, serverUrl: "https://camera.example",
    });
    const device = await repository.findDeviceById(registration.deviceId);
    expect(device).toMatchObject({
      tokenHash: sha256(registration.token), status: "active",
      createdAt: expect.any(Date), updatedAt: expect.any(Date), lastSeenAt: expect.any(Date),
    });
    await expect(authenticateDevice(new Request("https://camera.example/api/device/config", {
      headers: { Authorization: `Bearer ${registration.token}` },
    }))).resolves.toEqual({ deviceId: registration.deviceId, eventId: event.id });

    expect((await POST(request())).status).toBe(400);
    expect(await repository.listDevices()).toHaveLength(1);
    expect((await repository.listClaims())[0].claimedAt).toBeInstanceOf(Date);
  });

  it.each<[string, string | null, string]>([
    ["Custom Camera", "Lobby Camera", "Custom Camera"],
    ["", null, "Muse Cam"],
    ["", "", "Muse Cam"],
  ])("chooses the name for override %j and suggestion %j", async (deviceName, suggestedName, expected) => {
    await createClaim({ suggestedName });
    expect((await repository.claimDevice(input({ deviceName })))?.name).toBe(expected);
  });

  it("rejects unknown and expired codes without creating a device or consuming the code", async () => {
    await expect(repository.claimDevice(input())).resolves.toBeNull();
    await createClaim({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(repository.claimDevice(input())).resolves.toBeNull();
    expect(await repository.listDevices()).toHaveLength(0);
    expect((await repository.listClaims())[0].claimedAt).toBeNull();
  });

  it("leaves the code usable when inserting the device fails", async () => {
    await repository.syncConfiguredDevice({ id: "existing", tokenHash: "existing-token" });
    await createClaim();
    await expect(repository.claimDevice(input({ tokenHash: "existing-token" }))).rejects.toThrow();
    expect((await repository.listClaims())[0].claimedAt).toBeNull();
    expect(await repository.listDevices()).toHaveLength(1);

    expect(await repository.claimDevice(input())).not.toBeNull();
    expect(await repository.listDevices()).toHaveLength(2);
  });

  it("keeps a renamed configured camera's name when it syncs and when its token rotates", async () => {
    await repository.syncConfiguredDevice({ id: "muse-cam-01", tokenHash: "original-token" });
    const renamed = await repository.updateDeviceName("muse-cam-01", "Seattle table");

    await repository.syncConfiguredDevice({ id: "muse-cam-01", tokenHash: "original-token" });
    expect(await repository.findDeviceById("muse-cam-01")).toMatchObject({ name: "Seattle table" });
    await repository.syncConfiguredDevice({ id: "muse-cam-01", tokenHash: "rotated-token" });
    expect(await repository.findDeviceById("muse-cam-01")).toMatchObject({
      ...renamed, tokenHash: "rotated-token", updatedAt: expect.any(Date),
    });
  });
});

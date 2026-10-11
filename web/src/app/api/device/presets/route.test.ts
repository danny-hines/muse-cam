import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { presets, surprisePreset } from "@/config/presets";
import { sha256 } from "@/lib/device-auth";
import { getFleetRepository } from "@/lib/fleet";
import { loadExampleEventStyle } from "@/test/example-event-style";
import { GET } from "./route";

vi.mock("@/lib/fleet", async () => {
  const { MemoryFleetRepository } = await import("@/lib/fleet/memory");
  const repository = new MemoryFleetRepository();
  return { getFleetRepository: () => repository };
});
vi.mock("@/lib/repository", () => ({ hasPersistentDatabase: () => false }));

const special = await loadExampleEventStyle();

beforeEach(() => {
  vi.stubEnv("DEVICE_API_TOKEN", "");
  vi.stubEnv("DEVICE_API_TOKEN_SHA256", "");
});

async function camera(presetIds: string[] | null, surpriseStyles = false) {
  const repository = getFleetRepository();
  const event = await repository.createEvent({
    id: randomUUID(), slug: randomUUID(), name: "Event", publishOriginals: false, presetIds, surpriseStyles,
  });
  const token = randomUUID();
  const codeHash = randomUUID();
  await repository.createClaim({
    id: randomUUID(), codeHash, suggestedName: null, eventId: event.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await repository.claimDevice({ codeHash, deviceId: randomUUID(), deviceName: "", tokenHash: sha256(token) });
  return token;
}

async function list(token?: string) {
  const response = await GET(new Request("https://camera.test/api/device/presets", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }));
  const body = await response.json();
  return { response, ids: body.presets?.map(({ id }: { id: string }) => id) };
}

describe("camera style list", () => {
  it("gives the default catalog to requests without a camera credential", async () => {
    const { response, ids } = await list();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(ids).toEqual(presets.map(({ id }) => id));
  });

  it("gives the default catalog to unknown credentials and events without a choice", async () => {
    expect((await list("not-a-camera")).ids).toEqual(presets.map(({ id }) => id));
    expect((await list(await camera(null))).ids).toEqual(presets.map(({ id }) => id));
  });

  it("gives a camera its event's styles", async () => {
    const token = await camera(["kid-drawing", special.id]);
    expect((await list(token)).ids).toEqual([special.id, "kid-drawing"]);
  });

  it("lists only Surprise when the server picks styles", async () => {
    const token = await camera([special.id], true);
    const response = await GET(new Request("https://camera.test/api/device/presets", {
      headers: { Authorization: `Bearer ${token}` },
    }));
    expect((await response.json()).presets).toEqual([surprisePreset]);
  });

  it("fails rather than replace the camera's cached list when events or styles can't load", async () => {
    const token = await camera([special.id]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(getFleetRepository(), "findEventById").mockRejectedValueOnce(new Error("database down"));
    expect((await list(token)).response.status).toBe(503);
    vi.spyOn(getFleetRepository(), "listEventStyles").mockRejectedValueOnce(new Error("database down"));
    expect((await list(token)).response.status).toBe(503);
    expect((await list(token)).ids).toEqual([special.id]);
  });
});

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { authenticateDevice, sha256 } from "@/lib/device-auth";
import { getFleetRepository } from "@/lib/fleet";
import { getPhotoRepository } from "@/lib/repository";
import { updateDeviceEvent, updateEventSettings } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string): never => { throw new Error(`Redirect: ${url}`); }),
}));
vi.mock("@/lib/admin-auth", () => ({ isAdminAuthenticated: vi.fn() }));
vi.mock("@/lib/fleet", async () => {
  const { MemoryFleetRepository } = await import("@/lib/fleet/memory");
  const repository = new MemoryFleetRepository();
  return { getFleetRepository: () => repository };
});
vi.mock("@/lib/repository", async () => {
  const { MemoryPhotoRepository } = await import("@/lib/repository/memory");
  const repository = new MemoryPhotoRepository();
  return { getPhotoRepository: () => repository, hasPersistentDatabase: () => false };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdminAuthenticated).mockResolvedValue(true);
  vi.stubEnv("DEVICE_API_TOKEN", "");
  vi.stubEnv("DEVICE_API_TOKEN_SHA256", "");
});

afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const repository = getFleetRepository();
  const events = await Promise.all(["Original event", "New event"].map((name) =>
    repository.createEvent({ id: randomUUID(), slug: randomUUID(), name, publishOriginals: false }),
  ));
  const codeHash = randomUUID();
  const token = randomUUID();
  await repository.createClaim({
    id: randomUUID(), codeHash, suggestedName: "Lobby camera", eventId: events[0].id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const device = await repository.claimDevice({
    codeHash, deviceId: randomUUID(), deviceName: "", tokenHash: sha256(token),
  });
  if (!device) throw new Error("Failed to set up camera");
  const form = new FormData();
  form.set("id", device.id);
  form.set("eventId", events[1].id);
  return { repository, events, device, token, form };
}

describe("camera event reassignment", () => {
  it("uses the new event with the same credential and preserves existing photos", async () => {
    const { repository, events, device, token, form } = await setup();
    const photos = getPhotoRepository();
    const photo = await photos.create({
      id: randomUUID(), captureId: randomUUID(), deviceId: device.id, eventId: events[0].id,
      presetId: "test", presetVersion: 1, capturedAtDevice: null,
    });

    await expect(updateDeviceEvent(form)).rejects.toThrow("Redirect:");

    expect(redirect).toHaveBeenCalledWith(
      `/admin?notice=${encodeURIComponent("Lobby camera assigned to New event")}`,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(await repository.findDeviceById(device.id)).toMatchObject({
      ...device, eventId: events[1].id, updatedAt: expect.any(Date),
    });
    await expect(authenticateDevice(new Request("https://example.test/api", {
      headers: { Authorization: `Bearer ${token}` },
    }))).resolves.toEqual({ deviceId: device.id, eventId: events[1].id });
    expect(await photos.findById(photo.id)).toEqual(photo);
  });

  it("allows removing an event without restoring a revoked camera", async () => {
    const { repository, device, form } = await setup();
    await repository.updateDeviceStatus(device.id, "revoked");
    form.set("eventId", "");

    await expect(updateDeviceEvent(form)).rejects.toThrow("Redirect:");

    expect(await repository.findDeviceById(device.id)).toMatchObject({
      eventId: null, status: "revoked", tokenHash: device.tokenHash,
    });
    expect(redirect).toHaveBeenCalledWith(
      `/admin?notice=${encodeURIComponent("Lobby camera is now unassigned")}`,
    );
  });

  it("requires an admin session before changing the assignment", async () => {
    const { repository, device, form } = await setup();
    vi.mocked(isAdminAuthenticated).mockResolvedValue(false);

    await expect(updateDeviceEvent(form)).rejects.toThrow("Redirect: /admin/login");

    expect(await repository.findDeviceById(device.id)).toEqual(device);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown camera", "id", "missing-camera", "Camera not found"],
    ["unknown event", "eventId", "missing-event", "Event not found"],
    ["missing camera", "id", null, "Camera and event selection are required"],
    ["missing event field", "eventId", null, "Camera and event selection are required"],
  ])("rejects %s without changing the assignment", async (_case, field, value, message) => {
    const { repository, device, form } = await setup();
    if (value === null) form.delete(field);
    else form.set(field, value);

    await expect(updateDeviceEvent(form)).rejects.toThrow("Redirect:");

    expect(redirect).toHaveBeenCalledWith(`/admin?notice=${encodeURIComponent(message)}`);
    expect(await repository.findDeviceById(device.id)).toEqual(device);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("event sharing settings", () => {
  it("saves and clears both settings without changing the event identity", async () => {
    const { repository, events } = await setup();
    const form = new FormData();
    form.set("id", events[0].id);
    form.set("autoShare", "on");
    form.set("publishOriginals", "on");
    await expect(updateEventSettings(form)).rejects.toThrow("Redirect:");
    expect(await repository.findEventById(events[0].id)).toMatchObject({
      ...events[0], autoShare: true, publishOriginals: true, updatedAt: expect.any(Date),
    });
    form.delete("autoShare");
    form.delete("publishOriginals");
    await expect(updateEventSettings(form)).rejects.toThrow("Redirect:");
    expect(await repository.findEventById(events[0].id)).toMatchObject({ autoShare: false, publishOriginals: false });
  });

  it("requires an admin session", async () => {
    const { repository, events } = await setup();
    const form = new FormData();
    form.set("id", events[0].id);
    form.set("autoShare", "on");
    vi.mocked(isAdminAuthenticated).mockResolvedValue(false);
    await expect(updateEventSettings(form)).rejects.toThrow("Redirect: /admin/login");
    expect(await repository.findEventById(events[0].id)).toEqual(events[0]);
  });
});

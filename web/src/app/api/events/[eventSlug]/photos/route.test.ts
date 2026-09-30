import { describe, expect, it, vi } from "vitest";

import { getEventBySlug, listPublishedPhotos } from "@/lib/photos";
import type { EventRecord, PublishedPhoto } from "@/lib/types";
import { GET } from "./route";

vi.mock("@/lib/photos", () => ({ getEventBySlug: vi.fn(), listPublishedPhotos: vi.fn() }));

const request = (slug: string) =>
  GET(new Request(`https://muse-cam.test/api/events/${slug}/photos`), { params: Promise.resolve({ eventSlug: slug }) });

describe("live event photos", () => {
  it("lists an event's shared photos without caching", async () => {
    const event = { id: "event", slug: "launch" } as EventRecord;
    const photo = { id: "photo", sharedAt: new Date("2026-09-30T01:00:00Z") } as PublishedPhoto;
    vi.mocked(getEventBySlug).mockResolvedValue(event);
    vi.mocked(listPublishedPhotos).mockResolvedValue([photo]);

    const response = await request("launch");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ photos: [{ id: "photo", sharedAt: "2026-09-30T01:00:00.000Z" }] });
    expect(listPublishedPhotos).toHaveBeenCalledWith(event);
  });

  it("returns 404 for an unknown event", async () => {
    vi.mocked(getEventBySlug).mockResolvedValue(null);
    expect((await request("nope")).status).toBe(404);
  });
});

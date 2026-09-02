import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MemoryFleetRepository } from "./memory";

describe("memory fleet repository", () => {
  it("claims a setup code exactly once and assigns its event", async () => {
    const repository = new MemoryFleetRepository();
    const event = await repository.createEvent({
      id: randomUUID(),
      slug: `event-${randomUUID()}`,
      name: "Launch Night",
      publishOriginals: false,
    });
    const codeHash = randomUUID();
    await repository.createClaim({
      id: randomUUID(),
      codeHash,
      suggestedName: "Lobby Camera",
      eventId: event.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await repository.claimDevice({
      codeHash,
      deviceId: randomUUID(),
      deviceName: "",
      tokenHash: randomUUID(),
    });
    const second = await repository.claimDevice({
      codeHash,
      deviceId: randomUUID(),
      deviceName: "Another Camera",
      tokenHash: randomUUID(),
    });

    expect(first?.name).toBe("Lobby Camera");
    expect(first?.eventId).toBe(event.id);
    expect(second).toBeNull();
  });

  it("rejects an expired setup code", async () => {
    const repository = new MemoryFleetRepository();
    const codeHash = randomUUID();
    await repository.createClaim({
      id: randomUUID(),
      codeHash,
      suggestedName: null,
      eventId: null,
      expiresAt: new Date(Date.now() - 1),
    });

    await expect(
      repository.claimDevice({
        codeHash,
        deviceId: randomUUID(),
        deviceName: "Camera",
        tokenHash: randomUUID(),
      }),
    ).resolves.toBeNull();
  });
});

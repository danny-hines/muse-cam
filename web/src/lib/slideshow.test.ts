import { describe, expect, it } from "vitest";

import { advance, createPlaylist, type Playlist, withArrivals } from "./slideshow";

const roll = (...ids: string[]) => ids.map((id) => ({ id }));

function play(playlist: Playlist, photos: { id: string }[], count: number, currentId: string | null = null) {
  const shown = [];
  for (let i = 0; i < count; i += 1) {
    const step = advance(playlist, photos, currentId);
    playlist = step.playlist;
    currentId = step.next?.id ?? null;
    shown.push(step.next && `${step.next.id}${step.next.fresh ? "*" : ""}`);
  }
  return { playlist, shown, currentId };
}

describe("event slideshow", () => {
  it("cycles the roll newest first and wraps around", () => {
    const photos = roll("c", "b", "a");
    expect(play(createPlaylist(photos), photos, 5).shown).toEqual(["c", "b", "a", "c", "b"]);
  });

  it("shows new photos next, in arrival order, then resumes the roll", () => {
    const { playlist, currentId } = play(createPlaylist(roll("b", "a")), roll("b", "a"), 1);
    const photos = roll("d", "c", "b", "a");
    expect(play(withArrivals(playlist, photos), photos, 4, currentId).shown).toEqual(["c*", "d*", "a", "d"]);
  });

  it("only shows a new photo as new once", () => {
    const photos = roll("b", "a");
    let playlist = withArrivals(createPlaylist(roll("a")), photos);
    playlist = withArrivals(playlist, photos);
    // The roll then skips b, which was just on screen.
    expect(play(playlist, photos, 2).shown).toEqual(["b*", "a"]);
  });

  it("drops hidden photos from the line", () => {
    let playlist = withArrivals(createPlaylist(roll("a")), roll("c", "b", "a"));
    playlist = withArrivals(playlist, roll("c", "a"));
    expect(playlist.upcoming).toEqual(["c"]);
  });

  it("waits when there are no photos and avoids repeating a lone current photo", () => {
    expect(advance(createPlaylist([]), [], null).next).toBeNull();
    expect(play(createPlaylist(roll("a")), roll("a"), 2).shown).toEqual(["a", "a"]);
    expect(advance(createPlaylist(roll("b", "a")), roll("b", "a"), "b").next).toEqual({ id: "a", fresh: false });
  });
});

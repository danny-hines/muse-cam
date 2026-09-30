// What an event slideshow shows next. New photos jump the line in the order they
// arrive; otherwise it cycles the roll newest first and wraps around.

type Identified = { id: string };

export type Playlist = {
  seen: ReadonlySet<string>;
  // New photos waiting to be shown, oldest arrival first.
  upcoming: readonly string[];
  // Where the roll left off, so it resumes there after new photos.
  lastRollId: string | null;
};

export type Slide = { id: string; fresh: boolean };

export function createPlaylist(photos: readonly Identified[]): Playlist {
  return { seen: new Set(photos.map(({ id }) => id)), upcoming: [], lastRollId: null };
}

// `photos` is newest first. Hidden or deleted photos leave the line too.
export function withArrivals(playlist: Playlist, photos: readonly Identified[]): Playlist {
  const present = new Set(photos.map(({ id }) => id));
  const arrivals = photos.filter(({ id }) => !playlist.seen.has(id)).map(({ id }) => id).reverse();
  if (arrivals.length === 0 && playlist.upcoming.every((id) => present.has(id))) return playlist;
  return {
    ...playlist,
    seen: new Set([...playlist.seen, ...arrivals]),
    upcoming: [...playlist.upcoming.filter((id) => present.has(id)), ...arrivals],
  };
}

export function advance(
  playlist: Playlist,
  photos: readonly Identified[],
  currentId: string | null,
): { playlist: Playlist; next: Slide | null } {
  const [arrival, ...rest] = playlist.upcoming;
  if (arrival) return { playlist: { ...playlist, upcoming: rest }, next: { id: arrival, fresh: true } };

  const ids = photos.map(({ id }) => id);
  if (ids.length === 0) return { playlist, next: null };
  let index = (ids.indexOf(playlist.lastRollId ?? "") + 1) % ids.length;
  if (ids[index] === currentId && ids.length > 1) index = (index + 1) % ids.length;
  return { playlist: { ...playlist, lastRollId: ids[index] }, next: { id: ids[index], fresh: false } };
}

"use client";

import { useEffect, useState } from "react";

import type { PublishedPhoto } from "@/lib/types";

// Screens and galleries at an event check for new and hidden photos this often.
export const LIVE_POLL_MS = 5_000;

export type PublishedPhotoJson = Omit<PublishedPhoto, "capturedAt" | "sharedAt"> & {
  capturedAt: string;
  sharedAt: string;
};

function revive(photo: PublishedPhotoJson): PublishedPhoto {
  return { ...photo, capturedAt: new Date(photo.capturedAt), sharedAt: new Date(photo.sharedAt) };
}

// Newest first, like the server. A failed check keeps the last list, so a screen
// that loses Wi-Fi keeps showing what it has and catches up when it reconnects.
export function useLivePhotos(eventSlug: string, initial: PublishedPhoto[]): PublishedPhoto[] {
  const [photos, setPhotos] = useState(initial);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(eventSlug)}/photos`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body: { photos: PublishedPhotoJson[] } = await response.json();
        if (active) setPhotos(body.photos.map(revive));
      } catch {
        // Offline for now; the next check tries again.
      }
    };
    const timer = setInterval(refresh, LIVE_POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [eventSlug]);
  return photos;
}

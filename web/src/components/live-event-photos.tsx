"use client";

import Link from "next/link";

import { PhotoCard } from "@/components/photo-card";
import { useLivePhotos } from "@/lib/live-photos";
import type { PublishedPhoto } from "@/lib/types";

// The event roll, kept current while the page is open.
export function LiveEventPhotos({ eventSlug, initialPhotos }: { eventSlug: string; initialPhotos: PublishedPhoto[] }) {
  const photos = useLivePhotos(eventSlug, initialPhotos);
  return (
    <section aria-labelledby="event-photos-heading">
      <div className="feed-heading">
        <div>
          <p className="section-kicker">Shared moments</p>
          <h2 id="event-photos-heading">From the event</h2>
        </div>
        <div className="feed-actions">
          <span className="feed-count">
            {photos.length} shared {photos.length === 1 ? "frame" : "frames"}
          </span>
          <Link className="slideshow-link" href={`/${eventSlug}/show`}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="2" y="3.5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8.5 7v5l4-2.5-4-2.5ZM7 17.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            Start slideshow
          </Link>
        </div>
      </div>
      {photos.length > 0 ? (
        <div className="photo-grid">
          {photos.map((photo, index) => <PhotoCard key={photo.id} photo={photo} index={index} />)}
        </div>
      ) : (
        <div className="empty-feed">
          <div>
            <strong>The event roll is still empty.</strong>
            <p>Photos shared from cameras assigned to this event will appear here.</p>
          </div>
        </div>
      )}
    </section>
  );
}

import Link from "next/link";

import { PhotoImage } from "@/components/photo-image";
import { relativeTime } from "@/lib/time";
import type { PublishedPhoto } from "@/lib/types";

export function PhotoCard({ photo, index }: { photo: PublishedPhoto; index: number }) {
  const href = `/p/${photo.publicSlug}`;

  return (
    <article className="photo-card">
      <div className="photo-frame">
        <PhotoImage
          transformedUrl={photo.imageUrl}
          originalUrl={photo.originalImageUrl}
          presetName={photo.presetName}
          href={href}
          sizes="(max-width: 620px) 100vw, (max-width: 900px) 50vw, 33vw"
          priority={index < 3}
        />
        <span className="photo-index">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <Link href={href}>
        <div className="photo-meta">
          <div>
            <p className="preset-name">{photo.presetName}</p>
            <p className="photo-origin">{photo.deviceName}</p>
          </div>
          <time className="photo-time" dateTime={photo.sharedAt.toISOString()}>
            {relativeTime(photo.sharedAt)}
          </time>
        </div>
      </Link>
    </article>
  );
}

import Image from "next/image";
import Link from "next/link";

import { relativeTime } from "@/lib/time";
import type { PublishedPhoto } from "@/lib/types";

export function PhotoCard({ photo, index }: { photo: PublishedPhoto; index: number }) {
  const isDemoSvg = photo.imageUrl.endsWith(".svg");

  return (
    <article className="photo-card">
      <Link href={`/p/${photo.publicSlug}`} aria-label={`Open ${photo.presetName} photo`}>
        <div className="photo-frame">
          <Image
            src={photo.imageUrl}
            alt={`Muse Cam photo transformed with the ${photo.presetName} preset`}
            fill
            sizes="(max-width: 620px) 100vw, (max-width: 900px) 50vw, 33vw"
            style={{ objectFit: "cover" }}
            priority={index < 3}
            unoptimized={isDemoSvg}
          />
          <span className="photo-index">{String(index + 1).padStart(2, "0")}</span>
        </div>
        <div className="photo-meta">
          <div>
            <p className="preset-name">{photo.presetName}</p>
            <p className="photo-origin">{photo.eventName ?? photo.deviceName}</p>
          </div>
          <time className="photo-time" dateTime={photo.sharedAt.toISOString()}>
            {relativeTime(photo.sharedAt)}
          </time>
        </div>
      </Link>
    </article>
  );
}

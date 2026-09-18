"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type PhotoImageProps = {
  transformedUrl: string;
  originalUrl: string | null;
  presetName: string;
  sizes: string;
  priority?: boolean;
  href?: string;
};

export function PhotoImage({ transformedUrl, originalUrl, presetName, sizes, priority, href }: PhotoImageProps) {
  const [pinned, setPinned] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [originalRequested, setOriginalRequested] = useState(false);
  const showOriginal = pinned || previewing;
  const images = (
    <>
      <Image
        src={transformedUrl}
        alt={`Muse Cam photo transformed with the ${presetName} preset`}
        aria-hidden={showOriginal}
        fill sizes={sizes} style={{ objectFit: "cover" }} priority={priority}
        unoptimized={transformedUrl.endsWith(".svg")}
      />
      {originalUrl && originalRequested ? (
        <Image
          src={originalUrl}
          alt="Original camera photo"
          aria-hidden={!showOriginal}
          fill sizes={sizes}
          style={{ objectFit: "cover", opacity: showOriginal ? 1 : 0 }}
          unoptimized={originalUrl.endsWith(".svg")}
        />
      ) : null}
    </>
  );

  return (
    <>
      {href ? <Link className="photo-image-link" href={href} aria-label={`Open ${presetName} photo`}>{images}</Link> : images}
      {originalUrl ? (
        <button
          className="original-toggle"
          type="button"
          aria-label="Show original photo"
          aria-pressed={showOriginal}
          title="Hover to preview. Tap or click to toggle the original."
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              setOriginalRequested(true);
              setPreviewing(true);
            }
          }}
          onPointerLeave={() => setPreviewing(false)}
          onPointerCancel={() => setPreviewing(false)}
          onClick={() => {
            setOriginalRequested(true);
            setPinned(!pinned);
            // A second click restores the transformed photo even while still hovered.
            setPreviewing(false);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 3v14M3 13l4-4 3 3" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Original
        </button>
      ) : null}
    </>
  );
}

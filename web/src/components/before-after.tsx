"use client";

import Image from "next/image";
import { useState } from "react";

type BeforeAfterProps = {
  transformedUrl: string;
  originalUrl: string;
  presetName: string;
};

export function BeforeAfter({ transformedUrl, originalUrl, presetName }: BeforeAfterProps) {
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div className="comparison">
      <Image
        src={showOriginal ? originalUrl : transformedUrl}
        alt={
          showOriginal
            ? "Original camera photo"
            : `Photo transformed with the ${presetName} preset`
        }
        fill
        sizes="(max-width: 900px) 100vw, 70vw"
        style={{ objectFit: "cover" }}
        priority
      />
      <div className="comparison-controls" role="group" aria-label="Choose photo version">
        <button
          type="button"
          aria-pressed={!showOriginal}
          onClick={() => setShowOriginal(false)}
        >
          Transformed
        </button>
        <button
          type="button"
          aria-pressed={showOriginal}
          onClick={() => setShowOriginal(true)}
        >
          Original
        </button>
      </div>
    </div>
  );
}

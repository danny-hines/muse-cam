"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

type PhotoViewerProps = {
  previousHref: string | null;
  nextHref: string | null;
  children: ReactNode;
};

export function PhotoViewer({ previousHref, nextHref, children }: PhotoViewerProps) {
  const router = useRouter();
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      const href = event.key === "ArrowLeft" ? previousHref : event.key === "ArrowRight" ? nextHref : null;
      if (href) {
        event.preventDefault();
        router.push(href, { scroll: false });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previousHref, nextHref, router]);

  return (
    <div className="photo-viewer">
      <div
        className="detail-image"
        onTouchStart={(event) => {
          touchStart.current = event.touches.length === 1 && !(event.target as HTMLElement).closest("button, a")
            ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
        }}
        onTouchCancel={() => { touchStart.current = null; }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start || event.touches.length || event.changedTouches.length !== 1) return;
          const dx = event.changedTouches[0].clientX - start.x;
          const dy = event.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          const href = dx < 0 ? nextHref : previousHref;
          if (href) router.push(href, { scroll: false });
        }}
      >
        {children}
      </div>
      <nav className="photo-navigation" aria-label="Photo navigation">
        {previousHref ? (
          <Link href={previousHref} scroll={false} rel="prev" aria-label="Previous photo"><span aria-hidden="true">←</span> Previous</Link>
        ) : <span aria-disabled="true"><span aria-hidden="true">←</span> Previous</span>}
        {nextHref ? (
          <Link href={nextHref} scroll={false} rel="next" aria-label="Next photo">Next <span aria-hidden="true">→</span></Link>
        ) : <span aria-disabled="true">Next <span aria-hidden="true">→</span></span>}
      </nav>
    </div>
  );
}

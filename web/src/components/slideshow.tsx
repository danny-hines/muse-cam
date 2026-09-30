"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLivePhotos } from "@/lib/live-photos";
import { advance, createPlaylist, type Playlist, type Slide, withArrivals } from "@/lib/slideshow";
import type { PublishedPhoto } from "@/lib/types";

const DWELL_MS = 8_000; // a photo from the roll
const REVEAL_MS = 2_500; // a new photo's original, before it wipes to the result
const FRESH_MS = 10_000; // a new photo after its reveal
const FADE_MS = 900; // matches .slide-leaving in styles.css
const IDLE_MS = 3_000; // controls and cursor hide after this

type ShownSlide = Slide & { key: number };

type SlideshowProps = {
  eventSlug: string;
  eventName: string;
  initialPhotos: PublishedPhoto[];
  qrSvg: string;
  galleryLabel: string;
};

function preload(url: string | null) {
  if (url) new window.Image().src = url;
}

function SlideView({ photo, slide, revealed, leaving }: {
  photo: PublishedPhoto;
  slide: ShownSlide;
  revealed: boolean;
  leaving: boolean;
}) {
  const reveal = slide.fresh && photo.originalImageUrl;
  return (
    <figure className={leaving ? "slide slide-leaving" : "slide"} aria-hidden={leaving}>
      <Image className="slide-backdrop" src={photo.imageUrl} alt="" fill sizes="100vw" unoptimized />
      <div className="slide-stage">
        {reveal ? (
          <Image
            className="slide-image"
            src={photo.originalImageUrl!}
            alt="The original photo"
            fill sizes="100vw" unoptimized priority
          />
        ) : null}
        <Image
          className={reveal ? `slide-image slide-result${revealed ? "" : " is-hidden"}` : "slide-image"}
          src={photo.imageUrl}
          alt={`${photo.presetName} photo from ${photo.deviceName}`}
          fill sizes="100vw" unoptimized priority
        />
        {reveal && !revealed ? <span className="slide-chip">The real moment</span> : null}
      </div>
      <figcaption className="slide-caption">
        {slide.fresh ? <span className="slide-badge">Just now</span> : null}
        {photo.caption ? <p key={photo.caption} className="slide-quote">{photo.caption}</p> : null}
        <p className="slide-meta">
          {photo.presetName} · {photo.deviceName}
        </p>
      </figcaption>
    </figure>
  );
}

export function Slideshow({ eventSlug, eventName, initialPhotos, qrSvg, galleryLabel }: SlideshowProps) {
  const photos = useLivePhotos(eventSlug, initialPhotos);
  const photosRef = useRef(photos);
  const [first] = useState(() => advance(createPlaylist(initialPhotos), initialPhotos, null));
  const playlist = useRef<Playlist>(first.playlist);
  const counter = useRef(0);
  const [slide, setSlide] = useState<ShownSlide | null>(first.next && { ...first.next, key: 0 });
  const slideRef = useRef(slide);
  const [previous, setPrevious] = useState<ShownSlide | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // A leaving slide may have been hidden since; keep it until its fade ends.
  const [leavingPhoto, setLeavingPhoto] = useState<PublishedPhoto | null>(null);

  const next = useCallback(() => {
    const step = advance(playlist.current, photosRef.current, slideRef.current?.id ?? null);
    playlist.current = step.playlist;
    const current = slideRef.current;
    setLeavingPhoto(current ? photosRef.current.find(({ id }) => id === current.id) ?? null : null);
    setPrevious(current);
    counter.current += 1;
    const shown = step.next && { ...step.next, key: counter.current };
    const photo = photosRef.current.find(({ id }) => id === shown?.id);
    // Set with the slide itself, so a new photo's result never flashes before its reveal.
    setRevealed(!(shown?.fresh && photo?.originalImageUrl));
    slideRef.current = shown;
    setSlide(shown);
  }, []);

  // New photos join the line; a hidden photo leaves the screen right away.
  useEffect(() => {
    photosRef.current = photos;
    playlist.current = withArrivals(playlist.current, photos);
    const current = slideRef.current;
    if (!current || !photos.some(({ id }) => id === current.id)) next();
  }, [photos, next]);

  // Each slide sets its own timer: a reveal for new photos with an original,
  // then a dwell before the next one. Preload what comes next meanwhile.
  useEffect(() => {
    if (!slide) return;
    const photo = photosRef.current.find(({ id }) => id === slide.id);
    const reveal = slide.fresh && Boolean(photo?.originalImageUrl);
    const upcoming = advance(playlist.current, photosRef.current, slide.id).next;
    const upcomingPhoto = photosRef.current.find(({ id }) => id === upcoming?.id);
    preload(upcomingPhoto?.imageUrl ?? null);
    if (upcoming?.fresh) preload(upcomingPhoto?.originalImageUrl ?? null);
    const timers = [
      reveal ? setTimeout(() => setRevealed(true), REVEAL_MS) : null,
      setTimeout(next, slide.fresh ? (reveal ? REVEAL_MS : 0) + FRESH_MS : DWELL_MS),
    ];
    return () => timers.forEach((timer) => timer && clearTimeout(timer));
  }, [slide, next]);

  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [previous]);

  // Hide the cursor and controls while nobody is using the mouse.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  // Keep the laptop awake while the slideshow is on screen.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not allowed here, such as on battery saver; the screen may still sleep.
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "f") toggleFullscreen();
      if (event.key === "ArrowRight") next();
    };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("keydown", onKey);
    };
  }, [toggleFullscreen, next]);

  const photo = slide && photos.find(({ id }) => id === slide.id);
  const [galleryHost, galleryPath = ""] = galleryLabel.split(/(?=\/)/);
  return (
    <main className={idle ? "slideshow is-idle" : "slideshow"}>
      {previous && leavingPhoto && previous.key !== slide?.key ? (
        <SlideView key={previous.key} photo={leavingPhoto} slide={previous} revealed leaving />
      ) : null}
      {slide && photo ? (
        <SlideView key={slide.key} photo={photo} slide={slide} revealed={revealed} leaving={false} />
      ) : (
        <div className="slideshow-empty">
          <p className="hero-kicker"><span className="live-dot" aria-hidden="true" />Live</p>
          <h1>{eventName}</h1>
          <p>Waiting for the first photo…</p>
        </div>
      )}
      <header className="slideshow-header">
        <p><span className="live-dot" aria-hidden="true" />Live · {eventName}</p>
        <div className="slideshow-controls">
          <button type="button" onClick={toggleFullscreen}>
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
          <Link href={`/${eventSlug}`}>Gallery</Link>
        </div>
      </header>
      <aside className="slideshow-qr" aria-label={`Find your photo at ${galleryLabel}`}>
        <strong>Find your photo</strong>
        <div className="slideshow-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        {/* Stacked to keep the card narrow: the domain, then the slug on its own line. */}
        <span>{galleryHost}</span>
        {galleryPath ? <span>{galleryPath}</span> : null}
      </aside>
    </main>
  );
}

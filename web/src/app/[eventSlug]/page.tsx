import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CameraShowcase } from "@/components/camera-showcase";
import { LiveEventPhotos } from "@/components/live-event-photos";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getEventBySlug, listPublishedPhotos } from "@/lib/photos";

type EventPageProps = { params: Promise<{ eventSlug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) return { title: "Event not found" };
  const description = `Photos from ${event.name}, captured with Muse Cam.`;
  return {
    title: event.name,
    description,
    alternates: { canonical: `/${event.slug}` },
    openGraph: { title: `${event.name} · Muse Cam`, description, url: `/${event.slug}` },
  };
}

export default async function EventPage({ params }: EventPageProps) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();
  const photos = await listPublishedPhotos(event);

  return (
    <>
      <SiteHeader />
      <main className="feed-main">
        <section className="hero event-hero camera-hero" aria-labelledby="event-title">
          <div className="camera-hero-text">
            <p className="hero-kicker">
              <span className="live-dot" aria-hidden="true" />
              The event roll
            </p>
            <h1 className="hero-title" id="event-title">{event.name}</h1>
            <p className="hero-copy">
              Your event, through a different lens. Photos captured with Muse Cam
              and transformed by <strong>Muse Image</strong>.
            </p>
          </div>
          <CameraShowcase />
        </section>
        <LiveEventPhotos eventSlug={event.slug} initialPhotos={photos} />
      </main>
      <SiteFooter />
    </>
  );
}

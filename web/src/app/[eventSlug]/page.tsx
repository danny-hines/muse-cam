import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PhotoCard } from "@/components/photo-card";
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
  const photos = await listPublishedPhotos(event.id);

  return (
    <>
      <SiteHeader />
      <main className="feed-main">
        <section className="hero event-hero" aria-labelledby="event-title">
          <div>
            <p className="hero-kicker">
              <span className="live-dot" aria-hidden="true" />
              The event roll
            </p>
            <h1 className="hero-title" id="event-title">{event.name}</h1>
          </div>
          <p className="hero-copy">
            Your event, through a different lens. Photos captured with Muse Cam
            and transformed by <strong>Muse Image</strong>.
          </p>
        </section>
        <section aria-labelledby="event-photos-heading">
          <div className="feed-heading">
            <div>
              <p className="section-kicker">Shared moments</p>
              <h2 id="event-photos-heading">From the event</h2>
            </div>
            <span className="feed-count">
              {photos.length} shared {photos.length === 1 ? "frame" : "frames"}
            </span>
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
      </main>
      <SiteFooter />
    </>
  );
}

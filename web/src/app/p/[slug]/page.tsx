import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PhotoImage } from "@/components/photo-image";
import { PhotoViewer } from "@/components/photo-viewer";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getPublishedPhotoBySlug, getPublishedPhotoNeighbors } from "@/lib/photos";
import { fullTimestamp } from "@/lib/time";

type PhotoPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ gallery?: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PhotoPageProps): Promise<Metadata> {
  const { slug } = await params;
  const photo = await getPublishedPhotoBySlug(slug);

  if (!photo) {
    return { title: "Photo not found" };
  }

  return {
    title: photo.presetName,
    description: photo.presetDescription,
    openGraph: {
      title: `${photo.presetName} · Muse Cam`,
      description: photo.presetDescription,
      images: [{ url: photo.imageUrl, width: photo.width, height: photo.height }],
    },
  };
}

export default async function PhotoPage({ params, searchParams }: PhotoPageProps) {
  const { slug } = await params;
  const photo = await getPublishedPhotoBySlug(slug);

  if (!photo) {
    notFound();
  }

  const inEvent = (await searchParams).gallery !== "roll" && Boolean(photo.eventSlug);
  const neighbors = await getPublishedPhotoNeighbors(slug, inEvent);
  const photoHref = (neighborSlug: string | null) => neighborSlug
    ? `/p/${neighborSlug}${inEvent ? "" : "?gallery=roll"}` : null;

  return (
    <>
      <SiteHeader />
      <main className="detail-main">
        <Link className="back-link" href={inEvent ? `/${photo.eventSlug}` : "/"}>
          <span aria-hidden="true">←</span> {inEvent ? `Back to ${photo.eventName}` : "Back to the roll"}
        </Link>
        <div className="detail-layout">
          <PhotoViewer key={photo.id} previousHref={photoHref(neighbors.previousSlug)} nextHref={photoHref(neighbors.nextSlug)}>
            <PhotoImage
              transformedUrl={photo.imageUrl}
              originalUrl={photo.originalImageUrl}
              presetName={photo.presetName}
              sizes="(max-width: 900px) 100vw, 70vw"
              priority
            />
          </PhotoViewer>
          <aside className="detail-copy">
            <p className="section-kicker">Preset</p>
            <h1>{photo.presetName}</h1>
            <p>{photo.presetDescription}</p>
            <hr className="detail-rule" />
            <dl className="detail-facts">
              <div className="detail-fact">
                <dt>Captured</dt>
                <dd>{fullTimestamp(photo.capturedAt)}</dd>
              </div>
              <div className="detail-fact">
                <dt>Camera</dt>
                <dd>{photo.deviceName}</dd>
              </div>
              {photo.eventName ? (
                <div className="detail-fact">
                  <dt>Event</dt>
                  <dd>
                    {photo.eventSlug ? <Link href={`/${photo.eventSlug}`}>{photo.eventName}</Link> : photo.eventName}
                  </dd>
                </div>
              ) : null}
              <div className="detail-fact">
                <dt>Model</dt>
                <dd>Muse Image</dd>
              </div>
            </dl>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

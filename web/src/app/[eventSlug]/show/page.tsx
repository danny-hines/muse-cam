import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { Slideshow } from "@/components/slideshow";
import { getEventBySlug, listPublishedPhotos } from "@/lib/photos";
import { getSiteUrl } from "@/lib/site-url";

type SlideshowPageProps = { params: Promise<{ eventSlug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: SlideshowPageProps): Promise<Metadata> {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  return { title: event ? `${event.name} slideshow` : "Event not found", robots: { index: false } };
}

export default async function SlideshowPage({ params }: SlideshowPageProps) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();
  const photos = await listPublishedPhotos(event);

  // Point the QR code at the address this screen loaded, so it matches the
  // domain guests see rather than the deployment's fallback URL.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? getSiteUrl().host;
  const protocol = requestHeaders.get("x-forwarded-proto") ?? getSiteUrl().protocol.replace(":", "");
  const qrSvg = await QRCode.toString(`${protocol}://${host}/${event.slug}`, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#171713", light: "#ffffff" },
  });

  return (
    <Slideshow
      eventSlug={event.slug}
      eventName={event.name}
      initialPhotos={photos}
      qrSvg={qrSvg}
      galleryLabel={`${host.replace(/^www\./, "")}/${event.slug}`}
    />
  );
}

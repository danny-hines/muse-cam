import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getPublishedPhotoBySlug } from "@/lib/photos";
import { fullTimestamp } from "@/lib/time";

type PhotoPageProps = {
  params: Promise<{ slug: string }>;
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

export default async function PhotoPage({ params }: PhotoPageProps) {
  const { slug } = await params;
  const photo = await getPublishedPhotoBySlug(slug);

  if (!photo) {
    notFound();
  }

  return (
    <>
      <SiteHeader />
      <main className="detail-main">
        <Link className="back-link" href="/">
          <span aria-hidden="true">←</span> Back to the roll
        </Link>
        <div className="detail-layout">
          <div className="detail-image">
            <Image
              src={photo.imageUrl}
              alt={`Muse Cam photo transformed with the ${photo.presetName} preset`}
              fill
              sizes="(max-width: 900px) 100vw, 70vw"
              style={{ objectFit: "cover" }}
              priority
              unoptimized={photo.imageUrl.endsWith(".svg")}
            />
          </div>
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
                <dd>Muse Cam 01</dd>
              </div>
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

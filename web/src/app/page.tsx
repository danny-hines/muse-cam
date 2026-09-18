import { PhotoCard } from "@/components/photo-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { listPublishedPhotos } from "@/lib/photos";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const photos = await listPublishedPhotos();

  return (
    <>
      <SiteHeader />
      <main className="feed-main">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <p className="hero-kicker">
              <span className="live-dot" aria-hidden="true" />
              A live feed from physical cameras
            </p>
            <h1 className="hero-title" id="hero-title">
              Point. Shoot. <span>Imagine.</span>
            </h1>
          </div>
          <p className="hero-copy">
            A small camera with a very strange roll of film. Every picture is transformed by
            <strong> Muse Image</strong> into a world that did not exist a moment ago.
          </p>
        </section>

        <section aria-labelledby="latest-heading">
          <div className="feed-heading">
            <div>
              <p className="section-kicker">Public roll</p>
              <h2 id="latest-heading">Latest sightings</h2>
            </div>
            <span className="feed-count">
              {photos.length} shared {photos.length === 1 ? "frame" : "frames"}
            </span>
          </div>

          {photos.length > 0 ? (
            <div className="photo-grid">
              {photos.map((photo, index) => (
                <PhotoCard key={photo.id} photo={photo} index={index} gallery="roll" />
              ))}
            </div>
          ) : (
            <div className="empty-feed">
              <div>
                <strong>The roll is still empty.</strong>
                <p>The next photo shared from the camera will appear here automatically.</p>
              </div>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

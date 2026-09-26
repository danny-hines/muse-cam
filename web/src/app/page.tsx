import Form from "next/form";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { eventSlugFromInput } from "@/lib/event-slug";
import { getEventBySlug } from "@/lib/photos";
import { getSiteUrl } from "@/lib/site-url";

type HomePageProps = { searchParams: Promise<{ event?: string | string[] }> };

export default async function HomePage({ searchParams }: HomePageProps) {
  const requested = [(await searchParams).event].flat()[0]?.trim() ?? "";
  const slug = eventSlugFromInput(requested);
  const event = slug ? await getEventBySlug(slug) : null;
  if (event) redirect(`/${event.slug}`);
  const notFound = requested !== "";
  // Show the domain the visitor used, which matches the URL on the event sign.
  const host = ((await headers()).get("host") ?? getSiteUrl().host).replace(/^www\./, "");

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

        <section className="event-finder" aria-labelledby="event-finder-title">
          <div className="event-finder-copy">
            <p className="section-kicker">Find your photos</p>
            <h2 id="event-finder-title">Enter your event code</h2>
            <p>Look for the code on the sign next to the camera.</p>
          </div>
          <Form action="/" className="event-finder-form">
            <label htmlFor="event-code">Event code</label>
            <div className="event-finder-field">
              <span className="event-finder-prefix" aria-hidden="true">{host}/</span>
              <input
                id="event-code"
                name="event"
                placeholder="your-event"
                defaultValue={requested}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                required
                aria-invalid={notFound || undefined}
                aria-describedby={notFound ? "event-code-error" : undefined}
              />
            </div>
            <button type="submit">
              See the photos <span aria-hidden="true">→</span>
            </button>
            {notFound ? (
              <p className="form-error" id="event-code-error" role="alert">
                We couldn’t find an event called “{requested}”. Check the sign and try again.
              </p>
            ) : null}
          </Form>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

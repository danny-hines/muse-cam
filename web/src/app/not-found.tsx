import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="detail-main">
        <div className="empty-feed">
          <div>
            <strong>That frame is missing.</strong>
            <p>It may have been removed from the public roll.</p>
            <p>
              <Link className="back-link" href="/">
                ← Return to the camera roll
              </Link>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

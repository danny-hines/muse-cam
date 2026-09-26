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
            <p>The event or photo may have been renamed or removed.</p>
            <p>
              <Link className="back-link" href="/">
                ← Enter an event code
              </Link>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

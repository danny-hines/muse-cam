import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Muse Cam home">
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-lens" />
        </span>
        <span>Muse Cam</span>
      </Link>
      <div className="powered-by">
        <span className="powered-dot" aria-hidden="true" />
        <span>Powered by Meta Model API</span>
      </div>
    </header>
  );
}

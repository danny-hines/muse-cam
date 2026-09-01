const localSiteUrl = "http://localhost:3000";

function withProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function getSiteUrl(): URL {
  const candidate =
    process.env.SITE_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim();

  if (!candidate) {
    return new URL(localSiteUrl);
  }

  try {
    return new URL(withProtocol(candidate));
  } catch {
    return new URL(localSiteUrl);
  }
}

import { afterEach, describe, expect, it } from "vitest";

import { getSiteUrl } from "./site-url";

const originalSiteUrl = process.env.SITE_URL;
const originalProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const originalDeploymentUrl = process.env.VERCEL_URL;

afterEach(() => {
  process.env.SITE_URL = originalSiteUrl;
  process.env.VERCEL_PROJECT_PRODUCTION_URL = originalProductionUrl;
  process.env.VERCEL_URL = originalDeploymentUrl;
});

describe("getSiteUrl", () => {
  it("uses the configured site URL", () => {
    process.env.SITE_URL = "https://camera.example.com";

    expect(getSiteUrl().href).toBe("https://camera.example.com/");
  });

  it("ignores an empty site URL and uses the Vercel production hostname", () => {
    process.env.SITE_URL = "";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "muse-cam.vercel.app";

    expect(getSiteUrl().href).toBe("https://muse-cam.vercel.app/");
  });

  it("falls back safely when no deployment URL exists", () => {
    delete process.env.SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;

    expect(getSiteUrl().href).toBe("http://localhost:3000/");
  });
});

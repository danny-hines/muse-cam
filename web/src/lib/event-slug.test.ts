import { expect, it } from "vitest";

import { eventSlugFromInput, toEventSlug } from "./event-slug";

it.each([
  ["Seattle Launch!", "seattle-launch"],
  ["  sei-nyc ", "sei-nyc"],
  ["--Social AILW--", "social-ailw"],
])("normalizes %j to %j", (value, slug) => {
  expect(toEventSlug(value)).toBe(slug);
});

it.each([
  ["sei-nyc", "sei-nyc"],
  ["SEI NYC", "sei-nyc"],
  ["/social-ailw/", "social-ailw"],
  ["https://muse-cam.com/sei-nyc", "sei-nyc"],
  ["muse-cam.com/sei-nyc?utm_source=sign#top", "sei-nyc"],
  ["   ", ""],
])("reads the event code from %j", (value, slug) => {
  expect(eventSlugFromInput(value)).toBe(slug);
});

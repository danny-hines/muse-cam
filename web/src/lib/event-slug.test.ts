import { expect, it } from "vitest";

import { eventSlugFromInput, toEventSlug } from "./event-slug";

it.each([
  ["Austin Launch!", "austin-launch"],
  ["  team-nyc ", "team-nyc"],
  ["--Summer Social--", "summer-social"],
])("normalizes %j to %j", (value, slug) => {
  expect(toEventSlug(value)).toBe(slug);
});

it.each([
  ["team-nyc", "team-nyc"],
  ["Team NYC", "team-nyc"],
  ["/summer-social/", "summer-social"],
  ["https://muse-cam.com/team-nyc", "team-nyc"],
  ["muse-cam.com/team-nyc?utm_source=sign#top", "team-nyc"],
  ["   ", ""],
])("reads the event code from %j", (value, slug) => {
  expect(eventSlugFromInput(value)).toBe(slug);
});

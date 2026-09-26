export function toEventSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Attendees may type the code from the sign or paste the whole gallery URL.
export function eventSlugFromInput(value: string): string {
  const path = value.split(/[?#]/)[0];
  return toEventSlug(path.split("/").filter(Boolean).pop() ?? "");
}

const units = [
  { limit: 60, divisor: 1, unit: "second" },
  { limit: 3_600, divisor: 60, unit: "minute" },
  { limit: 86_400, divisor: 3_600, unit: "hour" },
  { limit: 604_800, divisor: 86_400, unit: "day" },
  { limit: Number.POSITIVE_INFINITY, divisor: 604_800, unit: "week" },
] as const;

export function relativeTime(date: Date, now = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1_000));
  const selected = units.find(({ limit }) => seconds < limit) ?? units.at(-1)!;
  const value = Math.max(1, Math.floor(seconds / selected.divisor));
  return `${value} ${selected.unit}${value === 1 ? "" : "s"} ago`;
}

export function fullTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

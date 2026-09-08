const paths = {
  camera: "M4 7h4l2-3h4l2 3h4v13H4z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  gallery: "M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M15 8h.01",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  close: "M6 6l12 12 M18 6L6 18",
  wifi: "M3 8a15 15 0 0 1 18 0 M6 12a10 10 0 0 1 12 0 M9 16a5 5 0 0 1 6 0 M12 20h.01",
  volume: "M4 9h4l5-4v14l-5-4H4z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14",
  mute: "M4 9h4l5-4v14l-5-4H4z M17 9l5 6 M22 9l-5 6",
  check: "M5 12l4 4L19 6",
  retry: "M4 10a8 8 0 1 1 2 8 M4 4v6h6",
  spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  share: "M12 15V3 M7 8l5-5 5 5 M5 13v7h14v-7",
  storage: "M4 5h16v14H4z M4 14h16 M8 17h.01 M11 17h.01",
  battery: "M3 7h16v10H3z M21 10v4 M6 10v4 M9 10v4 M12 10v4",
  update: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2",
};
export function Icon({
  name,
  size = 22,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

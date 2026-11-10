// The adjustment math from device/src/musecam/edits.py, so the editor's preview
// matches the photo the camera saves. Both test against the same numbers.
export type Adjustments = {
  light: number;
  contrast: number;
  color: number;
  warmth: number;
};
export type EditRecipe = Adjustments & {
  look: string | null;
  // The name of the version the edit started from; null for the original.
  from?: string | null;
};
export const ADJUSTMENTS = [
  { key: "light", label: "Light" },
  { key: "contrast", label: "Contrast" },
  { key: "color", label: "Color" },
  { key: "warmth", label: "Warmth" },
] as const;
export const NO_ADJUSTMENTS: Adjustments = { light: 0, contrast: 0, color: 0, warmth: 0 };
const LUMA = [0.2126, 0.7152, 0.0722];

export const adjusted = (values: Adjustments) =>
  ADJUSTMENTS.some(({ key }) => values[key] !== 0);

// The light curve's exponent and a 3 × 4 matrix (0–1 values) for the rest.
export function adjustment(values: Adjustments) {
  const exponent = 2 ** ((-0.8 * values.light) / 100);
  const slope = 2 ** ((0.7 * values.contrast) / 100);
  const warmth = (0.1 * values.warmth) / 100;
  const gains = [1 + warmth, 1, 1 - warmth];
  const color = values.color / 100;
  const saturation = color < 0 ? 1 + color : 1 + 0.8 * color;
  const matrix = [0, 1, 2].map((row) => {
    const mix = [0, 1, 2].map(
      (col) => (1 - saturation) * LUMA[col] + (col === row ? saturation : 0),
    );
    return [
      ...mix.map((value, col) => value * gains[col] * slope),
      mix.reduce((sum, value, col) => sum + value * gains[col] * 0.5 * (1 - slope), 0),
    ];
  });
  return { exponent, matrix };
}

// An SVG feColorMatrix's 4 × 5 values, leaving alpha alone.
export function colorMatrixValues(matrix: number[][]) {
  return [...matrix.map(([r, g, b, offset]) => [r, g, b, 0, offset]), [0, 0, 0, 1, 0]]
    .map((row) => row.map((value) => Number(value.toFixed(6))).join(" "))
    .join(" ");
}

export const signed = (value: number) =>
  value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0";

// "From First Contact · Warm Film · Light +20 · Color −10"
export function editSummary(edit: EditRecipe, lookName: (id: string) => string) {
  const parts = [
    edit.from ? `From ${edit.from}` : "",
    edit.look ? lookName(edit.look) : "",
    ...ADJUSTMENTS.filter(({ key }) => edit[key]).map(
      ({ key, label }) => `${label} ${signed(edit[key])}`,
    ),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No changes";
}

import { z } from "zod";

const presetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  hue: z.number().min(0).max(360),
  prompt: z.string().min(24),
});

export type Preset = z.infer<typeof presetSchema>;

const preservationPrompt =
  "Preserve the main subject, recognizable identity, pose, composition, camera angle, and important scene geometry. Apply the requested aesthetic consistently across the image. Do not add captions, logos, borders, signatures, or watermarks.";

export const presets: Preset[] = z.array(presetSchema).parse([
  {
    id: "post-apocalypse",
    version: 3,
    name: "After the End",
    description: "A quiet world reclaimed by nature: weathered buildings, greenery, and amber light.",
    accent: "#ff6c51",
    hue: 18,
    prompt: `Restyle the supplied photograph as a peaceful, long-abandoned retro-future world reclaimed by nature. Age the existing buildings, furniture, and objects with faded paint, worn surfaces, a little dust, and creeping greenery. Use warm amber sunlight, muted earth tones, and cinematic film texture. Keep the scene calm and habitable. Keep any people and animals healthy and relaxed, with their appearance and clothing intact. ${preservationPrompt}`,
  },
  {
    id: "kid-drawing",
    version: 1,
    name: "Fridge Masterpiece",
    description: "Wobbly crayons, joyful colors, and the confidence of a five-year-old artist.",
    accent: "#ffd84a",
    hue: 52,
    prompt: `Redraw the supplied photograph as an exuberant young child's crayon drawing on lightly lined off-white paper. Use wobbly outlines, uneven coloring, simplified shapes, cheerful colors, and charmingly imperfect proportions. ${preservationPrompt}`,
  },
  {
    id: "alien-visitor",
    version: 2,
    name: "First Contact",
    description: "A friendly visitor, green-violet light, and a little everyday science-fiction wonder.",
    accent: "#d7ff42",
    hue: 112,
    prompt: `Restyle the supplied photograph as a warm, playful science-fiction movie scene about meeting a friendly visitor from another planet. Add one small, friendly robot-like alien companion in an open area of the background, soft green-violet accent lighting, and a few practical retro-futuristic details. Keep the existing people and animals unchanged, healthy, relaxed, and clearly separate from the new companion; keep their clothing intact. The mood is welcoming and curious. ${preservationPrompt}`,
  },
  {
    id: "claymation",
    version: 1,
    name: "Tiny Clay World",
    description: "Hand-shaped characters, miniature sets, fingerprints, and stop-motion charm.",
    accent: "#f39b69",
    hue: 28,
    prompt: `Rebuild the supplied photograph as a handcrafted stop-motion clay animation frame. Everything should look sculpted from colorful modeling clay with tiny fingerprints, miniature practical sets, soft studio lighting, and shallow depth of field. ${preservationPrompt}`,
  },
  {
    id: "disposable-90s",
    version: 1,
    name: "Found in 1997",
    description: "Direct flash, soft focus, chunky grain, and a slightly questionable timestamp.",
    accent: "#5ac6c8",
    hue: 184,
    prompt: `Make the supplied photograph look like an authentic late-1990s consumer disposable-camera print. Use direct on-camera flash, slightly missed focus, visible film grain, modest color casts, imperfect exposure, and candid snapshot energy. Do not add a border or timestamp. ${preservationPrompt}`,
  },
  {
    id: "storybook",
    version: 1,
    name: "Bedtime Legend",
    description: "A warm, richly painted page from an old and well-loved storybook.",
    accent: "#6657de",
    hue: 248,
    prompt: `Illustrate the supplied photograph as a richly painted page from a timeless children's storybook. Use expressive gouache and watercolor textures, warm pools of light, gentle whimsy, detailed natural forms, and a sense of quiet adventure. ${preservationPrompt}`,
  },
]);

export function getPreset(id: string): Preset | undefined {
  return presets.find((preset) => preset.id === id);
}

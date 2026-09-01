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
    version: 1,
    name: "After the End",
    description: "Sun-scorched ruins, improvised survival gear, dust, and cinematic decay.",
    accent: "#ff6c51",
    hue: 18,
    prompt: `Transform the supplied photograph into a cinematic post-apocalyptic world years after civilization collapsed. Add believable weathering, overgrown or dusty surroundings, improvised details, dramatic amber light, and grounded film realism. ${preservationPrompt}`,
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
    version: 1,
    name: "First Contact",
    description: "An uncanny visitor, impossible light, and a close encounter caught on camera.",
    accent: "#d7ff42",
    hue: 112,
    prompt: `Transform the supplied photograph into a convincing cinematic first-contact scene. Introduce a mysterious but non-threatening alien presence, otherworldly green-violet illumination, subtle atmospheric haze, and tactile science-fiction production design. ${preservationPrompt}`,
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

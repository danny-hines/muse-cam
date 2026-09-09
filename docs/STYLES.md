# MuseCam styles

The camera has 23 styles. The original six retain their IDs and prompt versions;
the 17 additions below begin at version 1. Every style works for new captures and
for **Gallery → Restyle**, which creates a separate entry from a saved original.

| Style | Treatment |
| --- | --- |
| Panel One | Comic brush inks, halftone dots, and printed color |
| After School | Nostalgic cel anime with expressive faces and painted scenery |
| Prime Time | Simple, flat-color animated sitcom characters |
| Once Upon a Cel | Hand-drawn animated feature with lush painted backgrounds |
| Big Screen | Sculpted characters in a cinematic 3D animated feature |
| Pocket Arcade | Detailed 16-bit pixel art throughout the scene |
| Memory Card | Deliberately crude early 3D, angular faces, and tiny muddy textures |
| Cartridge World | Cheerful, chunky early-3D platformer models and soft textures |
| Age of Legends | Grounded high fantasy, practical costumes, and great halls |
| Elven Dawn | Luminous woodland fantasy, silver ornaments, and flowing fabrics |
| Frost & Crown | Weathered northern castles, heavy wool, and cold daylight |
| Paper Universe | Folded and layered paper dioramas |
| Soft Spot | Stuffed felt puppets and embroidered textile scenery |
| Neon Rain | Cinematic futuristic night lighting and reflected neon |
| Riso Club | Three-ink risograph art on textured paper |
| Stained in Light | Jewel-colored stained glass with slender lead contours |
| Blueprint Universe | Fine white technical linework on deep cyan paper |

The existing styles are After the End, Fridge Masterpiece, First Contact,
Tiny Clay World, Found in 1997, and Bedtime Legend.

## Prompt behavior

The animation styles describe visual techniques and original character designs.
Fantasy styles explicitly replace modern clothing and accessories, reinterpret
the surroundings, and adapt hair while preserving facial identity, age,
expression, pose, and scene layout. They depict peaceful everyday scenes with
original costume and heraldry designs. Memory Card intentionally preserves
recognizability at a coarse level rather than retaining detailed photographic
faces. Output fidelity still varies by input and generation.

All prompts are defined in `web/src/config/presets.ts`. Provider safeguards and
error handling remain in place. A single successful sample does not establish a
style's success rate; compare future outcomes by both style ID and prompt version
as described in `PRESET_RELIABILITY.md`.

## Initial validation — September 8, 2026

All 17 new styles produced a readable image from the same clothed portrait using
the production Meta provider and input normalization. Six styles were rendered
again after visual refinement (Prime Time, Memory Card, Soft Spot, and the three
fantasy styles). All 23 requests completed; the final 17 samples were visually
reviewed. These direct provider checks did not create gallery entries or publish
images, and cover only one input rather than a representative reliability study.

The 800×480 simulator verified selection of all 23 styles, wraparound navigation,
capture with Memory Card, and restyling to Blueprint Universe as a new gallery
entry while preserving the original. The installed Python wheel was also checked
to ensure it contains and can load the complete offline catalog.

## Keeping the device catalog synchronized

`device/src/musecam/presets.json` bundles the public catalog (ID, version, name,
description, accent) for offline startup and the simulator. It is included in the
installed Python package. Update this file when changing preset metadata; the
web catalog test verifies exact equality with the device API response and checks
that prompts are not exposed in the public catalog.

Connected cameras fetch the server catalog at startup and cache it for later
offline use. Publish the server update before restarting or updating a camera
to pick up new styles. Preset selection is stored by ID, so extending the catalog
does not change the user's selected style or alter existing gallery entries.

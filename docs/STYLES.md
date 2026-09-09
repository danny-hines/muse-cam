# MuseCam styles

The camera has 18 active styles. Every active style works for new captures and
for **Gallery → Restyle**, which creates a separate entry from a saved original.

| Style | Treatment |
| --- | --- |
| After the End | Peaceful, weathered surroundings reclaimed by nature |
| Fridge Masterpiece | Wobbly crayons and joyful childlike drawings |
| First Contact | A friendly visitor and everyday science-fiction wonder |
| Tiny Clay World | Hand-shaped characters and miniature stop-motion sets |
| Found in 1997 | Flash, soft focus, grain, and a nostalgic timestamp |
| Bedtime Legend | Warm, richly painted storybook illustration |
| Panel One | Comic brush inks, halftone dots, and printed color |
| Anime Cel | Nostalgic cel anime with expressive faces and painted scenery |
| Prime Time | Simple, flat-color animated sitcom characters |
| 3D Toon | Sculpted characters in a cinematic 3D animated feature |
| Title Screen | Detailed pixel illustration with retro title-screen atmosphere |
| Player One | Small playable sprites inside a full 16-bit game scene |
| Insert Disc 2 | Chunky console-era models with low-resolution photographic textures |
| Age of Legends | One coherent fantasy mood chosen to suit each photo |
| Paper Universe | Folded and layered paper dioramas |
| Soft Spot | Stuffed felt puppets and embroidered textile scenery |
| Neon Rain | Cinematic futuristic night lighting and reflected neon |
| Stained in Light | Jewel-colored stained glass with slender lead contours |

## September 8 curation

After School is now **Anime Cel**, Big Screen is **3D Toon**, and Pocket Arcade is
**Title Screen**. These are metadata changes: their IDs and version-1 prompts are
unchanged. **Player One** is a separate version-1 preset that pulls back from
close-up portraits to show small full-body gameplay sprites in tiled scenery.

Memory Card keeps its ID and becomes **Insert Disc 2**, with a version-2 prompt.
It specifies chunky limbs and silhouettes, blurry photographic face and clothing
textures, baked lighting, and coarse early-console rendering. Empty spaces remain
unoccupied rather than gaining invented game characters.

**Age of Legends v2** absorbs Elven Dawn and Frost & Crown. Its prompt asks the
model to choose one consistent mood: an elven woodland court, a royal castle,
a dragon-themed palace, or a northern great hall. Costumes, hair, architecture,
and lighting follow that choice. Mood selection is model-driven; repeated
generations can still choose the same mood.

Once Upon a Cel, Cartridge World, Elven Dawn, Frost & Crown, Riso Club, and
Blueprint Universe leave the capture and restyle pickers. Their definitions remain
available for existing gallery labels, shared links, queued requests, and retries
of existing failed photos. Retiring a style does not delete any photos. Restyling
an old photo defaults to an active style; a saved Elven Dawn or Frost & Crown
capture selection moves to Age of Legends.

## Prompt behavior

Animation styles describe visual techniques and original character designs.
Fantasy replaces modern clothing and accessories, adapts hair, and reinterprets
the setting while preserving facial identity, age, expression, and pose. Scenes
use peaceful everyday activity, original costumes, architecture, and heraldry.
Output fidelity varies by input and generation.

Prompts live in `web/src/config/presets.ts`. Provider safeguards and single-attempt
error handling remain in place. Compare future outcomes by both style ID and
prompt version as described in `PRESET_RELIABILITY.md`.

## Validation — September 8, 2026

The original 17-style expansion completed 23 direct Meta requests, including six
refinement renders, using one clothed portrait. That is historical validation of
the earlier catalog, not a reliability measurement for the revised prompts.

For this curation, the final prompts produced eight successful direct Meta samples:
Insert Disc 2 on a portrait and empty room; Player One on a portrait and dog; and
Age of Legends on the portrait twice, room, and dog. All eight were visually
reviewed. The two fantasy portraits chose a northern setting, while the room and
dog chose woodland styling. The first fantasy draft had two portrait rejections
and one successful room result; simplifying its costume and setting instructions
preceded the four successful final samples. This small check does not establish
a filtering cause or guarantee future acceptance. An earlier console draft also
added people to an empty room; the final prompt explicitly preserves occupancy,
and its room sample did so.

Direct provider checks used production input normalization and created no camera
or server gallery entries or public images. Local synthetic fixtures exercise the
800×480 capture and restyle flows, including photos made with retired styles.
Regression tests cover shared links for all six retired presets, offline picker
filtering, gallery labels, and retrying a failed retired style while preserving its
original. The Python wheel contains and loads both catalogs.

## Keeping the device catalog synchronized

`device/src/musecam/presets.json` bundles active public metadata (ID, version,
name, description, accent). `device/src/musecam/retired-presets.json` preserves
metadata for retired styles. Both are included in the installed Python package.
Update these files when changing metadata; web tests verify parity and ensure
prompts are absent from the public API response.

Connected cameras fetch the active server catalog at startup and cache it for
offline use. Local filtering also removes retired styles from older cached lists.
Publish the server update before updating the camera. Stable IDs preserve saved
photos and selections across renames, while changed prompts receive new versions.

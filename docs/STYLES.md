# MuseCam styles

The camera has 18 active styles. Every active style works for new captures and
for **Gallery → Restyle**, which creates a separate entry from a saved original.

| Style | Treatment |
| --- | --- |
| After the End | Peaceful, weathered surroundings reclaimed by nature |
| Fridge Masterpiece | Wobbly crayons and joyful childlike drawings |
| First Contact | A friendly visitor and everyday science-fiction wonder |
| Tiny Clay World | Hand-shaped characters and miniature stop-motion sets |
| Found in 1997 | Direct flash, grain, and late-90s outfits, hair, and gadgets |
| Bedtime Legend | Warm, richly painted storybook illustration |
| Panel One | Comic brush inks, halftone dots, and printed color |
| Anime Cel | Nostalgic cel anime with expressive faces and painted scenery |
| Prime Time | Simple, flat-color animated sitcom characters |
| 3D Toon | Sculpted characters in a cinematic 3D animated feature |
| Title Screen | Detailed pixel illustration with retro title-screen atmosphere |
| Player One | Small playable sprites inside a full 16-bit game scene |
| Insert Disc 2 | Smooth shading, chunky console characters, soft photographic textures, and wider portraits |
| Age of Legends | One coherent fantasy mood chosen to suit each photo |
| Paper Universe | Folded and layered paper dioramas |
| Soft Spot | Stuffed felt puppets and embroidered textile scenery |
| Neon Rain | Cinematic futuristic night lighting and reflected neon |
| Stained in Light | Jewel-colored stained glass with slender lead contours |

## September 29: Event-only styles for Meta's internal event

Events can now choose their own style list in `/admin` (see
[ADMIN.md](ADMIN.md#event-styles)). These six styles are **event-only**. They
are not in the default catalog or the camera's bundled list, and the server
generates them only for cameras at an event that turns them on.

| Style | Treatment |
| --- | --- |
| Headset On | A Quest-style VR headset on every person, and on pets |
| Keynote Fit | Alexandr Wang's Connect 2026 outfit: deer tie-dye tee, hiking pants, camo clogs |
| Muse Mode | Every person becomes a plush Muse in their own clothes, pose, and expression |
| Legs Sold Separately | Legless, floating 2022 metaverse avatars in front of a flat Eiffel Tower |
| Gold Chain Era | Oversized black tees, gold chains, and grown-out curls; pets get a chain collar |
| Hydrofoil Freedom | Tuxedos on electric hydrofoils, with one rider holding a flag |

Keynote Fit and Muse Mode send a reference image after the photo
(`web/src/lib/model/references/`). The Keynote Fit reference is cropped below
the face and the prompt uses it only for clothing.

Drafts were tested on six published originals: a posed group of nine, a close
group of four, a gym mirror selfie, a child, a dog, and a family with a dog.
Changes before adoption:

- **Legs Sold Separately:** the first draft left legs on standing people. The
  prompt now spells out that nothing is below the waist, for everyone.
- **Muse Mode:** early drafts put Muse heads on human bodies in groups, left
  some adults human, added small toy Muses instead, or stretched Muses to human
  proportions. The prompt now puts Muse's pear-shaped body first and scales
  each Muse to roughly the person's size without stretching it, so the framing
  holds and clothes fit the round body like a plush toy's. It names men, women,
  and children and forbids extra figures. A draft that made Muses waist-high
  kept the shape but went back to adding toys beside people.
- **Gold Chain Era:** the first draft put most people in shearling jackets,
  hiding the tee and chain, so outerwear is now left off.
- **Hydrofoil Freedom:** group photos were often filtered. Removing the flag did
  not fix it, so a single flag, held by the center rider, is kept for the joke.
- **Keynote Fit:** the first draft pulled back to show everyone's shoes; it now
  keeps the original framing.

The final prompts were then run once more on all six photos (36 requests) with
production input normalization. No gallery entries or public images were
created. Headset On, Keynote Fit, Muse Mode, and Legs Sold Separately
completed 6 of 6. The body-shape revision of Muse Mode then turned every person
into a round Muse on the close group and the family photo, the two that had
failed before. The large group, which had passed with the previous draft, was
filtered in that run. Gold Chain Era completed 5 of 6.
The close group of four was filtered on every outfit-swap prompt tried, but
passed the other styles. Hydrofoil Freedom completed 2 of 6 in that run, and
about half of its requests were filtered across all drafts, including a dog and a
child that had passed earlier. It is the least reliable of the six.

Events that let the server pick styles fall back to another style when one is
filtered, which covers most of these failures.

## September 28: Found in 1997 v2

Version 1 only changed the photographic treatment, so results often looked like a
modern photo with a flash. **Version 2** keeps the disposable-camera flash, grain,
and color cast, and adds a restrained late-90s makeover: everyday period clothes,
a 1990s version of each person's hair, and modern devices and furnishings swapped
for period equivalents in the same places. It allows at most two added props,
asks for plain tape and disc labels, and keeps buildings and skylines as
photographed. It uses the shared costume preservation instructions, so faces,
ages, poses, and layout stay recognizable.

Before adopting it, current and new prompts were compared on five published
originals: a posed group, a group at a skyline window, a gym mirror selfie, a
child in a living room, and a dog on a couch. None were filtered. A first draft
piled up VHS tapes and electronics and printed real movie titles on tape
spines, which led to the prop limit and label wording.

## September 8 curation

After School is now **Anime Cel**, Big Screen is **3D Toon**, and Pocket Arcade is
**Title Screen**. These are metadata changes: their IDs and version-1 prompts are
unchanged. **Player One** is a separate version-1 preset that pulls back from
close-up portraits to show small full-body gameplay sprites in tiled scenery.

Memory Card keeps its ID and becomes **Insert Disc 2**. After comparing five test
variants, **version 3** adopts the exact **Smooth+Wide** prompt: smooth shading,
chunky silhouettes, blurry photographic textures, and a wider waist-up view for
close-up portraits. Already wider photos keep their framing. Empty spaces remain
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

The five **Disc 2** test entries are retired from the capture and restyle pickers.
Their IDs, names, and version-1 prompts remain available for saved gallery photos,
shared links, and retries. Any saved test-mode capture selection moves to
**Insert Disc 2**. The main style keeps ID `memory-card`, now at version 3; changing
its prompt does not alter existing images. Pulling back from a close-up can invent
unseen clothing and poses. Gallery → Restyle still creates a separate photo.

For retries of the retired **Disc 2 · Reference** mode, the provider sends the
original photo first and a bundled rendering reference second. Its prompt limits
the second image to rendering technique,
preserving the first image's subjects and scene. The reference is the user-supplied
1710×900 game screenshot, normalized with the standard input pipeline to JPEG and
stored as base64 in `web/src/lib/model/references/disc-2.json`. Static import keeps
it inside the server deployment; it is not a public asset or device catalog field.
All active styles send one image. The retired **1996** variant uses text guidance
only.

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

For the initial curation, the final prompts produced eight successful direct Meta samples:
Insert Disc 2 v2 on a portrait and empty room; Player One on a portrait and dog; and
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
Regression tests cover shared links for all eleven retired presets, offline picker
filtering, gallery labels, and retrying a failed retired style while preserving its
original. The Python wheel contains and loads both catalogs.

## Keeping the device catalog synchronized

`device/src/musecam/presets.json` bundles active public metadata (ID, version,
name, description, accent). `device/src/musecam/retired-presets.json` preserves
metadata for retired styles. Both are included in the installed Python package.
Update these files when changing metadata; web tests verify parity and ensure
prompts are absent from the public API response.

Event-only styles are never bundled: `presets.json` holds the default catalog
only, and the API sends event-only styles just to cameras whose event turns
them on.

Connected cameras fetch the active server catalog at startup and cache it for
offline use. Local filtering also removes retired styles from older cached lists.
Publish the server update before updating the camera. Stable IDs preserve saved
photos and selections across renames, while changed prompts receive new versions.

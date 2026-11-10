"""Edits: a look plus four adjustments, applied to a photo on the camera.

An edit is saved as a recipe on an Edited version, so editing that version again
picks up where it left off. The touchscreen previews the adjustments with an SVG
filter built from the same numbers (device-ui/src/edit-math.ts), on a preview the
camera renders with the look already applied.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from .looks import LOOKS

EDIT_PRESET_ID = "edit"
ADJUSTMENTS = ("light", "contrast", "color", "warmth")
# The longest side an edit keeps. Camera photos are already saved smaller than
# this; a larger file, such as a full-sensor still, is scaled down.
MAX_SIDE = 2400
PREVIEW_SIDES = {"thumb": 200, "screen": 800}
# Rec. 709 luminance, which an SVG saturate filter also uses.
LUMA = (0.2126, 0.7152, 0.0722)


@dataclass(frozen=True)
class Edit:
    look: str | None = None
    light: int = 0
    contrast: int = 0
    color: int = 0
    warmth: int = 0

    @classmethod
    def parse(cls, values: object) -> Edit:
        if not isinstance(values, dict) or values.keys() - {"look", *ADJUSTMENTS}:
            raise ValueError("Invalid edit")
        look = values.get("look")
        if look is not None and look not in LOOKS:
            raise ValueError("Choose an available look")
        amounts = {}
        for name in ADJUSTMENTS:
            amount = values.get(name, 0)
            if type(amount) is not int or not -100 <= amount <= 100:
                raise ValueError("Adjustments go from -100 to 100")
            amounts[name] = amount
        return cls(look, **amounts)

    def to_json(self) -> dict:
        return asdict(self)

    @property
    def adjusted(self) -> bool:
        return any(getattr(self, name) for name in ADJUSTMENTS)


def adjustment(edit: Edit) -> tuple[float, list[list[float]]]:
    """The light curve's exponent and a 3 × 4 matrix for the other adjustments.

    Light bends the midtones and keeps black and white where they are. Contrast
    pivots on middle gray, warmth trades red against blue, and color mixes each
    pixel toward or away from its luminance. Values are 0–1, as in an SVG filter.
    """
    exponent = 2 ** (-0.8 * edit.light / 100)
    slope = 2 ** (0.7 * edit.contrast / 100)
    warmth = 0.1 * edit.warmth / 100
    gains = (1 + warmth, 1.0, 1 - warmth)
    color = edit.color / 100
    saturation = 1 + color if color < 0 else 1 + 0.8 * color
    matrix = []
    for row in range(3):
        mix = [(1 - saturation) * LUMA[col] + (saturation if col == row else 0) for col in range(3)]
        matrix.append(
            [mix[col] * gains[col] * slope for col in range(3)]
            + [sum(mix[col] * gains[col] * 0.5 * (1 - slope) for col in range(3))]
        )
    return exponent, matrix


def adjust(image: Image.Image, edit: Edit) -> Image.Image:
    if not edit.adjusted:
        return image
    exponent, matrix = adjustment(edit)
    if exponent != 1:
        curve = [round(255 * (v / 255) ** exponent) for v in range(256)]
        image = image.point(curve * 3)
    # Pillow's matrix works in 0–255 and rounds, like the screen's 8-bit filter.
    return image.convert(
        "RGB", tuple(value * 255 if col == 3 else value for row in matrix
                     for col, value in enumerate(row))
    )


def open_photo(source: Path, max_side: int) -> Image.Image:
    """Decode a photo upright and no larger than ``max_side``."""
    with Image.open(source) as opened:
        width, height = opened.size
        scale = min(1.0, max_side / max(width, height))
        # JPEG draft mode decodes at a fraction of full size, which is most of the
        # time a small preview takes on a Pi.
        opened.draft("RGB", (max(1, round(width * scale)), max(1, round(height * scale))))
        image = ImageOps.exif_transpose(opened).convert("RGB")
    image.thumbnail((max_side, max_side))
    return image


def apply(image: Image.Image, edit: Edit) -> Image.Image:
    if edit.look:
        image = LOOKS[edit.look][1](image)
    return adjust(image, edit)


def render(source: Path, destination: Path, edit: Edit) -> None:
    """Write ``source`` with ``edit`` applied to ``destination`` as a JPEG."""
    apply(open_photo(source, MAX_SIDE), edit).save(
        destination, "JPEG", quality=90, optimize=True
    )


@lru_cache(maxsize=24)
def _preview(source: str, modified: int, look: str | None, max_side: int) -> bytes:
    image = open_photo(Path(source), max_side)
    if look:
        image = LOOKS[look][1](image)
    output = BytesIO()
    image.save(output, "JPEG", quality=85)
    return output.getvalue()


def preview(source: Path, look: str | None, size: str) -> bytes:
    """A small JPEG with only the look applied; the screen previews adjustments."""
    if look is not None and look not in LOOKS:
        raise ValueError("Choose an available look")
    if size not in PREVIEW_SIDES:
        raise ValueError("Choose a preview size")
    return _preview(str(source), source.stat().st_mtime_ns, look, PREVIEW_SIDES[size])

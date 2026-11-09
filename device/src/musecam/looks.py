"""Looks: photo finishes made on the camera with no model, key, or network.

Each look is a small Pillow recipe. They work at about half the sensor's
resolution, which keeps a Pi 3B+ quick and still leaves far more pixels than the
screen or a phone needs.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageOps

from .models import Preset

# The longest side a look keeps. A 4608 × 2592 Camera Module 3 photo decodes at
# half size, 2304 × 1296.
MAX_SIDE = 2400


def _levels(image: Image.Image, red: tuple, green: tuple, blue: tuple) -> Image.Image:
    """Scale then lift each channel: ``(gain, lift)`` maps v to v * gain + lift."""

    def table(gain: float, lift: float) -> list[int]:
        return [max(0, min(255, round(v * gain + lift))) for v in range(256)]

    return image.point(table(*red) + table(*green) + table(*blue))


def _grain(image: Image.Image, amount: float) -> Image.Image:
    noise = Image.effect_noise(image.size, 40).convert("RGB")
    noisy = ImageChops.add(image, noise, scale=1.0, offset=-128)
    return Image.blend(image, noisy, amount)


def _vignette(image: Image.Image, strength: float) -> Image.Image:
    # Pillow's radial gradient is 0 at the centre and 255 at the corners.
    mask = Image.radial_gradient("L").resize(image.size)
    mask = mask.point(lambda v: max(0, min(255, round((v - 120) * 1.9))))
    dark = ImageEnhance.Brightness(image).enhance(1 - strength)
    return Image.composite(dark, image, mask)


def black_and_white(image: Image.Image) -> Image.Image:
    gray = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=0.5)
    return ImageEnhance.Contrast(gray).enhance(1.12).convert("RGB")


def warm_film(image: Image.Image) -> Image.Image:
    image = _levels(image, (1.04, 10), (1.0, 6), (0.88, 12))
    image = ImageEnhance.Contrast(image).enhance(1.06)
    image = ImageEnhance.Color(image).enhance(1.08)
    return _grain(image, 0.18)


def faded(image: Image.Image) -> Image.Image:
    image = ImageEnhance.Color(image).enhance(0.72)
    return _levels(image, (0.78, 34), (0.8, 34), (0.8, 40))


def punchy(image: Image.Image) -> Image.Image:
    image = ImageOps.autocontrast(image, cutoff=0.5)
    image = ImageEnhance.Contrast(image).enhance(1.12)
    image = ImageEnhance.Color(image).enhance(1.28)
    return ImageEnhance.Sharpness(image).enhance(1.25)


def vintage(image: Image.Image) -> Image.Image:
    gray = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=1)
    sepia = ImageOps.colorize(gray, black="#2b1d10", white="#f4e6c8", mid="#a27c52")
    return _grain(_vignette(sepia, 0.45), 0.25)


LOOKS: dict[str, tuple[Preset, Callable[[Image.Image], Image.Image]]] = {
    preset.id: (preset, recipe)
    for preset, recipe in (
        (
            Preset("look-bw", 1, "Black & White", "Clean, crisp monochrome", "#d8d8d2"),
            black_and_white,
        ),
        (
            Preset("look-warm-film", 1, "Warm Film", "Golden tones and soft grain", "#e9a85c"),
            warm_film,
        ),
        (
            Preset("look-faded", 1, "Faded", "Soft, washed-out color", "#a9bab1"),
            faded,
        ),
        (
            Preset("look-punchy", 1, "Punchy", "Bold color and contrast", "#ff6b5e"),
            punchy,
        ),
        (
            Preset("look-vintage", 1, "Vintage", "Sepia print with grain", "#b88d5c"),
            vintage,
        ),
    )
}
LOOK_PRESETS = [preset for preset, _ in LOOKS.values()]


def is_look(preset_id: str | None) -> bool:
    return preset_id in LOOKS


def apply_look(look_id: str, source: Path, destination: Path) -> None:
    """Write ``source`` with the look applied to ``destination`` as a JPEG."""
    _, recipe = LOOKS[look_id]
    with Image.open(source) as opened:
        # JPEG draft mode decodes at a fraction of full size, which is most of the
        # time saved on a Pi.
        width, height = opened.size
        if max(width, height) >= MAX_SIDE * 1.5:
            opened.draft("RGB", (width // 2, height // 2))
        image = ImageOps.exif_transpose(opened).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    temporary = destination.with_suffix(".look")
    recipe(image).save(temporary, "JPEG", quality=90, optimize=True)
    temporary.replace(destination)

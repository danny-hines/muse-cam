"""Looks: photo finishes the editor makes on the camera with no model, key, or network.

Each look is a small Pillow recipe. On a Pi 3B+ one takes about 0.5–1.7 s on a
saved 1920 × 1280 photo.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache

from PIL import Image, ImageChops, ImageEnhance, ImageOps

from .models import Preset

GRAIN_TILE = 512


def _levels(image: Image.Image, red: tuple, green: tuple, blue: tuple) -> Image.Image:
    """Scale then lift each channel: ``(gain, lift)`` maps v to v * gain + lift."""

    def table(gain: float, lift: float) -> list[int]:
        return [max(0, min(255, round(v * gain + lift))) for v in range(256)]

    return image.point(table(*red) + table(*green) + table(*blue))


@lru_cache(maxsize=1)
def _grain_tile() -> Image.Image:
    # Full-size noise costs most of a second on a Pi 3B+; tiling one costs ~0.02 s.
    return Image.effect_noise((GRAIN_TILE, GRAIN_TILE), 40)


def _grain(image: Image.Image, amount: float) -> Image.Image:
    tile = _grain_tile()
    layer = Image.new("L", image.size)
    for x in range(0, image.width, tile.width):
        for y in range(0, image.height, tile.height):
            layer.paste(tile, (x, y))
    noise = Image.merge("RGB", (layer, layer, layer))
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


from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from musecam.looks import LOOK_PRESETS, LOOKS, MAX_SIDE, apply_look, is_look


def photo(path: Path, size: tuple[int, int]) -> Path:
    image = Image.new("RGB", size, "#4f86c6")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, size[1] // 2, size[0], size[1]), fill="#d9a35b")
    draw.ellipse((size[0] // 3, size[1] // 4, size[0] // 2, size[1] * 3 // 4), fill="#e8c4a0")
    image.save(path, "JPEG", quality=92)
    return path


def test_every_look_writes_a_half_size_jpeg_and_keeps_the_original(tmp_path: Path) -> None:
    source = photo(tmp_path / "source.jpg", (4608, 2592))
    before = source.read_bytes()
    for look_id in LOOKS:
        result = tmp_path / f"{look_id}.jpg"
        apply_look(look_id, source, result)
        with Image.open(result) as image:
            assert image.format == "JPEG"
            assert image.size == (2304, 1296)
            assert max(image.size) <= MAX_SIDE
        assert not result.with_suffix(".look").exists()
    assert source.read_bytes() == before


def test_small_photos_are_not_enlarged(tmp_path: Path) -> None:
    source = photo(tmp_path / "small.jpg", (640, 480))
    apply_look("look-faded", source, tmp_path / "faded.jpg")
    with Image.open(tmp_path / "faded.jpg") as image:
        assert image.size == (640, 480)


def test_black_and_white_has_no_color_and_the_others_change_it(tmp_path: Path) -> None:
    source = photo(tmp_path / "source.jpg", (800, 480))
    with Image.open(source) as original:
        sky = original.convert("RGB").getpixel((40, 40))
    for look_id in LOOKS:
        apply_look(look_id, source, tmp_path / f"{look_id}.jpg")
        with Image.open(tmp_path / f"{look_id}.jpg") as image:
            red, green, blue = image.convert("RGB").getpixel((40, 40))
        if look_id == "look-bw":
            assert max(red, green, blue) - min(red, green, blue) <= 3
        else:
            assert (red, green, blue) != sky, look_id


def test_looks_are_named_presets() -> None:
    assert [preset.name for preset in LOOK_PRESETS] == [
        "Black & White", "Warm Film", "Faded", "Punchy", "Vintage",
    ]
    assert all(is_look(preset.id) for preset in LOOK_PRESETS)
    assert not is_look("original") and not is_look("claymation") and not is_look(None)

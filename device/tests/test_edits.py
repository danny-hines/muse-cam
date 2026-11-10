from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from musecam.edits import MAX_SIDE, Edit, adjust, adjustment, preview, render
from musecam.looks import LOOK_PRESETS, LOOKS


def photo(path: Path, size: tuple[int, int]) -> Path:
    image = Image.new("RGB", size, "#4f86c6")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, size[1] // 2, size[0], size[1]), fill="#d9a35b")
    draw.ellipse((size[0] // 3, size[1] // 4, size[0] // 2, size[1] * 3 // 4), fill="#e8c4a0")
    image.save(path, "JPEG", quality=92)
    return path


def ramp() -> Image.Image:
    """Black to white in every channel, plus a few colors."""
    image = Image.new("RGB", (256, 2))
    image.putdata(
        [(v, v, v) for v in range(256)]
        + [(200, 60, 40), (40, 160, 220), (90, 90, 30)] * 85
        + [(0, 0, 0)]
    )
    return image


def test_every_look_keeps_a_camera_photo_at_its_size(tmp_path: Path) -> None:
    source = photo(tmp_path / "source.jpg", (1920, 1280))
    before = source.read_bytes()
    for look_id in LOOKS:
        result = tmp_path / f"{look_id}.jpg"
        render(source, result, Edit(look=look_id))
        with Image.open(result) as image:
            assert (image.format, image.size) == ("JPEG", (1920, 1280))
    assert source.read_bytes() == before


def test_large_photos_are_scaled_down_and_small_ones_kept(tmp_path: Path) -> None:
    render(photo(tmp_path / "big.jpg", (4608, 2592)), tmp_path / "big-edit.jpg", Edit(light=10))
    with Image.open(tmp_path / "big-edit.jpg") as image:
        assert image.size == (MAX_SIDE, 1350)
    render(photo(tmp_path / "small.jpg", (640, 480)), tmp_path / "small-edit.jpg", Edit())
    with Image.open(tmp_path / "small-edit.jpg") as image:
        assert image.size == (640, 480)


def test_black_and_white_has_no_color_and_the_other_looks_change_it(tmp_path: Path) -> None:
    source = photo(tmp_path / "source.jpg", (800, 480))
    with Image.open(source) as original:
        sky = original.convert("RGB").getpixel((40, 40))
    for look_id in LOOKS:
        render(source, tmp_path / f"{look_id}.jpg", Edit(look=look_id))
        with Image.open(tmp_path / f"{look_id}.jpg") as image:
            red, green, blue = image.convert("RGB").getpixel((40, 40))
        if look_id == "look-bw":
            assert max(red, green, blue) - min(red, green, blue) <= 3
        else:
            assert (red, green, blue) != sky, look_id


def test_looks_have_names() -> None:
    assert [preset.name for preset in LOOK_PRESETS] == [
        "Black & White", "Warm Film", "Faded", "Punchy", "Vintage",
    ]


@pytest.mark.parametrize(
    ("values", "message"),
    (
        ([], "Invalid edit"),
        ({"brightness": 10}, "Invalid edit"),
        ({"look": "look-sepia"}, "available look"),
        ({"light": 101}, "-100 to 100"),
        ({"color": 1.5}, "-100 to 100"),
        ({"warmth": True}, "-100 to 100"),
        ({"contrast": "10"}, "-100 to 100"),
    ),
)
def test_edits_are_checked(values: object, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        Edit.parse(values)


def test_an_edit_round_trips_through_its_recipe() -> None:
    edit = Edit.parse({"look": "look-faded", "light": 20, "warmth": -40})
    assert edit.to_json() == {
        "look": "look-faded", "light": 20, "contrast": 0, "color": 0, "warmth": -40,
    }
    assert Edit.parse(edit.to_json()) == edit
    assert edit.adjusted and not Edit(look="look-bw").adjusted


def test_no_adjustment_leaves_pixels_alone() -> None:
    image = ramp()
    assert adjust(image, Edit()) is image
    # Zero still takes the full path when another slider moves, without drift.
    tiny = adjust(image, Edit(warmth=1))
    gray = [tiny.getpixel((v, 0)) for v in range(256)]
    assert all(abs(r - v) <= 1 and g == v and abs(b - v) <= 1 for v, (r, g, b) in enumerate(gray))


def pixel(edit: Edit, value: tuple[int, int, int]) -> tuple[int, int, int]:
    return adjust(Image.new("RGB", (1, 1), value), edit).getpixel((0, 0))


def test_each_adjustment_moves_pixels_the_way_its_name_says() -> None:
    middle, black, white = (128, 128, 128), (0, 0, 0), (255, 255, 255)
    # Light lifts the midtones and keeps black and white.
    assert pixel(Edit(light=60), middle)[0] > 150
    assert pixel(Edit(light=-60), middle)[0] < 105
    assert pixel(Edit(light=100), black) == black
    assert pixel(Edit(light=-100), white) == white
    # Contrast pivots on middle gray.
    assert pixel(Edit(contrast=60), (64, 64, 64))[0] < 50
    assert pixel(Edit(contrast=60), (192, 192, 192))[0] > 205
    assert pixel(Edit(contrast=60), middle) == middle
    # Color -100 is grayscale; +100 pushes channels apart.
    red, green, blue = pixel(Edit(color=-100), (200, 60, 40))
    assert max(red, green, blue) - min(red, green, blue) <= 1
    red, green, blue = pixel(Edit(color=100), (200, 60, 40))
    assert red > 200 and green < 60
    # Warmth trades blue for red.
    red, green, blue = pixel(Edit(warmth=100), middle)
    assert red > 135 and green == 128 and blue < 121
    red, green, blue = pixel(Edit(warmth=-100), middle)
    assert red < 121 and blue > 135


def test_the_screen_uses_the_same_numbers() -> None:
    # device-ui/tests/edit-math.test.ts checks the screen's filter against these.
    exponent, matrix = adjustment(Edit(light=40, contrast=-30, color=50, warmth=20))
    assert exponent == pytest.approx(0.80107, abs=1e-5)
    assert sum(matrix, []) == pytest.approx(
        [
            1.159569, -0.247327, -0.024468, 0.069552,
            -0.074991, 0.963025, -0.024468, 0.067655,
            -0.074991, -0.247327, 1.161677, 0.065759,
        ],
        abs=1e-5,
    )
    exponent, matrix = adjustment(Edit(light=-100, contrast=100, color=-100, warmth=-100))
    assert exponent == pytest.approx(1.741101, abs=1e-5)
    assert sum(matrix, []) == pytest.approx(
        [0.310833, 1.161846, 0.129018, -0.307868] * 3, abs=1e-5
    )


def test_previews_are_small_jpegs_with_the_look(tmp_path: Path) -> None:
    source = photo(tmp_path / "source.jpg", (1920, 1280))
    for size, expected in (("thumb", (200, 133)), ("screen", (800, 533))):
        with Image.open(BytesIO(preview(source, "look-bw", size))) as image:
            assert (image.format, image.size) == ("JPEG", expected)
            red, green, blue = image.convert("RGB").getpixel((20, 20))
            assert max(red, green, blue) - min(red, green, blue) <= 3
    assert preview(source, None, "thumb") is preview(source, None, "thumb")
    with pytest.raises(ValueError, match="available look"):
        preview(source, "look-sepia", "thumb")
    with pytest.raises(ValueError, match="preview size"):
        preview(source, None, "huge")

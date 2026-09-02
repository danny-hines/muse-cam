from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Protocol

from .config import DeviceConfig, HardwareProfile


def changed_row_bounds(
    current: bytes,
    previous: bytes | None,
    *,
    row_bytes: int,
    height: int,
) -> tuple[int, int] | None:
    if previous is None or len(previous) != len(current):
        return (0, height - 1)

    first: int | None = None
    last: int | None = None
    for y in range(height):
        start = y * row_bytes
        end = start + row_bytes
        if current[start:end] != previous[start:end]:
            if first is None:
                first = y
            last = y
    return None if first is None or last is None else (first, last)


class Display(Protocol):
    surface: Any
    width: int
    height: int

    def present(self) -> None: ...

    def save_screenshot(self, path: Path) -> None: ...

    def close(self) -> None: ...


class PygameDisplay:
    def __init__(self, profile: HardwareProfile, config: DeviceConfig, *, windowed: bool) -> None:
        if config.sdl_video_driver:
            os.environ.setdefault("SDL_VIDEODRIVER", config.sdl_video_driver)
        if config.framebuffer_device:
            os.environ.setdefault("SDL_FBDEV", config.framebuffer_device)

        import pygame

        pygame.display.init()
        pygame.font.init()
        self.width = profile.display_width
        self.height = profile.display_height
        flags = 0 if windowed else pygame.FULLSCREEN
        self.surface = pygame.display.set_mode((self.width, self.height), flags)
        pygame.display.set_caption("Muse Cam")
        pygame.mouse.set_visible(windowed)
        self._pygame = pygame

    def present(self) -> None:
        self._pygame.display.flip()

    def save_screenshot(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._pygame.image.save(self.surface, str(path))

    def close(self) -> None:
        self._pygame.display.quit()
        self._pygame.quit()


class FramebufferDisplay:
    def __init__(self, profile: HardwareProfile, config: DeviceConfig) -> None:
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        import pygame

        pygame.display.init()
        pygame.font.init()
        pygame.display.set_mode((1, 1))
        self.width = profile.display_width
        self.height = profile.display_height
        self.surface = pygame.Surface((self.width, self.height), depth=32)
        self._pygame = pygame
        self._rotation = profile.display_rotation
        requested = Path(config.framebuffer_device) if config.framebuffer_device else None
        candidates = [requested] if requested else [Path("/dev/fb1"), Path("/dev/fb0")]
        self._device_path = next((path for path in candidates if path and path.exists()), None)
        if self._device_path is None:
            raise RuntimeError("No framebuffer found; set MUSECAM_FRAMEBUFFER to the TFT device")
        self._device = self._device_path.open("r+b", buffering=0)
        self._last_pixels: bytes | None = None
        stride_path = Path("/sys/class/graphics") / self._device_path.name / "stride"
        self._stride = (
            int(stride_path.read_text(encoding="utf-8").strip())
            if stride_path.is_file()
            else self.width * 2
        )

    def present(self) -> None:
        surface = self.surface
        if self._rotation:
            surface = self._pygame.transform.rotate(surface, self._rotation)
        pixels = bytes(surface.convert(16, 0).get_buffer())
        row_bytes = self.width * 2
        dirty_rows = changed_row_bounds(
            pixels,
            self._last_pixels,
            row_bytes=row_bytes,
            height=self.height,
        )
        if dirty_rows is None:
            return
        first_row, last_row = dirty_rows
        if self._stride == row_bytes:
            start = first_row * row_bytes
            end = (last_row + 1) * row_bytes
            self._device.seek(first_row * self._stride)
            self._device.write(pixels[start:end])
        else:
            for y in range(first_row, last_row + 1):
                self._device.seek(y * self._stride)
                start = y * row_bytes
                self._device.write(pixels[start : start + row_bytes])
        self._last_pixels = pixels

    def save_screenshot(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._pygame.image.save(self.surface, str(path))

    def close(self) -> None:
        self.surface.fill("#000000")
        try:
            self.present()
        finally:
            self._device.close()
            self._pygame.quit()


class DisplayHatMiniDisplay:
    def __init__(self, profile: HardwareProfile) -> None:
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        try:
            import pygame
            from displayhatmini import DisplayHATMini
        except ImportError as error:
            raise RuntimeError("Display HAT Mini dependencies are not installed") from error

        pygame.display.init()
        pygame.font.init()
        self.width = profile.display_width
        self.height = profile.display_height
        self.surface = pygame.Surface((self.width, self.height))
        self._pygame = pygame
        self._hat = DisplayHATMini(None, backlight_pwm=True)
        self._hat.set_backlight(0.86)
        self._hat.set_led(0.05, 0.12, 0.10)
        self._hat.on_button_pressed(self._button_callback)

    def _button_callback(self, pin: int) -> None:
        key = {
            self._hat.BUTTON_A: self._pygame.K_LEFT,
            self._hat.BUTTON_B: self._pygame.K_RIGHT,
            self._hat.BUTTON_X: self._pygame.K_SPACE,
            self._hat.BUTTON_Y: self._pygame.K_s,
        }[pin]
        event_type = self._pygame.KEYDOWN if self._hat.read_button(pin) else self._pygame.KEYUP
        self._pygame.event.post(self._pygame.event.Event(event_type, key=key))

    def present(self) -> None:
        self._hat.st7789.set_window()
        pixels = self._pygame.transform.rotate(self.surface, 180).convert(16, 0).get_buffer()
        pixel_bytes = bytearray(pixels)
        pixel_bytes[0::2], pixel_bytes[1::2] = pixel_bytes[1::2], pixel_bytes[0::2]
        for offset in range(0, len(pixel_bytes), 4096):
            self._hat.st7789.data(pixel_bytes[offset : offset + 4096])

    def save_screenshot(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._pygame.image.save(self.surface, str(path))

    def close(self) -> None:
        self._hat.set_led(0, 0, 0)
        self._hat.set_backlight(0)
        self._pygame.quit()


def create_display(
    profile: HardwareProfile,
    config: DeviceConfig,
    *,
    simulate: bool,
    windowed: bool,
) -> Display:
    if simulate:
        return PygameDisplay(profile, config, windowed=windowed or simulate)
    if profile.display_backend == "framebuffer":
        return FramebufferDisplay(profile, config)
    if profile.display_backend == "displayhatmini":
        return DisplayHatMiniDisplay(profile)
    raise ValueError(f"Unsupported display backend: {profile.display_backend}")

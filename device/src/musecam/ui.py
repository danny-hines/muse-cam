from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any

from PIL import Image

from .models import Preset, ScreenState


@dataclass(frozen=True)
class AppView:
    state: ScreenState
    preset: Preset
    message: str = ""
    battery: int | None = None
    queued: int = 0
    shared: bool = False
    network_online: bool = True


class Renderer:
    def __init__(self, surface: Any, width: int, height: int) -> None:
        import pygame

        self._pygame = pygame
        self._surface = surface
        self._width = width
        self._height = height
        self._small = pygame.font.Font(None, max(16, round(height * 0.065)))
        self._medium = pygame.font.Font(None, max(20, round(height * 0.088)))
        self._large = pygame.font.Font(None, max(30, round(height * 0.16)))

    def draw(self, view: AppView, image: Image.Image | None) -> None:
        pygame = self._pygame
        self._surface.fill("#111718")
        if image is not None:
            self._draw_cover(image)
        else:
            self._draw_empty_background()

        overlay = pygame.Surface((self._width, self._height), pygame.SRCALPHA)
        pygame.draw.rect(overlay, (5, 10, 11, 160), (0, 0, self._width, max(34, self._height // 8)))
        bottom_height = max(54, self._height // 5)
        pygame.draw.rect(
            overlay,
            (5, 10, 11, 215),
            (0, self._height - bottom_height, self._width, bottom_height),
        )
        self._surface.blit(overlay, (0, 0))

        accent = pygame.Color(view.preset.accent)
        self._draw_header(view, accent)
        self._draw_state(view, accent)
        self._draw_controls(view, accent, bottom_height)

    def _draw_cover(self, image: Image.Image) -> None:
        source = image.convert("RGB")
        source_ratio = source.width / source.height
        target_ratio = self._width / self._height
        if source_ratio > target_ratio:
            crop_width = round(source.height * target_ratio)
            left = (source.width - crop_width) // 2
            source = source.crop((left, 0, left + crop_width, source.height))
        else:
            crop_height = round(source.width / target_ratio)
            top = (source.height - crop_height) // 2
            source = source.crop((0, top, source.width, top + crop_height))
        source = source.resize((self._width, self._height), Image.Resampling.BILINEAR)
        frame = self._pygame.image.fromstring(source.tobytes(), source.size, "RGB")
        self._surface.blit(frame, (0, 0))

    def _draw_empty_background(self) -> None:
        for y in range(self._height):
            progress = y / max(1, self._height - 1)
            color = (
                round(19 + 21 * progress),
                round(34 + 18 * progress),
                round(35 + 25 * progress),
            )
            self._pygame.draw.line(self._surface, color, (0, y), (self._width, y))

    def _draw_header(self, view: AppView, accent: Any) -> None:
        margin = max(8, self._width // 40)
        title = self._small.render("MUSE CAM", True, "#f6f2e8")
        self._surface.blit(title, (margin, margin))

        status_parts: list[str] = []
        if not view.network_online:
            status_parts.append("OFFLINE")
        if view.queued:
            status_parts.append(f"{view.queued} QUEUED")
        if view.battery is not None:
            status_parts.append(f"{view.battery}%")
        status = "  ·  ".join(status_parts)
        if status:
            rendered = self._small.render(status, True, accent)
            self._surface.blit(rendered, (self._width - rendered.get_width() - margin, margin))

    def _draw_state(self, view: AppView, accent: Any) -> None:
        center = (self._width // 2, self._height // 2 - self._height // 18)
        if view.state in {ScreenState.CAPTURING, ScreenState.PROCESSING, ScreenState.SHARING}:
            radius = max(22, self._height // 9)
            self._pygame.draw.circle(self._surface, (5, 10, 11, 195), center, radius + 15)
            angle = time.monotonic() * 4
            start = (center[0] + math.cos(angle) * radius, center[1] + math.sin(angle) * radius)
            self._pygame.draw.circle(
                self._surface, accent, center, radius, width=max(4, radius // 6)
            )
            self._pygame.draw.circle(self._surface, "#f6f2e8", start, max(3, radius // 8))
            label = {
                ScreenState.CAPTURING: "CAPTURING",
                ScreenState.PROCESSING: "DREAMING",
                ScreenState.SHARING: "SHARING",
            }[view.state]
            rendered = self._small.render(label, True, "#f6f2e8")
            self._surface.blit(
                rendered, (center[0] - rendered.get_width() // 2, center[1] + radius + 18)
            )
        elif view.state == ScreenState.ERROR:
            panel_width = round(self._width * 0.82)
            panel = self._pygame.Surface(
                (panel_width, max(70, self._height // 3)), self._pygame.SRCALPHA
            )
            panel.fill((8, 14, 15, 225))
            self._surface.blit(panel, ((self._width - panel_width) // 2, self._height // 4))
            title = self._medium.render("SAVED FOR LATER", True, accent)
            self._surface.blit(title, (center[0] - title.get_width() // 2, self._height // 4 + 12))
            self._draw_centered_message(
                view.message or "Try again when the connection returns.", self._height // 4 + 42
            )
        elif view.state == ScreenState.SHUTTING_DOWN:
            shade = self._pygame.Surface((self._width, self._height), self._pygame.SRCALPHA)
            shade.fill((0, 0, 0, 220))
            self._surface.blit(shade, (0, 0))
            title = self._large.render("GOOD NIGHT", True, "#f6f2e8")
            self._surface.blit(
                title, (center[0] - title.get_width() // 2, center[1] - title.get_height())
            )
        elif view.state == ScreenState.RESULT:
            tag = "SHARED" if view.shared else "MUSE MADE"
            rendered = self._small.render(tag, True, "#111718")
            padding = 8
            rect = self._pygame.Rect(
                self._width - rendered.get_width() - padding * 2 - 10,
                max(40, self._height // 7),
                rendered.get_width() + padding * 2,
                rendered.get_height() + 5,
            )
            self._pygame.draw.rect(self._surface, accent, rect, border_radius=rect.height // 2)
            self._surface.blit(rendered, (rect.x + padding, rect.y + 2))
            if view.message:
                message_panel = self._pygame.Surface(
                    (round(self._width * 0.82), 52), self._pygame.SRCALPHA
                )
                message_panel.fill((5, 10, 11, 205))
                self._surface.blit(
                    message_panel,
                    ((self._width - message_panel.get_width()) // 2, self._height // 2 - 28),
                )
                self._draw_centered_message(view.message, self._height // 2 - 17)

    def _draw_centered_message(self, message: str, y: int) -> None:
        words = message.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if self._small.size(candidate)[0] <= self._width * 0.7:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        for index, line in enumerate(lines[:2]):
            rendered = self._small.render(line, True, "#d8dedb")
            self._surface.blit(
                rendered, ((self._width - rendered.get_width()) // 2, y + index * 19)
            )

    def _draw_controls(self, view: AppView, accent: Any, bottom_height: int) -> None:
        top = self._height - bottom_height
        labels = ("PREV", "SNAP", "NEXT", "SHARE")
        if view.state == ScreenState.RESULT:
            labels = ("PREV", "AGAIN", "NEXT", "SHARED" if view.shared else "SHARE")
        segment_width = self._width / 4
        for index, label in enumerate(labels):
            x = round(index * segment_width)
            if index:
                self._pygame.draw.line(
                    self._surface, "#425052", (x, top + 10), (x, self._height - 10)
                )
            color = accent if index in {1, 3} else "#f6f2e8"
            rendered = self._small.render(label, True, color)
            self._surface.blit(
                rendered,
                (
                    x + (segment_width - rendered.get_width()) / 2,
                    top + (bottom_height - rendered.get_height()) / 2,
                ),
            )

        preset = self._medium.render(view.preset.name.upper(), True, "#f6f2e8")
        preset_y = top - preset.get_height() - 8
        self._surface.blit(preset, (10, preset_y))
        self._pygame.draw.rect(
            self._surface, accent, (10, preset_y - 4, max(26, self._width // 10), 3)
        )

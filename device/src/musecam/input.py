from __future__ import annotations

import os
import time
from typing import Any

from .config import HardwareProfile
from .models import Action


class InputManager:
    def __init__(self, profile: HardwareProfile, *, simulate: bool) -> None:
        import pygame

        self._pygame = pygame
        self._width = profile.display_width
        self._height = profile.display_height
        self._shutter: Any | None = None
        self._power: Any | None = None
        self._shutter_was_pressed = False
        self._power_started_at: float | None = None
        self._power_emitted = False
        self._touch_device: Any | None = None
        self._touch_ecodes: Any | None = None
        self._touch_x = 0
        self._touch_y = 0
        self._touch_pressed = False
        self._touch_x_range = (0, self._width - 1)
        self._touch_y_range = (0, self._height - 1)
        self._touch_swap_xy = profile.touch_swap_xy
        self._touch_invert_x = profile.touch_invert_x
        self._touch_invert_y = profile.touch_invert_y

        if not simulate:
            try:
                from gpiozero import Button
            except ImportError as error:
                raise RuntimeError("gpiozero is not installed") from error
            if profile.shutter_gpio is not None:
                self._shutter = Button(profile.shutter_gpio, pull_up=True, bounce_time=0.05)
            if profile.power_gpio is not None:
                self._power = Button(profile.power_gpio, pull_up=True, bounce_time=0.05)
            if profile.input_backend == "evdev-touch":
                self._setup_touchscreen()

    def poll(self) -> list[Action]:
        actions: list[Action] = []
        for event in self._pygame.event.get():
            if event.type == self._pygame.QUIT:
                actions.append(Action.QUIT)
            elif event.type == self._pygame.KEYDOWN:
                action = self._key_action(event.key)
                if action:
                    actions.append(action)
            elif event.type == self._pygame.MOUSEBUTTONUP and event.button == 1:
                actions.append(self._touch_action(*event.pos))

        if self._shutter is not None:
            pressed = bool(self._shutter.is_pressed)
            if pressed and not self._shutter_was_pressed:
                actions.append(Action.SHUTTER)
            self._shutter_was_pressed = pressed

        if self._power is not None:
            pressed = bool(self._power.is_pressed)
            if pressed and self._power_started_at is None:
                self._power_started_at = time.monotonic()
                self._power_emitted = False
            elif not pressed:
                self._power_started_at = None
                self._power_emitted = False
            elif (
                self._power_started_at is not None
                and not self._power_emitted
                and time.monotonic() - self._power_started_at >= 1.5
            ):
                actions.append(Action.POWER)
                self._power_emitted = True

        actions.extend(self._poll_touchscreen())

        return actions

    def _setup_touchscreen(self) -> None:
        try:
            from evdev import InputDevice, ecodes, list_devices
        except ImportError as error:
            raise RuntimeError("python3-evdev is required for the touchscreen") from error

        candidates = []
        for path in list_devices():
            device = InputDevice(path)
            capabilities = device.capabilities()
            absolute_codes = {
                item[0] if isinstance(item, tuple) else item
                for item in capabilities.get(ecodes.EV_ABS, [])
            }
            has_x = bool({ecodes.ABS_X, ecodes.ABS_MT_POSITION_X} & absolute_codes)
            has_y = bool({ecodes.ABS_Y, ecodes.ABS_MT_POSITION_Y} & absolute_codes)
            if not (has_x and has_y):
                device.close()
                continue
            key_codes = set(capabilities.get(ecodes.EV_KEY, []))
            score = int("touch" in device.name.lower()) * 2 + int(ecodes.BTN_TOUCH in key_codes)
            candidates.append((score, device, absolute_codes))
        if not candidates:
            raise RuntimeError("No evdev touchscreen was found")
        candidates.sort(key=lambda item: item[0], reverse=True)
        _, self._touch_device, absolute_codes = candidates[0]
        for _, device, _ in candidates[1:]:
            if device is not self._touch_device:
                device.close()
        os.set_blocking(self._touch_device.fd, False)
        self._touch_ecodes = ecodes

        x_code = ecodes.ABS_X if ecodes.ABS_X in absolute_codes else ecodes.ABS_MT_POSITION_X
        y_code = ecodes.ABS_Y if ecodes.ABS_Y in absolute_codes else ecodes.ABS_MT_POSITION_Y
        x_info = self._touch_device.absinfo(x_code)
        y_info = self._touch_device.absinfo(y_code)
        if x_info:
            self._touch_x_range = (x_info.min, x_info.max)
        if y_info:
            self._touch_y_range = (y_info.min, y_info.max)

    def _poll_touchscreen(self) -> list[Action]:
        if self._touch_device is None or self._touch_ecodes is None:
            return []
        ecodes = self._touch_ecodes
        actions: list[Action] = []
        try:
            events = list(self._touch_device.read())
        except BlockingIOError:
            return []
        for event in events:
            if event.type == ecodes.EV_ABS:
                if event.code in {ecodes.ABS_X, ecodes.ABS_MT_POSITION_X}:
                    self._touch_x = event.value
                elif event.code in {ecodes.ABS_Y, ecodes.ABS_MT_POSITION_Y}:
                    self._touch_y = event.value
                elif event.code == ecodes.ABS_MT_TRACKING_ID:
                    if event.value >= 0:
                        self._touch_pressed = True
                    elif self._touch_pressed:
                        self._touch_pressed = False
                        x, y = self._scaled_touch_position()
                        actions.append(self._touch_action(x, y))
            elif event.type == ecodes.EV_KEY and event.code in {
                ecodes.BTN_TOUCH,
                ecodes.BTN_LEFT,
            }:
                if event.value:
                    self._touch_pressed = True
                elif self._touch_pressed:
                    self._touch_pressed = False
                    x, y = self._scaled_touch_position()
                    actions.append(self._touch_action(x, y))
        return actions

    def _scaled_touch_position(self) -> tuple[int, int]:
        def scale(value: int, limits: tuple[int, int], size: int) -> int:
            minimum, maximum = limits
            if maximum <= minimum:
                return 0
            return round((value - minimum) / (maximum - minimum) * (size - 1))

        if self._touch_swap_xy:
            x = scale(self._touch_y, self._touch_y_range, self._width)
            y = scale(self._touch_x, self._touch_x_range, self._height)
        else:
            x = scale(self._touch_x, self._touch_x_range, self._width)
            y = scale(self._touch_y, self._touch_y_range, self._height)
        if self._touch_invert_x:
            x = self._width - 1 - x
        if self._touch_invert_y:
            y = self._height - 1 - y
        return x, y

    def _key_action(self, key: int) -> Action | None:
        mapping = {
            self._pygame.K_LEFT: Action.PREVIOUS,
            self._pygame.K_a: Action.PREVIOUS,
            self._pygame.K_RIGHT: Action.NEXT,
            self._pygame.K_d: Action.NEXT,
            self._pygame.K_SPACE: Action.SHUTTER,
            self._pygame.K_RETURN: Action.SHUTTER,
            self._pygame.K_s: Action.SHARE,
            self._pygame.K_BACKSPACE: Action.BACK,
            self._pygame.K_ESCAPE: Action.BACK,
            self._pygame.K_p: Action.POWER,
            self._pygame.K_q: Action.QUIT,
        }
        return mapping.get(key)

    def _touch_action(self, x: int, y: int) -> Action:
        if y < self._height - max(54, self._height // 5):
            return Action.SHUTTER
        segment = min(3, max(0, int(x / (self._width / 4))))
        return (Action.PREVIOUS, Action.SHUTTER, Action.NEXT, Action.SHARE)[segment]

    def close(self) -> None:
        if self._shutter is not None:
            self._shutter.close()
        if self._power is not None:
            self._power.close()
        if self._touch_device is not None:
            self._touch_device.close()

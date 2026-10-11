"""Image models for standalone cameras, which call the provider directly.

This mirrors the server's web/src/lib/model: the same prompts, request shape, and
error handling, without a Muse Cam server in between.
"""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from importlib.resources import files
from io import BytesIO
from typing import Any, Protocol

import httpx
from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps

from .config import DeviceConfig

META_IMAGE_EDIT_URL = "https://api.meta.ai/v1/images/edits"
META_IMAGE_MODEL = "muse-image-1.0"
OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare"
API_KEY_NAMES = {"meta": "META_API_KEY", "openai": "OPENAI_API_KEY"}
DEFAULT_MODELS = {"meta": META_IMAGE_MODEL, "openai": OPENAI_IMAGE_MODEL, "mock": "mock"}
TIMEOUT = httpx.Timeout(240.0, connect=20.0)

BUSY_MESSAGE = "Service busy. Saved for automatic retry."
FILTERED_MESSAGE = "Try another style or framing."
FAILED_MESSAGE = "Remix failed. Use Retry or Restyle."


@dataclass(frozen=True)
class StylePrompt:
    id: str
    name: str
    accent: str
    prompt: str


STYLE_PROMPTS = {
    value["id"]: StylePrompt(value["id"], value["name"], value["accent"], value["prompt"])
    for value in json.loads(files("musecam").joinpath("standalone-presets.json").read_text())
}


class ImageModelError(Exception):
    """A gallery-ready message. ``retry`` keeps the photo queued for another attempt."""

    def __init__(self, message: str, *, retry: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.retry = retry


class ImageModel(Protocol):
    def transform(self, image: bytes, style: StylePrompt) -> bytes: ...

    def close(self) -> None: ...


def style_prompt(preset_id: str) -> StylePrompt:
    style = STYLE_PROMPTS.get(preset_id)
    if style is None:
        raise ImageModelError("This style isn’t available on this camera. Use Restyle.")
    return style


def _error_message(payload: Any) -> tuple[str | None, str | None]:
    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return None, None
    message = error.get("message")
    code = error.get("code")
    return (
        message if isinstance(message, str) else None,
        code if isinstance(code, str) else None,
    )


def _status_error(provider: str, status: int, payload: Any) -> ImageModelError:
    message, code = _error_message(payload)
    if status in {401, 403}:
        return ImageModelError(
            f"The API key was rejected. Check {API_KEY_NAMES[provider]} in /etc/musecam/device.env."
        )
    if code == "insufficient_quota":
        return ImageModelError("The API account is out of credit.")
    if status in {408, 409, 429} or status >= 500:
        return ImageModelError(BUSY_MESSAGE, retry=True)
    detail = (message or "").lower()
    if code == "moderation_blocked" or (
        status == 400 and ("filtered" in detail or "content management policy" in detail)
    ):
        return ImageModelError(FILTERED_MESSAGE)
    return ImageModelError(FAILED_MESSAGE)


def _json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


class _HttpImageModel:
    provider: str

    def __init__(self, api_key: str, model: str | None, client: httpx.Client | None) -> None:
        self._api_key = api_key
        self.model = model or DEFAULT_MODELS[self.provider]
        self._client = client or httpx.Client(timeout=TIMEOUT)

    def close(self) -> None:
        self._client.close()

    def _require_key(self) -> None:
        if not self._api_key:
            name = API_KEY_NAMES[self.provider]
            raise ImageModelError(
                f"Add {name} to /etc/musecam/device.env, then restart the camera."
            )

    def _image(self, response: httpx.Response) -> bytes:
        payload = _json(response)
        if not response.is_success:
            raise _status_error(self.provider, response.status_code, payload)
        data = payload.get("data") if isinstance(payload, dict) else None
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("b64_json"), str) and item["b64_json"]:
                return base64.b64decode(item["b64_json"])
            url = item.get("url")
            if isinstance(url, str) and url.startswith("data:image/") and ";base64," in url:
                return base64.b64decode(url.split(";base64,", 1)[1])
            if isinstance(url, str) and url.startswith("https://"):
                download = self._client.get(url, timeout=60.0)
                download.raise_for_status()
                return download.content
        raise ImageModelError(FAILED_MESSAGE)


class MetaMuseImage(_HttpImageModel):
    """Muse Image through Meta's Model API, as the server's MetaMuseProvider calls it."""

    provider = "meta"

    def transform(self, image: bytes, style: StylePrompt) -> bytes:
        self._require_key()
        image_url = f"data:image/jpeg;base64,{base64.b64encode(image).decode('ascii')}"
        response = self._client.post(
            META_IMAGE_EDIT_URL,
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "model": self.model,
                "prompt": style.prompt,
                "images": [{"image_url": image_url}],
                "n": 1,
                "response_format": "b64_json",
                "output_format": "jpeg",
                "reasoning_strength": "low",
                "tool_enablement": {
                    "enable_image_search": False,
                    "enable_web_search": False,
                    "enable_shell": False,
                },
            },
        )
        return self._image(response)


class OpenAIImage(_HttpImageModel):
    """OpenAI's GPT Image edits endpoint. The prompts were tuned on Muse Image."""

    provider = "openai"

    def transform(self, image: bytes, style: StylePrompt) -> bytes:
        self._require_key()
        response = self._client.post(
            OPENAI_IMAGE_EDIT_URL,
            headers={"Authorization": f"Bearer {self._api_key}"},
            data={
                "model": self.model,
                "prompt": style.prompt,
                "n": "1",
                "output_format": "jpeg",
                # Keep faces and composition close to the photo, as the prompts ask.
                "input_fidelity": "high",
            },
            files={"image": ("photo.jpg", image, "image/jpeg")},
        )
        return self._image(response)


class MockImageModel:
    """No network or key: tints the photo and labels it, like the server's mock."""

    model = "mock"

    def __init__(self, delay: float = 1.2) -> None:
        self._delay = delay

    def close(self) -> None:
        pass

    def transform(self, image: bytes, style: StylePrompt) -> bytes:
        # A visible pause keeps processing states observable in the simulator.
        time.sleep(self._delay)
        with Image.open(BytesIO(image)) as opened:
            photo = ImageOps.exif_transpose(opened).convert("RGB")
        tint = Image.new("RGB", photo.size, ImageColor.getrgb(style.accent))
        result = Image.blend(photo, tint, 0.28)
        draw = ImageDraw.Draw(result)
        height = max(28, result.height // 14)
        draw.rectangle((0, result.height - height, result.width, result.height), fill="#171713")
        try:
            font = ImageFont.load_default(size=int(height * 0.6))
        except TypeError:  # Pillow before 10.1 has only the small bitmap font.
            font = ImageFont.load_default()
        draw.text(
            (height // 2, result.height - height * 0.8),
            f"MOCK · {style.name.upper()}",
            fill="white",
            font=font,
        )
        output = BytesIO()
        result.save(output, "JPEG", quality=88)
        return output.getvalue()


def create_image_model(config: DeviceConfig, *, offline: bool = False) -> ImageModel:
    provider = "mock" if offline else config.model_provider
    if provider == "mock":
        return MockImageModel()
    model = config.environment.get("MUSECAM_MODEL_ID") or None
    api_key = config.environment.get(API_KEY_NAMES[provider], "")
    if provider == "openai":
        return OpenAIImage(api_key, model, None)
    return MetaMuseImage(api_key, model, None)


def describe_image_model(config: DeviceConfig) -> dict[str, str]:
    """Provider, model, and whether the key is set, without revealing the key."""
    provider = config.model_provider
    description = {
        "mode": config.mode,
        "provider": provider,
        "model": config.environment.get("MUSECAM_MODEL_ID") or DEFAULT_MODELS[provider],
    }
    if provider in API_KEY_NAMES:
        name = API_KEY_NAMES[provider]
        is_set = bool(config.environment.get(name))
        description["apiKey"] = f"{name} is {'set' if is_set else 'missing'}"
    return description

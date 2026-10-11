from __future__ import annotations

import base64
import json
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from PIL import Image

from musecam.app import FALLBACK_PRESETS
from musecam.config import DeviceConfig
from musecam.image_model import (
    BUSY_MESSAGE,
    FAILED_MESSAGE,
    FILTERED_MESSAGE,
    META_IMAGE_EDIT_URL,
    OPENAI_IMAGE_EDIT_URL,
    STYLE_PROMPTS,
    ImageModelError,
    MetaMuseImage,
    MockImageModel,
    OpenAIImage,
    create_image_model,
    describe_image_model,
    style_prompt,
)


def jpeg(color: str = "orange", size: tuple[int, int] = (64, 48)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color).save(output, "JPEG")
    return output.getvalue()


RESULT = jpeg("purple")
STYLE = style_prompt("alien-visitor")


def client_for(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_every_bundled_style_has_a_prompt() -> None:
    assert [preset.id for preset in FALLBACK_PRESETS] == list(STYLE_PROMPTS)
    assert all(len(style.prompt) > 24 for style in STYLE_PROMPTS.values())
    with pytest.raises(ImageModelError, match="isn’t available"):
        style_prompt("retired-or-event-only")


def test_meta_request_matches_the_server_provider() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"data": [{"b64_json": base64.b64encode(RESULT).decode()}]},
        )

    model = MetaMuseImage("meta-key", None, client_for(handler))
    assert model.transform(jpeg(), STYLE) == RESULT

    [request] = requests
    assert str(request.url) == META_IMAGE_EDIT_URL
    assert request.headers["Authorization"] == "Bearer meta-key"
    body = json.loads(request.content)
    assert body["model"] == "muse-image-1.0"
    assert body["prompt"] == STYLE.prompt
    assert body["images"][0]["image_url"].startswith("data:image/jpeg;base64,")
    assert base64.b64decode(body["images"][0]["image_url"].split(",", 1)[1]) == jpeg()
    assert body["response_format"] == "b64_json"
    assert body["output_format"] == "jpeg"
    assert not any(body["tool_enablement"].values())


def test_meta_accepts_data_and_https_url_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=RESULT)
        data_url = f"data:image/jpeg;base64,{base64.b64encode(RESULT).decode()}"
        url = "https://cdn.example/out.jpg" if "remote" in request.content.decode() else data_url
        return httpx.Response(200, json={"data": [{"url": url}]})

    model = MetaMuseImage("meta-key", None, client_for(handler))
    assert model.transform(jpeg(), STYLE) == RESULT
    remote = STYLE.__class__(STYLE.id, STYLE.name, STYLE.accent, "remote please")
    assert model.transform(jpeg(), remote) == RESULT


@pytest.mark.parametrize(
    ("status", "payload", "message", "retry"),
    (
        (429, {"error": {"message": "slow down"}}, BUSY_MESSAGE, True),
        (503, None, BUSY_MESSAGE, True),
        (
            400,
            {"error": {"message": "Filtered by content management policy"}},
            FILTERED_MESSAGE,
            False,
        ),
        (401, {"error": {"message": "bad key"}}, "Check META_API_KEY", False),
        (400, {"error": {"message": "bad request"}}, FAILED_MESSAGE, False),
        (200, {"data": []}, FAILED_MESSAGE, False),
    ),
)
def test_meta_errors_become_gallery_messages(status, payload, message, retry) -> None:
    model = MetaMuseImage(
        "meta-key", None, client_for(lambda request: httpx.Response(status, json=payload))
    )

    with pytest.raises(ImageModelError, match=message) as error:
        model.transform(jpeg(), STYLE)
    assert error.value.retry is retry


def test_openai_sends_the_photo_as_a_multipart_edit() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(RESULT).decode()}]})

    model = OpenAIImage("openai-key", "gpt-image-custom", client_for(handler))
    assert model.transform(jpeg(), STYLE) == RESULT

    [request] = requests
    assert str(request.url) == OPENAI_IMAGE_EDIT_URL
    assert request.headers["Authorization"] == "Bearer openai-key"
    assert request.headers["Content-Type"].startswith("multipart/form-data")
    body = request.content
    assert b'name="model"\r\n\r\ngpt-image-custom' in body
    assert b'name="prompt"\r\n\r\n' + STYLE.prompt.encode() in body
    assert b'name="image"; filename="photo.jpg"' in body
    assert jpeg() in body


@pytest.mark.parametrize(
    ("status", "error", "message", "retry"),
    (
        (400, {"code": "moderation_blocked", "message": "blocked"}, FILTERED_MESSAGE, False),
        (429, {"code": "insufficient_quota", "message": "quota"}, "out of credit", False),
        (429, {"code": "rate_limit_exceeded", "message": "slow"}, BUSY_MESSAGE, True),
        (401, {"code": "invalid_api_key", "message": "bad"}, "Check OPENAI_API_KEY", False),
    ),
)
def test_openai_errors_become_gallery_messages(status, error, message, retry) -> None:
    model = OpenAIImage(
        "openai-key",
        None,
        client_for(lambda request: httpx.Response(status, json={"error": error})),
    )

    with pytest.raises(ImageModelError, match=message) as raised:
        model.transform(jpeg(), STYLE)
    assert raised.value.retry is retry


def test_missing_key_explains_the_fix_without_calling_the_api() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("No request should be sent without a key")

    for model, name in (
        (MetaMuseImage("", None, client_for(handler)), "META_API_KEY"),
        (OpenAIImage("", None, client_for(handler)), "OPENAI_API_KEY"),
    ):
        with pytest.raises(ImageModelError, match=f"Add {name} to /etc/musecam/device.env"):
            model.transform(jpeg(), STYLE)


def test_mock_labels_a_tinted_copy() -> None:
    result = MockImageModel(delay=0).transform(jpeg(size=(320, 240)), STYLE)

    with Image.open(BytesIO(result)) as image:
        assert image.format == "JPEG"
        assert image.size == (320, 240)


def config(tmp_path: Path, **values) -> DeviceConfig:
    return DeviceConfig(
        server_url="",
        device_token="",
        data_dir=tmp_path,
        mode="standalone",
        model_provider=values.pop("provider", "meta"),
        environment=values,
    )


def test_factory_picks_the_provider_key_and_model(tmp_path: Path) -> None:
    openai = create_image_model(
        config(tmp_path, provider="openai", OPENAI_API_KEY="o-key", MUSECAM_MODEL_ID="gpt-x")
    )
    meta = create_image_model(config(tmp_path, META_API_KEY="m-key"))
    offline = create_image_model(config(tmp_path, META_API_KEY="m-key"), offline=True)
    try:
        assert isinstance(openai, OpenAIImage) and openai.model == "gpt-x"
        assert isinstance(meta, MetaMuseImage) and meta.model == "muse-image-1.0"
        assert isinstance(offline, MockImageModel)
    finally:
        openai.close()
        meta.close()


def test_description_reports_the_key_without_revealing_it(tmp_path: Path) -> None:
    present = describe_image_model(config(tmp_path, META_API_KEY="m-secret-value"))
    missing = describe_image_model(config(tmp_path, provider="openai"))

    assert present == {
        "mode": "standalone",
        "provider": "meta",
        "model": "muse-image-1.0",
        "apiKey": "META_API_KEY is set",
    }
    assert "m-secret-value" not in json.dumps(present)
    assert missing["apiKey"] == "OPENAI_API_KEY is missing"
    assert missing["model"] == "gpt-image-2.5-flare"

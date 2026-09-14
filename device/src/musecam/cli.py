from __future__ import annotations

import argparse
import json
import logging
import os
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .app import MuseCamApp
from .client import MuseCamClient
from .config import DEFAULT_CONFIG_PATH, load_config, load_profile
from .diagnostics import run_diagnostics


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="musecam")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("health", help="Check the deployed API")
    subcommands.add_parser("presets", help="List available style presets")

    claim = subcommands.add_parser("claim", help="Register this camera with a setup code")
    claim.add_argument("code")
    claim.add_argument("--name", help="Camera name (otherwise uses the admin suggestion)")
    claim.add_argument("--server", help="Registration server URL")

    submit = subcommands.add_parser("submit", help="Submit an existing image")
    submit.add_argument("image", type=Path)
    submit.add_argument("--preset", default="alien-visitor")
    submit.add_argument("--capture-id")
    submit.add_argument("--output", type=Path, default=Path("musecam-result.jpg"))
    submit.add_argument("--share", action="store_true")

    run = subcommands.add_parser("run", help="Start the full-screen camera application")
    run.add_argument("--profile", help="Override MUSECAM_PROFILE")
    run.add_argument("--simulate", action="store_true", help="Use a desktop test camera and window")
    run.add_argument("--windowed", action="store_true", help="Do not use full-screen display mode")
    run.add_argument("--offline", action="store_true", help="Use local presets and skip API calls")
    run.add_argument("--frames", type=int, help=argparse.SUPPRESS)
    run.add_argument("--screenshot", type=Path, help=argparse.SUPPRESS)
    run.add_argument("--capture-on-start", action="store_true", help=argparse.SUPPRESS)

    serve = subcommands.add_parser("serve", help="Start the local browser camera application")
    serve.add_argument("--profile", help="Override MUSECAM_PROFILE")
    serve.add_argument("--simulate", action="store_true", help="Use the desktop test camera")
    serve.add_argument(
        "--offline", action="store_true", help="Use local presets and skip API calls"
    )
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8080)

    doctor = subcommands.add_parser("doctor", help="Check camera, display, GPIO, storage, and API")
    doctor.add_argument("--profile", help="Override MUSECAM_PROFILE")
    doctor.add_argument("--json", action="store_true")
    return parser


def _json_value(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def _print_json(value: Any) -> None:
    print(json.dumps(value, indent=2, default=_json_value))


def _run_api_command(args: argparse.Namespace) -> int:
    client = MuseCamClient(load_config(args.config))
    try:
        if args.command == "health":
            result: Any = client.health()
        elif args.command == "presets":
            result = {"presets": client.presets()}
        else:
            capture_id = args.capture_id or f"cli_{int(time.time())}"
            generation = client.generate(args.image, capture_id, args.preset)
            result = asdict(generation)
            if generation.image_url:
                client.download_result(generation.image_url, args.output)
                result["downloadedTo"] = str(args.output)
            if args.share:
                generation = client.share(generation.id)
                result = asdict(generation)
        _print_json(result)
        return 0
    finally:
        client.close()


def _update_env_file(path: Path, values: dict[str, str]) -> None:
    existing: list[str] = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    remaining = dict(values)
    output: list[str] = []
    for line in existing:
        if "=" not in line or line.lstrip().startswith("#"):
            output.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in remaining:
            output.append(f"{key}={remaining.pop(key)}")
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in remaining.items())
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o640)
    temporary.replace(path)


def _run_claim(args: argparse.Namespace) -> int:
    import httpx

    existing = load_config(args.config, require_credentials=False)
    server_url = (args.server or (existing.server_url if args.config.exists() else None))
    server_url = (server_url or "https://www.muse-cam.com").rstrip("/")
    payload = {"code": args.code}
    if args.name:
        payload["name"] = args.name
    response = httpx.post(f"{server_url}/api/device/claim", json=payload, timeout=20)
    if not response.is_success:
        try:
            message = response.json().get("error", "Registration failed")
        except (ValueError, AttributeError):
            message = "Registration failed"
        raise RuntimeError(f"{message} ({response.status_code})")
    registration = response.json()
    _update_env_file(
        args.config,
        {
            "MUSECAM_SERVER_URL": str(registration["serverUrl"]).rstrip("/"),
            "MUSECAM_DEVICE_TOKEN": str(registration["token"]),
            "MUSECAM_DEVICE_ID": str(registration["deviceId"]),
        },
    )
    print(f"Registered {registration['deviceName']} ({registration['deviceId']})")
    print("Restart musecam.service to use the new credential.")
    return 0


def _run_app(args: argparse.Namespace) -> int:
    config = load_config(args.config, require_credentials=not args.offline)
    profile = load_profile(
        args.profile or config.profile_id, config.profiles_dir, power_backend=config.power_backend
    )
    logging.basicConfig(
        level=getattr(logging, config.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    app = MuseCamApp(
        config,
        profile,
        simulate=args.simulate,
        windowed=args.windowed,
        offline=args.offline,
    )
    app.run(
        max_frames=args.frames,
        screenshot=args.screenshot,
        capture_on_start=args.capture_on_start,
    )
    return 0


def _run_doctor(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    profile = load_profile(
        args.profile or config.profile_id, config.profiles_dir, power_backend=config.power_backend
    )
    checks = run_diagnostics(config, profile)
    if args.json:
        _print_json({"profile": profile.id, "checks": [check.to_dict() for check in checks]})
    else:
        print(f"Muse Cam diagnostics — {profile.id}\n")
        for check in checks:
            marker = {"ok": "✓", "warning": "!", "failed": "✗"}[check.status]
            print(f"{marker} {check.name}: {check.detail}")
    return 1 if any(check.status == "failed" for check in checks) else 0


def _run_web_app(args: argparse.Namespace) -> int:
    from .webapp import run_web_app

    config = load_config(args.config, require_credentials=not args.offline)
    profile = load_profile(
        args.profile or config.profile_id, config.profiles_dir, power_backend=config.power_backend
    )
    logging.basicConfig(
        level=getattr(logging, config.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run_web_app(
        config,
        profile,
        simulate=args.simulate,
        offline=args.offline,
        host=args.host,
        port=args.port,
    )
    return 0


def main() -> None:
    args = build_parser().parse_args()
    if args.command in {"health", "presets", "submit"}:
        exit_code = _run_api_command(args)
    elif args.command == "claim":
        exit_code = _run_claim(args)
    elif args.command == "run":
        exit_code = _run_app(args)
    elif args.command == "serve":
        exit_code = _run_web_app(args)
    else:
        exit_code = _run_doctor(args)
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
import logging
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


def _run_app(args: argparse.Namespace) -> int:
    config = load_config(args.config, require_credentials=not args.offline)
    profile = load_profile(args.profile or config.profile_id, config.profiles_dir)
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
    profile = load_profile(args.profile or config.profile_id, config.profiles_dir)
    checks = run_diagnostics(config, profile)
    if args.json:
        _print_json({"profile": profile.id, "checks": [check.to_dict() for check in checks]})
    else:
        print(f"Muse Cam diagnostics — {profile.id}\n")
        for check in checks:
            marker = {"ok": "✓", "warning": "!", "failed": "✗"}[check.status]
            print(f"{marker} {check.name}: {check.detail}")
    return 1 if any(check.status == "failed" for check in checks) else 0


def main() -> None:
    args = build_parser().parse_args()
    if args.command in {"health", "presets", "submit"}:
        exit_code = _run_api_command(args)
    elif args.command == "run":
        exit_code = _run_app(args)
    else:
        exit_code = _run_doctor(args)
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()

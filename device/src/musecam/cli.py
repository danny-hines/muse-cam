from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .client import MuseCamClient
from .config import DEFAULT_CONFIG_PATH, load_config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="musecam")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("health")
    subcommands.add_parser("presets")

    submit = subcommands.add_parser("submit")
    submit.add_argument("image", type=Path)
    submit.add_argument("--preset", default="alien-visitor")
    submit.add_argument("--capture-id")
    submit.add_argument("--output", type=Path, default=Path("musecam-result.jpg"))
    submit.add_argument("--share", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    client = MuseCamClient(load_config(args.config))
    try:
        if args.command == "health":
            result = client.health()
        elif args.command == "presets":
            result = client.presets()
        else:
            capture_id = args.capture_id or f"cli_{int(time.time())}"
            result = client.generate(args.image, capture_id, args.preset)
            image_url = result.get("imageUrl")
            if image_url:
                client.download_result(image_url, args.output)
                result["downloadedTo"] = str(args.output)
            if args.share:
                result = client.share(result["id"])
        print(json.dumps(result, indent=2))
    finally:
        client.close()


if __name__ == "__main__":
    main()

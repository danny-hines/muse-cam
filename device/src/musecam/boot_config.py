"""Camera boot selection used by the installer; never run by normal software updates."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from .config import load_profile

BEGIN = "# BEGIN Muse Cam camera"
END = "# END Muse Cam camera"
CAMERA_OVERLAYS = {"imx415", "imx519", "imx708"}


def camera_boot_config(text: str, overlay: str) -> str:
    if overlay not in CAMERA_OVERLAYS | {"auto"}:
        raise ValueError(f"Unsupported camera overlay: {overlay}")
    output: list[str] = []
    selected = None
    in_block = False
    for line in text.splitlines():
        if line == BEGIN:
            if in_block:
                raise ValueError("Nested Muse Cam camera block in boot config")
            in_block = True
            continue
        if line == END:
            if not in_block:
                raise ValueError("Unexpected Muse Cam camera block end")
            in_block = False
            continue
        directive = line.split("#", 1)[0].strip()
        match = re.fullmatch(r"dtoverlay=(imx415|imx519|imx708)([, :].*)?", directive)
        if match and match[1] == overlay:
            # Keep calibrated orientation/other sensor parameters on same-camera reinstalls.
            selected = directive
        if in_block:
            continue
        if match or re.match(r"camera_auto_detect\s*=", directive):
            output.append(f"# superseded by Muse Cam camera selection: {line}")
        else:
            output.append(line)
    if in_block:
        raise ValueError("Unterminated Muse Cam camera block in boot config")
    block = [BEGIN, "[all]", f"camera_auto_detect={int(overlay == 'auto')}"]
    if overlay != "auto":
        block.append(selected or f"dtoverlay={overlay}")
    block.append(END)
    return "\n".join(output).rstrip() + "\n\n" + "\n".join(block) + "\n"


def configure_camera(path: Path, overlay: str, overlays_dir: Path) -> bool:
    if overlay != "auto" and not (overlays_dir / f"{overlay}.dtbo").is_file():
        raise ValueError(
            f"Missing {overlay}.dtbo in {overlays_dir}. Install the camera driver first; "
            "see docs/CAMERAS.md (IMX519 needs Arducam's camera packages)."
        )
    original = path.read_text()
    updated = camera_boot_config(original, overlay)
    if original == updated:
        return False
    backup = path.with_name(f"{path.name}.musecam-{time.time_ns()}.bak")
    shutil.copy2(path, backup)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(updated)
        os.chmod(temporary, path.stat().st_mode & 0o777)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--profiles-dir", type=Path, required=True)
    parser.add_argument("--boot-config", type=Path, required=True)
    parser.add_argument("--overlays-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        profile = load_profile(args.profile, args.profiles_dir)
        changed = configure_camera(args.boot_config, profile.camera_overlay, args.overlays_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Camera configuration failed: {error}\n")
    print("changed" if changed else "unchanged")


if __name__ == "__main__":
    main()

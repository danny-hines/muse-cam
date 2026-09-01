# Raspberry Pi bring-up

Muse Cam uses a native Python/Pygame application rather than Chromium. Camera capture, the UI, buttons, and local persistence all remain responsive while the network request runs in a background worker.

## Supported profiles

| Profile | Board | Display/input | Camera | Battery |
| --- | --- | --- | --- | --- |
| `pi3bplus-imx415-tft35` | Pi 3B+ | 480×320 RGB565 framebuffer plus evdev touch | Picamera2, 1920×1280 still | PiSugar S Plus; no telemetry |
| `zero2-cam3-displayhat` | Pi Zero 2 W | Pimoroni Display HAT Mini plus A/B/X/Y buttons | Picamera2, 2048×1536 still | PiSugar 2 telemetry when its manager is installed |

Both profiles reserve BCM GPIO 20 for the shutter and BCM GPIO 21 for safe shutdown. A button connects its GPIO to ground; the software enables the internal pull-up. Convenient physical pins are 38 (GPIO 20), 40 (GPIO 21), and 39 (ground). Hold the power button for 1.5 seconds to shut down cleanly.

## Prepare Raspberry Pi OS

Use a current Raspberry Pi OS Bookworm image with SSH and Wi-Fi configured. The Lite image is sufficient. Before installing:

1. Connect the CSI camera with the Pi powered off.
2. Install the TFT vendor driver on the Pi 3 so the panel appears as a 480×320 framebuffer, normally `/dev/fb1`.
3. Follow the exact camera vendor's overlay instructions. The IMX415 profile expects `dtoverlay=imx415`, but some Arducam Pivariety modules instead require `dtoverlay=arducam-pivariety`; confirm the module SKU before changing `config.txt`.
4. Do not connect the external buttons until you have checked the display board's pin use.

## One-command installation

Pi 3B+:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile pi3bplus-imx415-tft35
```

Pi Zero 2 W:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile zero2-cam3-displayhat
```

The installer asks for the Vercel URL and plaintext device token through `/dev/tty`, creates a locked-down `musecam` system user, enables SPI, installs system packages and the Python application, verifies the API, and enables `musecam.service`. Rerunning the same command performs a fast-forward update and preserves the secret. Add `--reconfigure` to replace it.

## Validate before starting the enclosure

Stop the UI while diagnosing so it does not hold the camera or display:

```bash
sudo systemctl stop musecam
sudo -u musecam /opt/muse-cam/.venv/bin/musecam doctor
sudo systemctl start musecam
```

The doctor checks the board model, Picamera2 detection, camera overlay, framebuffer or SPI display device, GPIO, writable local storage, optional PiSugar service, and the production API.

Useful commands:

```bash
systemctl status musecam
journalctl -u musecam -f
sudo systemctl restart musecam
sudo nano /etc/musecam/device.env
```

If the Pi 3 display is not `/dev/fb1`, update `MUSECAM_FRAMEBUFFER` in `/etc/musecam/device.env`. Touch orientation can be corrected in the selected TOML profile with `touch_swap_xy`, `touch_invert_x`, and `touch_invert_y`; these are intentionally left neutral until the actual panel reports its axis orientation.

## Controls

| Action | Touch | Keyboard/simulator | Display HAT Mini | External button |
| --- | --- | --- | --- | --- |
| Previous preset | `PREV` | Left / A | A | — |
| Capture | `SNAP` or preview | Space / Enter | X | GPIO 20 |
| Next preset | `NEXT` | Right / D | B | — |
| Share result | `SHARE` | S | Y | — |
| Safe shutdown | — | P | — | Hold GPIO 21 |

Unshared originals and results remain private. The latest 100 finished captures are also kept under `/var/lib/musecam` so a network interruption does not lose the photo; queued captures are never pruned. Transport failures return the UI to an offline state and are retried with the same idempotent capture ID.

## Desktop simulator

The simulator exercises the same UI and state machine without Raspberry Pi modules:

```bash
python3 -m venv .venv
.venv/bin/pip install -e './device[sim,test]'
MUSECAM_DATA_DIR=./data .venv/bin/musecam run --simulate --offline
```

Keyboard controls are shown in the table above. Remove `--offline` and pass `--config /path/to/device.env` to exercise the deployed API with the simulated camera.

## PiSugar 2 telemetry

The Zero profile reads `get battery` from `/tmp/pisugar-server.sock`. Install PiSugar Power Manager using PiSugar's official instructions if an on-screen percentage is desired. The camera works without it. PiSugar S Plus does not provide equivalent telemetry, so the Pi 3 profile deliberately omits the percentage.

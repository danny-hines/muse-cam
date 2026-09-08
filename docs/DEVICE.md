# Raspberry Pi bring-up

Muse Cam supports two display paths. The current SPI/HAT builds use the native Python/Pygame interface. The Waveshare DSI build uses a local Chromium interface backed by a Python camera service. In both cases, camera capture, buttons, credentials, persistence, and API calls remain in Python; the DSI browser only connects to `127.0.0.1`.

For the physical parts list, enclosure plan, and printable assets, see [`../hardware/README.md`](../hardware/README.md). This document remains the source of truth for software installation and device bring-up.

## Supported profiles

| Profile | Board | Display/input | Camera | Battery |
| --- | --- | --- | --- | --- |
| `pi3bplus-imx415-tft35` | Pi 3B+ | MPI3501 ILI9486 480×320 framebuffer plus XPT2046 touch | Picamera2, 1920×1280 still | PiSugar S Plus; no telemetry |
| `pi3bplus-imx415-dsi43` | Pi 3B+ | Waveshare 4.3-inch 800×480 DSI display plus capacitive touch | Picamera2, 1920×1280 still | PiSugar S Plus; no telemetry |
| `zero2-cam3-displayhat` | Pi Zero 2 W | Pimoroni Display HAT Mini plus A/B/X/Y buttons | Picamera2, 2048×1536 still | PiSugar 2 telemetry when its manager is installed |

All three profiles reserve BCM GPIO 20 (physical pin 38) for the shutter. Connect the button to ground (for example physical pin 39); the software enables the internal pull-up. The SPI and Zero profiles also use GPIO21 (physical pin 40) for a shutdown button held for 1.5 seconds. The enclosed DSI build uses GPIO21 exclusively for amplifier DIN, so its profile omits the shutdown-button input. See the audio setup below before enabling I²S.

## Prepare Raspberry Pi OS

Use **Raspberry Pi OS Lite (Legacy, 64-bit)** based on Debian Bookworm, with SSH and Wi-Fi configured in Raspberry Pi Imager. The DSI installer adds the minimal X server and Chromium packages, so the full desktop image is not required. Before installing:

1. Connect the CSI camera with the Pi powered off.
2. For the SPI profile, seat the MPI3501 directly on the GPIO header. For DSI, connect the Waveshare screen to the Pi 3B+ display connector with power disconnected and the contacts oriented for both sockets.
3. Check the camera ribbon orientation at both ends before applying power.
4. Connect the shutter to GPIO20. On the SPI/Zero profiles, an optional shutdown button uses GPIO21; on the enclosed DSI build, GPIO21 belongs to the amp. The MPI3501 uses GPIO17, 24, and 25 in addition to the SPI pins.

## One-command installation

Pi 3B+ with the new Waveshare DSI display (preferred):

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile pi3bplus-imx415-dsi43 --claim YOUR-SETUP-CODE
```

Pi 3B+ with the current SPI display:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile pi3bplus-imx415-tft35
```

Pi Zero 2 W:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile zero2-cam3-displayhat
```

The installer can exchange a 30-minute setup code from `/admin` for an individual device credential. Without `--claim`, it asks for the legacy plaintext token through `/dev/tty`. It creates a locked-down `musecam` system user, installs the selected display and IMX415 configuration, installs the Python package, verifies the API, and enables `musecam.service`. The DSI profile also installs and enables `musecam-kiosk.service` and `musecam-control.service` for local Wi-Fi and software updates. It reboots automatically when a hardware overlay changes. Rerunning performs a fast-forward update and preserves the secret; add `--reconfigure --claim CODE` to replace an existing credential.

The DSI installer follows Waveshare's current 800×480 setup: it enables full KMS and uses the dedicated Waveshare panel overlay when the OS provides it, otherwise the compatible 7-inch DSI overlay. The display is driven at its native refresh rate rather than copying frames over SPI.

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
# DSI profile only
journalctl -u musecam-kiosk -f
sudo systemctl restart musecam
sudo nano /etc/musecam/device.env
```

The application automatically prefers `/dev/fb1` when HDMI owns `/dev/fb0`, then falls back to `/dev/fb0` when the MPI3501 is the only screen. Override this by adding `MUSECAM_FRAMEBUFFER` to `/etc/musecam/device.env` only when diagnostics show an unusual framebuffer assignment. Touch orientation can be corrected in the selected TOML profile with `touch_swap_xy`, `touch_invert_x`, and `touch_invert_y`.

The SPI Pi 3 profile captures at 15 FPS and renders the newest frame at 6 FPS. Its framebuffer writes only changed scanlines and requests a conservative 20 MHz SPI clock. The DSI profile captures a 15 FPS preview and supplies up to 10 FPS local MJPEG to the 800×480 Chromium UI. Above 75°C, preview delivery slows to at most 5 FPS until the Pi cools to 68°C; still-photo resolution is unchanged. The display itself refreshes at native DSI speed.

## DSI touchscreen controls (0.3)

The viewfinder fills the 800×480 screen. Press the physical GPIO20 shutter to take a photo; there is no on-screen shutter. Choose a style from the scrollable translucent rail on the right, or hide it for an unobstructed view. The two top-right icons open the local gallery and settings. Keyboard testing supports arrows to change style, Space/Enter to capture, and Escape to return to the camera.

Captures return to the viewfinder as soon as the original is saved. A single background worker processes the queue while you continue shooting. A quiet chirp accompanies processing; a tappable notice opens a completed or failed photo. Network interruptions retain the original and retry with the same capture ID and increasing delays. Newly captured photos take priority over repeated network retries. The queue survives restarts and pauses new captures at 30 pending photos or less than 150 MB free.

**Your roll** contains every local original and imagined result, with filters for ready, waiting, and failed photos. Hold a result to compare its original; release to return. **Restyle** submits a copy of the original with the chosen style and adds a separate gallery entry. **Retry** creates a new attempt for a failed generation, retaining the failed entry for reference. Photos in this DSI gallery are not automatically pruned. **Share** publishes a completed result to the public roll only when explicitly tapped.

**Settings** includes:

- Sounds: persistent master volume, mute, optional quiet processing chirps, and previews of the shutter click, processing, success, and failure cues. The default is a conservative 35%; zero silences every cue. Original synthesized sounds require no downloaded audio assets.
- Wi-Fi: nearby networks, saved-network reconnection, hidden SSID entry, and a touchscreen password keyboard. A failed join removes its new profile and attempts to restore the previous connection. WPA personal and open networks are supported; enterprise certificates and captive-portal login are not configured here. Use a suitable office guest network or hotspot, or provision an enterprise profile separately.
- Storage: free/used space and photo counts. Originals and every treatment remain on the camera.
- Device: hostname, addresses, installed commit, battery capability, and update controls. PiSugar S Plus does not expose a percentage; the interface reports that limitation.

Updates fetch `origin/main` and accept only clean, fast-forward releases with prebuilt UI assets. Pending processing/sharing blocks installation. The update worker installs the Python package and control service, verifies the camera starts, and restores the previous commit/package if startup fails. Photos, sound settings, Wi-Fi profiles, and device credentials live outside the release checkout and are preserved. Keep power connected during an update. Local source edits block the release updater rather than being discarded.

This repository is private. The assembled camera uses a dedicated read-only GitHub deploy key under `/root/.ssh/musecam-update`, pinned GitHub host keys, and an SSH origin URL. The private key never leaves the camera. Other cameras need their own read-only repository access before update checks can fetch releases; do not copy an account-wide GitHub token onto a camera.

The browser and camera API bind only to loopback. Mutating API requests require a local Host, matching Origin when supplied, and `X-MuseCam-Request: 1`. A root-owned helper exposes only fixed Wi-Fi/status/update operations on a Unix socket accessible to the `musecam` group. Wi-Fi passwords travel over that socket and NetworkManager D-Bus, never command arguments or application logs. The helper must be running for these settings to work:

```bash
systemctl status musecam-control
journalctl -u musecam-control -f
```

## Native SPI / Display HAT controls

| Action | Touch | Keyboard/simulator | Display HAT Mini | External button |
| --- | --- | --- | --- | --- |
| Previous preset | `PREV` | Left / A | A | — |
| Capture | `SNAP` or preview | Space / Enter | X | GPIO20 |
| Next preset | `NEXT` | Right / D | B | — |
| Share result | `SHARE` | S | Y | — |
| Safe shutdown | — | P | — | Hold GPIO21 for 1.5 seconds |

The native runtime retains its existing synchronous interface and latest-100 finished-photo retention. The enclosed DSI prototype has no separate GPIO shutdown button; GPIO21 belongs exclusively to the amp DIN wire.

## Desktop simulator

The simulator exercises the same UI and state machine without Raspberry Pi modules:

```bash
python3 -m venv .venv
.venv/bin/pip install -e './device[sim,test]'
MUSECAM_DATA_DIR=./data .venv/bin/musecam run --simulate --offline
```

To exercise the 800×480 browser UI instead:

```bash
pnpm --dir device-ui build
MUSECAM_DATA_DIR=./data .venv/bin/musecam serve \
  --profile pi3bplus-imx415-dsi43 --simulate --offline --port 8080
```

Open `http://127.0.0.1:8080`. Arrow keys change presets, Space/Enter captures, and Escape returns to the live view. Gallery, restyling, sound controls, Wi-Fi keyboard, and update checks can be explored without hardware. Simulated results are local test images; sounds play only on the physical camera.

Keyboard controls are shown in the table above. Remove `--offline` and pass `--config /path/to/device.env` to exercise the deployed API with the simulated camera.

## Amplifier and speaker bring-up

The enclosed prototype's I²S amp and speaker passed an initial test on 2026-09-07:
two 48 kHz stereo test tones at 2.5% digital amplitude played as the `musecam` user,
and Danny confirmed clean sound. The module works with the `max98357a,no-sdmode`
overlay; its exact chip and speaker rating remain to be recorded. Application
sound cues are now implemented in `device/src/musecam/audio.py` and controlled from Settings → Sounds. After a reboot, the amp was detected,
playback as `musecam` succeeded again, both camera services were active, and GPIO20
remained configured as the shutter input.

The application keeps one 48 kHz stereo PCM stream open and sends digital silence
between cues, including while muted. Opening and closing the I²S device for each
sound caused loud pops on the assembled camera; the amp's
[setup guide](https://learn.adafruit.com/adafruit-max98357-i2s-class-d-mono-amp/raspberry-pi-usage)
also recommends continuous silence to prevent start/stop popping. Cues and volume
changes have short fades. A separate audio process keeps camera initialization
and capture work from starving the playback buffer. If the stream fails, sounds
remain disabled until an application restart, rather than repeatedly reopening
the device. Settings shows
the audio error. A service restart or power cycle still interrupts the stream.

The standard amp signals use GPIO18 for BCLK (physical pin 12), GPIO19 for LRCLK
(pin 35), and GPIO21 for DIN (pin 40). See the
[Adafruit wiring guide](https://learn.adafruit.com/adafruit-max98357-i2s-class-d-mono-amp/raspberry-pi-wiring).
GPIO21 is connected only to amp DIN on this unit. The DSI profile omits
`power_gpio`, so the camera does not claim the audio-data pin as a button input.
Do not connect a shutdown button there. The default Pi 3 I²S pin group also claims
GPIO20 (audio input), even though the amp only needs output. The supplied
[`musecam-i2s-output.dts`](../device/overlays/musecam-i2s-output.dts) overlay selects
only GPIO18, 19, and 21, preserving the shutter on GPIO20. This setup targets the
Pi 3 DSI build; the SPI and Zero profiles have not been adapted for it.

To reproduce the audio setup on a Pi 3 DSI build with this wiring and the updated
profile, install the tools and compile the pin overlay:

```bash
sudo apt-get install -y alsa-utils device-tree-compiler
sudo dtc -@ -I dts -O dtb \
  -o /boot/firmware/overlays/musecam-i2s-output.dtbo \
  /opt/muse-cam/device/overlays/musecam-i2s-output.dts
sudo usermod -aG audio musecam
```

Back up `/boot/firmware/config.txt`, comment out `dtparam=audio=on`, and add these
lines in the `[all]` section, in this order, then reboot:

```ini
dtoverlay=musecam-i2s-output
dtoverlay=max98357a,no-sdmode
```

`no-sdmode` matches the five-wire module, which has no separate SD_MODE control
wire. See the [amp setup guide](https://learn.adafruit.com/adafruit-max98357-i2s-class-d-mono-amp/raspberry-pi-usage).
Use `aplay -l` to confirm `MAX98357A` appears. `pinctrl get 18-21` should show
PCM_CLK, PCM_FS, input, and PCM_DOUT respectively while Muse Cam is running.
Play a deliberately quiet WAV through the named card, avoiding numeric card
indices that can change between boots. Stop Muse Cam first: its continuous stream
owns the playback device. Standalone playback can itself pop when its stream
starts or stops, so use Settings → Sounds for routine cue checks.

```bash
sudo systemctl stop musecam
sudo -u musecam aplay -D plughw:CARD=MAX98357A,DEV=0 /path/to/quiet-test.wav
sudo systemctl start musecam
```

The general device installer grants audio-group access, but these optional audio
overlay steps remain manual. Successful playback commands still require a
listener to confirm that the physical speaker produced clean audio.

## Finding the assembled camera

The current unit advertises `muse-cam-1.local`. Danny reserved `192.168.68.104`
for it on the router; its Wi-Fi MAC is `b8:27:eb:85:9c:47`. The Pi received that
address after reboot on 2026-09-07. Direct IPv4 connections from the Mac initially
timed out while local IPv6 SSH worked. After the Pi pinged the Mac and refreshed
neighbor discovery, IPv4 SSH to the reserved address succeeded. The reservation
depends on that router's setup; no router change was needed during this session.
On macOS, `dns-sd -B _workstation._tcp local.` can find its advertised hostname,
and `dns-sd -G v4v6 muse-cam-1.local` shows its current addresses. Stop either
lookup with Ctrl+C. Use `ssh -6` with the hostname or its current link-local IPv6
address and the Mac interface suffix (for example `%en0`) when IPv4 is unavailable.

The camera UI listens only on `127.0.0.1:8080` on the Pi. Access from a workstation
requires an SSH tunnel; discovering its LAN address does not expose the UI there.

## PiSugar 2 telemetry

The Zero profile reads `get battery` from `/tmp/pisugar-server.sock`. Install PiSugar Power Manager using PiSugar's official instructions if an on-screen percentage is desired. The camera works without it. PiSugar S Plus does not provide equivalent telemetry, so the Pi 3 profile deliberately omits the percentage.

# Camera Module 3

The enclosure is built for the Raspberry Pi Camera Module 3, installed with the
`pi3bplus-cam3-dsi43` profile. Capture uses Picamera2 with continuous autofocus:
1920×1280 stills from a 15 FPS camera stream, with up to 10 FPS preview delivery.
The sensor is not captured at its maximum advertised resolution; this preserves
the Pi 3's established memory budget and upload sizes.

The build uses the Standard module. The same profile also recognizes the Wide and
NoIR variants, but only the Standard has been fitted in the enclosure, and the
ordinary IR-filtered versions are the intended choice for normal color
photography. The official module offers 75° diagonal coverage for Standard and
120° for Wide; these are lens specifications, not a promise about the
application's cropped preview. See Raspberry Pi's
[Camera Module 3 specifications and drawings](https://www.raspberrypi.com/products/camera-module-3/).

Other cameras were tested with the software during development but do not fit
the enclosure; see [other tested hardware](DEVICE.md#other-tested-hardware).

## Tap to focus

Autofocus runs continuously by default. Tap a subject in the live preview to
select that area. The brackets are amber while focusing, green when frame
metadata reports focus achieved, and coral if the scan fails. Gray means focus
could not be confirmed; try another area. The selected area continues to
autofocus after captures and gallery visits. Tap **Auto area** to return to the
camera's default metering, or restart the camera. This selects an area in the
frame; it does not track a moving person.

The browser converts taps through the live image's centered `object-fit: cover`
crop. Python maps those normalized coordinates into the latest `ScalerCrop`
sensor rectangle and meters a 15% window around the point, clamped at its edges.
`AfMetering=Windows` and `AfWindows` select the area. Continuous AF is briefly
paused and resumed to start a fresh scan, acknowledging `AfPauseState` and
draining the three configured frame buffers after each control change. No
sensor reconfiguration or extra camera instance is involved. If acknowledgement
does not arrive within five seconds, AF is resumed and the target remains
unconfirmed until another tap or **Auto area**.

The local API accepts `POST /api/actions/focus` with normalized `{"x": 0.5,
"y": 0.5}`, or `POST /api/actions/focus_auto` with `{}`, using the same local
request protections as other actions. `/api/state` and SSE expose `focus`
(`supported`, `mode`, `point`, `status`) and `previewSize`. Commands are queued
onto the camera thread; focus state changes are published without streaming
every lens adjustment to the UI.

See the bring-up results below before treating Camera Module 3 autofocus as
physically verified.

## First installation

Use the Bookworm-based Raspberry Pi OS setup and installer command in
[DEVICE.md](DEVICE.md). Connect the camera with all power disconnected. Camera
Module 3 uses the Raspberry Pi OS Picamera2/rpicam packages installed by Muse
Cam, so no vendor camera packages are needed.

The installer backs up the boot configuration to
`config.txt.musecam-<timestamp>.bak`, then writes the camera overlay in an
`[all]` block with automatic camera detection disabled. It may reboot to activate
boot settings. Reinstalls preserve existing camera overlay parameters, including
rotation, as well as KMS memory parameters and amplifier overlays.

## Validate the camera

With the camera installed and the Pi rebooted:

```bash
sudo systemctl stop musecam
sudo -u musecam /opt/muse-cam/.venv/bin/musecam \
  --config /etc/musecam/device.env doctor
sudo systemctl start musecam musecam-kiosk
journalctl -u musecam -b -n 80 --no-pager
```

Doctor checks the detected sensor against the profile and flags conflicting
camera overlays. Camera Module 3's `imx708`, `imx708_wide`, `imx708_noir`, and
`imx708_wide_noir` names are accepted by the same profile; these variants are
registered separately in Raspberry Pi's
[libcamera implementation](https://github.com/raspberrypi/libcamera/blob/main/src/ipa/rpi/cam_helper/cam_helper_imx708.cpp).
Application startup verifies that autofocus controls exist and logs the sensor,
capture size, and requested `autofocus=continuous`. Also check for driver
warnings: `Could not set AF_MODE - no AF algorithm` means that preview can work
while autofocus does not.

### Camera Module 3 initial hardware results — 2026-09-12

The Standard module reports `imx708`, a 4608×2592 pixel array, and the expected
180° sensor mounting rotation. Selecting `dtoverlay=imx708` and
`pi3bplus-cam3-dsi43`, then rebooting, restored preview and capture. The chosen
sensor mode is 2304×1296, with a `(360, 0, 3888, 2592)` scaler crop. Ten successive
1920×1280 JPEG captures returned to 800×480 preview without capture errors.

Autofocus is **not yet verified on this physical unit**. It reports `Failed`
and produces a blurred image. Switching the camera libraries to Raspberry Pi's
matching Bookworm packages (`0.5.2+rpt20250903-1~bpo12+1`, runtime
`v0.5.2+99-bfd68f78`) did not resolve it. The sensor and `dw9817-vcm` lens
controller are both bound to kernel drivers. Six further captures at manually
commanded 0, 1, 2, 4, 8, and 12 dioptres all showed essentially unchanged
sharpness despite changing reported lens positions. This suggests a blocked or
non-moving lens mechanism, but does not establish the physical cause. Check
lens/enclosure clearance and any protective cover before assuming a software
autofocus problem or defective module.

The device uses the Raspberry Pi camera libraries; the previous libraries and
configuration are saved under
`/var/backups/musecam-cam3-swap-20260912T082403Z/`. Diagnostic photos are separate
from the gallery in `/var/lib/musecam/diagnostics/cam3-20260912/`. The 69 gallery
entries, selected style, volume, device credential, and display/audio setup
were preserved. Camera, kiosk, and control services remain running.

Before closing the enclosure, check:

- Live preview and saved originals have the intended orientation and framing.
- A nearby textured object and a distant scene both settle into focus; inspect
  the original using gallery zoom, not only the generated treatment.
- At least ten captures, including several close together and while previous
  photos process, return to live view without allocation errors or a freeze.
- Gallery originals/results, physical shutter, speaker cues, and a power cycle
  continue working. Record the module, OS, camera package versions, and lens variant.

## Focusing and failure behavior

The profile requests Picamera2's continuous autofocus mode. At capture time, Muse
Cam releases frames while the driver reports scanning, allowing up to 1.2 seconds
for settling with a healthy frame stream. If scanning continues, it saves the
latest frame. A failed or unavailable focus-state report also allows capture;
focus lock is not guaranteed. Individual frame requests retain the existing
three-second device timeout and camera recovery behavior. Still and preview
streams stay allocated throughout; capture does not switch sensor modes.
These controls and metadata are described in the
[Picamera2 manual](https://datasheets.raspberrypi.com/camera/picamera2-manual.pdf).

If startup reports the wrong sensor, check the camera ribbon and the camera
overlay in `config.txt`, then reboot. If it reports missing autofocus controls,
check the camera packages and that the module is a Camera Module 3. Do not work
around the error by silently disabling autofocus. Standalone
`rpicam-hello`/Picamera2 tests must run with Muse Cam stopped.

## Profile and printable parts

Profile TOML files live in `device/profiles/`. `camera_model` guards against a
wrong sensor; `camera_autofocus` requests continuous focus.

The six enclosure STLs are in
[`hardware/stl/`](../hardware/stl/README.md), with a [parts list](../hardware/BOM.md),
[build guide](../hardware/BUILD.md), and [wiring reference](../hardware/WIRING.md)
for Camera Module 3 / Pi 3B+ / DSI / PiSugar 3 Plus. The guide includes ten
[assembly photos](../hardware/photos/README.md), including camera placement and
the lens mount. Print settings are pending; the photos do not resolve the
autofocus issue recorded above. Check the lens actuator clearance in `lens_back`/`lens_front`
and near/far focus before closing the housing.

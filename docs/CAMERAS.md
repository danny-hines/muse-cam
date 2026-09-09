# Camera options and swaps

Muse Cam uses one Picamera2 capture backend with explicit hardware profiles.
Camera choice changes sensor setup and focusing; the gallery, styles, physical
shutter, sounds, and photo queue use the same application code.

## Pi 3B+ / Waveshare 4.3-inch DSI builds

| Camera | Installer profile | Focus | Validation status |
| --- | --- | --- | --- |
| Arducam IMX415, B0569 | `pi3bplus-imx415-dsi43` | Fixed lens | Existing enclosed build; autofocus is not requested |
| Arducam 16 MP IMX519 autofocus, B0371 | `pi3bplus-imx519-dsi43` | Continuous AF through Arducam's libcamera stack | Initial physical focus/preview/capture checks passed; see results below |
| Raspberry Pi Camera Module 3, IMX708 | `pi3bplus-cam3-dsi43` | Continuous AF through Raspberry Pi's camera stack | Software prepared; physical bring-up pending |

All three DSI profiles use 1920×1280 stills, a 15 FPS camera stream, up to 10 FPS
preview delivery, and the same GPIO20 shutter / GPIO21 amplifier wiring. The
larger sensors are not captured at their maximum advertised resolution: the
initial configuration preserves the Pi 3's established memory budget and upload
sizes. Sensor mode, framing, focus quality, and repeated capture stability still
need to be checked on each new physical module.

Camera Module 3 Standard and Wide share the `cam3` profile. NoIR variants are also
recognized, but the ordinary IR-filtered versions are the intended choice for
normal color photography. The official module offers 75° diagonal coverage for
Standard and 120° for Wide; these are lens specifications, not a promise about
the application's cropped preview. See Raspberry Pi's
[Camera Module 3 specifications and drawings](https://www.raspberrypi.com/products/camera-module-3/).

The IMX519 profile targets the autofocus B0371, not a manual-focus IMX519 board.
Arducam documents Pi 3B+ support and requires its libcamera packages for
autofocus. Follow its OS-specific
[IMX519 installation guide](https://docs.arducam.com/Raspberry-Pi-Camera/Native-camera/16MP-IMX519/)
before enabling this profile. Muse Cam does not download or execute the vendor's
installer automatically. Having an `imx519.dtbo` file alone does not prove that
autofocus is working. Even advertised `AfMode` controls are insufficient: the
sensor tuning file must load the focus algorithm, and frame metadata should show
the lens scanning and reaching focus.

## Tap to focus on the DSI touchscreen

Autofocus runs continuously by default. With an IMX519 or Camera Module 3,
tap a subject in the live preview to select that area. The brackets are amber
while focusing, green when frame metadata reports focus achieved, and coral
if the scan fails. Gray means focus could not be confirmed; try another area.
The selected area continues to autofocus after captures and gallery visits.
Tap **Auto area** to return to the camera's default metering, or restart the
camera. This selects an area in the frame; it does not track a moving person.
Fixed-focus modules do not show these controls.

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

Physical IMX519 validation on September 9, 2026 confirmed pause/resume
acknowledgement, lens movement, and reported focus at three different target
areas followed by automatic-area reset. The sensor crop was
`(708, 674, 3240, 2160)`. Camera Module 3 uses the same tested control path;
physical testing of that module is still pending.

## First installation

Use the Bookworm-based Raspberry Pi OS setup described in [DEVICE.md](DEVICE.md).
Connect the selected module with all power disconnected, install any required
vendor camera packages, and run the Muse Cam installer with the matching profile:

```bash
# IMX519 autofocus (after the Arducam driver setup):
sudo bash install-device.sh --profile pi3bplus-imx519-dsi43 --claim YOUR-SETUP-CODE

# Or official Camera Module 3, Standard or Wide:
sudo bash install-device.sh --profile pi3bplus-cam3-dsi43 --claim YOUR-SETUP-CODE
```

Obtain `scripts/install-device.sh` from this repository as described in
[DEVICE.md](DEVICE.md). Private deployments require their own repository access.
Camera Module 3 uses the Raspberry Pi OS Picamera2/rpicam packages installed by
Muse Cam. The installer may reboot to activate boot settings.

## Swap an existing camera

1. Let pending processing and sharing finish. Use **Settings → Device → Update**
   to install the release containing the new profiles and installer. A normal
   application update preserves the selected camera and does not edit boot settings.
2. For IMX519, follow the linked Arducam driver instructions for your OS. Stop
   Muse Cam while testing vendor camera commands; only one process may own the
   camera. Follow any vendor reboot requirements before continuing.
3. Run **one** of these on the Pi, choosing the module being fitted:

   ```bash
   sudo bash /opt/muse-cam/scripts/install-device.sh \
     --profile pi3bplus-imx519-dsi43 --no-start

   # Or:
   sudo bash /opt/muse-cam/scripts/install-device.sh \
     --profile pi3bplus-cam3-dsi43 --no-start
   ```

   The installer keeps the existing device credential and photo data, selects
   the profile, and stops the camera service. `--no-start` prevents camera
   startup and automatic reboot while the old module is still attached. Existing
   service enablement is retained. Custom extra settings in `device.env` should
   be saved separately before rerunning the installer, which rewrites that file.
4. Run `sudo systemctl poweroff`, wait for shutdown, and disconnect **all** power,
   including the PiSugar battery supply. Fit the module, its correct ribbon, and
   matching enclosure bracket. The Pi 3 camera connector takes a 15-pin ribbon;
   check the camera-end connector and contact orientation rather than assuming
   the IMX415 cable can be reused. See Raspberry Pi's
   [camera connection instructions](https://www.raspberrypi.com/documentation/accessories/camera.html).
5. Restore power. The previously enabled services should start. If this was a
   fresh installation using `--no-start`, enable them after boot:

   ```bash
   sudo systemctl enable --now musecam musecam-kiosk
   ```

The installer backs up the boot configuration before changing camera selection
to `config.txt.musecam-<timestamp>.bak`. It disables previous IMX415/IMX519/IMX708
directives and writes one selected camera in an `[all]` block, with automatic
detection disabled for the Pi 3 profiles. The Zero 2 profile uses automatic
detection. Same-camera reinstalls preserve existing camera overlay parameters,
including rotation; a different module begins with its own default orientation.
Existing KMS memory parameters and amplifier overlays are retained. Custom camera
directives in included boot files or overlays outside these three sensor families
need separate review.

To return to the IMX415, repeat the swap steps with
`--profile pi3bplus-imx415-dsi43`. A vendor camera-stack installation is separate
from Muse Cam's profile selection; changing the profile does not uninstall it.

## Validate each physical module

With the selected camera installed and the Pi rebooted:

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
capture size, and requested `autofocus=continuous` (or `off` for IMX415). Also check
for driver warnings: `Could not set AF_MODE - no AF algorithm` means that preview
can work while autofocus does not. Install the matching Arducam camera libraries
and verify focus metadata before declaring autofocus operational.

### IMX519 initial hardware results — 2026-09-09

The enclosed Pi 3B+ detected the replacement after changing both the boot overlay
and Muse Cam profile from IMX415 to IMX519 and rebooting. The original Raspberry Pi
camera libraries produced live video but lacked `rpi.af` in the IMX519 tuning file.
Installing Arducam's `libcamera0.5` and `libcamera-ipa`, both version
`0.5.2+rpt20250909-1` for arm64, enabled autofocus. The existing
`python3-libcamera` (`0.5.2+rpt20250903-1~bpo12+1`) and Picamera2 (`0.3.31-1`)
worked with those runtime libraries; no application or kernel replacement was
needed. This was Bookworm 64-bit with kernel `6.12.93+rpt-rpi-v8`.

Frame metadata reported scanning followed by focus lock (`AfState` 1 → 2), with
changing lens positions. Ten consecutive 1920×1280 JPEG captures each returned
an 800×480 preview without allocation errors. The app then served changing live
frames with the gallery, style selection, and volume preserved; audio remained
available. The test originals were kept in a separate local diagnostics folder,
without submitting generation requests or adding gallery entries. Near/far
handheld use and the complete enclosure fit still need user testing.

Before marking a module physically validated, check:

- Live preview and saved originals have the intended orientation and framing.
- A nearby textured object and a distant scene both settle into focus; inspect
  the original using gallery zoom, not only the generated treatment.
- At least ten captures, including several close together and while previous
  photos process, return to live view without allocation errors or a freeze.
- Gallery originals/results, physical shutter, speaker cues, and a power cycle
  continue working. Record the module, OS, camera package versions, and lens variant.

## Focusing and failure behavior

Autofocus profiles request Picamera2's continuous mode. At capture time, Muse Cam
releases frames while the driver reports scanning, allowing up to 1.2 seconds
for settling with a healthy frame stream. If scanning continues, it saves the
latest frame. A failed or unavailable focus-state report also allows capture;
focus lock is not guaranteed. Individual frame requests retain the existing
three-second device timeout and camera recovery behavior. Still and preview
streams stay allocated throughout; capture does not switch sensor modes.
These controls and metadata are described in the
[Picamera2 manual](https://datasheets.raspberrypi.com/camera/picamera2-manual.pdf).

If startup reports the wrong sensor, select the matching profile and reboot.
If it reports missing autofocus controls on IMX519, verify Arducam's libcamera
installation and that the board is the autofocus model. Do not work around the
error by silently disabling autofocus on a build advertised as autofocus-capable.
Standalone `rpicam-hello`/Picamera2 tests must run with Muse Cam stopped.

## Profiles and printable parts

Profile TOML files live in `device/profiles/`. `camera_model` guards against a
wrong sensor; `camera_autofocus` requests continuous focus. Omitting both keeps
the earlier fixed-focus backend behavior for custom profiles. The installer
accepts the five profiles listed in [DEVICE.md](DEVICE.md); new board/display
combinations need their own profile, installer handling, and hardware validation.

The IMX519 enclosure STL revision has been reported complete by the builder but
has not yet been supplied to this checkout. A Camera Module 3 enclosure revision
is planned. Neither is included as a validated print in this release. Keep
camera-specific front mounts separately labeled, with the board/lens variant and
revision recorded; use the manufacturer's dimensional drawings and the physical
module to confirm lens clearance and ribbon routing before publishing prints.

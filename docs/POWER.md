# Battery reporting

MuseCam reads battery percentage from PiSugar Power Manager's local Unix socket
at `/tmp/pisugar-server.sock`. PiSugar 2 and PiSugar 3 (including their Plus
models) support this. PiSugar S / S Plus cannot report battery data.

## PiSugar 3 Plus setup

1. With both boards powered off, mount the PiSugar beneath the Raspberry Pi so
   its spring contacts seat against the underside of the GPIO header. The normal
   mounting connection carries both power and I²C; no separate telemetry cable
   is needed.
2. Enable I²C using `sudo raspi-config nonint do_i2c 0`. Verify the board responds
   on bus 1 at its default addresses `0x57` and `0x68`. Poor spring contact can
   prevent communication even when the Pi receives power.
3. Follow [PiSugar's official software instructions](https://docs.pisugar.com/docs/product-wiki/battery/pisugar-power-manager).
   Select **PiSugar 3** for both the server and poweroff package, including when
   installing a PiSugar **3 Plus**. Enable the Unix socket. MuseCam does not need
   the separate PiSugar HTTP, WebSocket, or TCP listeners.
4. Add this setting to `/etc/musecam/device.env`:

   ```dotenv
   MUSECAM_POWER_BACKEND=pisugar3
   ```

5. Restart both camera services:

   ```sh
   sudo systemctl restart musecam.service musecam-kiosk.service
   ```

The percentage appears in the camera header and Settings and refreshes every
five seconds. If the sensor or manager is unavailable, MuseCam shows no
percentage rather than a fabricated reading. Battery percentage is an estimate,
not a precise remaining-runtime measurement.

The power selection is independent of `MUSECAM_PROFILE`, so changing between
IMX415, IMX519, and Camera Module 3 profiles preserves battery support. The device
installer also preserves this setting. Other accepted values are `pisugar2`,
`pisugar-s-plus`, and `none`; the last two disable telemetry. Omitting the setting
uses the camera profile's original power defaults.

Low-battery automatic shutdown and hardware button behavior are separate PiSugar
Power Manager settings. Enabling MuseCam's percentage display does not configure
those policies.

## Verified build

On 2026-09-13, Danny's Pi 3B+ / Camera Module 3 / DSI 4.3-inch build detected a
PiSugar 3 Plus at both default I²C addresses. PiSugar Power Manager 2.3.4-1 was
installed with the PiSugar 3 model and only its Unix socket enabled. MuseCam's
unprivileged service account successfully read a battery level of approximately
61%. The previous boot and device configuration are backed up on the Pi in
`/var/backups/musecam-pisugar3-20260913/`.

Hardware reference: [PiSugar 3 mounting and specifications](https://docs.pisugar.com/docs/product-wiki/battery/pisugar3/pisugar-3-series).

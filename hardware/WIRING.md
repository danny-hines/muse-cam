# Muse Cam wiring

For Raspberry Pi 3B+, Camera Module 3, Waveshare 4.3-inch DSI, PiSugar 3 Plus,
and a MAX98357A amplifier. Connect everything with external power removed and
PiSugar output off. Unplugging USB alone does not remove battery power.

## GPIO connections

**Physical pin numbers** identify positions on the Pi's 40-pin header.
**BCM GPIO numbers** are the signal names used by software. For example, GPIO20
is physical pin 38. Identify pin 1 using the Pi's marking/square pad and the
[Raspberry Pi header reference](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#gpio).
Numbering stays the same when the Pi is installed upside down; an underside view
is mirrored. Attach and label the leads before installing the Pi.

| Component terminal | Pi physical pin | Pi signal | Purpose |
| --- | ---: | --- | --- |
| Amplifier VIN / VCC | **4** | 5 V | Amplifier power |
| Amplifier GND | **6** | Ground | Common ground |
| Amplifier BCLK / BCK | **12** | BCM GPIO18 / PCM_CLK | I²S bit clock |
| Amplifier LRC / LRCLK / WS | **35** | BCM GPIO19 / PCM_FS | I²S left/right clock |
| Amplifier DIN | **40** | BCM GPIO21 / PCM_DOUT | Audio data from Pi to amplifier |
| Shutter lead 1 | **38** | BCM GPIO20 | Shutter input |
| Shutter lead 2 | **39** | Ground | Shutter return |

The amplifier signal mapping follows
[Adafruit's Raspberry Pi wiring guide](https://learn.adafruit.com/adafruit-max98357-i2s-class-d-mono-amp/raspberry-pi-wiring).
Pins 4 and 6 are the power/ground positions selected for this guide; wire by the
board's terminal labels, not an assumed color or connector order.
[Photo 5](photos/05-pi-ribbons-and-gpio.png) shows the connected Pi before it is
flipped into the housing, but some header pins are obscured. The amplifier
harness is visible in [photo 6](photos/06-pi-pisugar-stack.png); a readable
close-up of its terminal labels is still needed to document connector order.

Connect the speaker's leads to amplifier **SPK+ and SPK−** (or its supplied
speaker connector). Neither speaker terminal goes to Pi ground: the output is
bridged. Keep 5 V on VIN/VCC only, away from GPIO signal inputs. Additional SD/EN
or GAIN pins on a different breakout need that board's documentation; the
five-wire build uses no GPIO shutdown/enable lead.
[Amplifier pin reference](https://learn.adafruit.com/adafruit-max98357-i2s-class-d-mono-amp/pinouts).

## Shutter behavior

Use the normally-open switch contacts. The leads have no polarity. Pressing the
button connects **pin 38 to pin 39**; released, the contacts are open. Muse Cam
enables an internal pull-up and debounces the switch, so no external pull-up
resistor is needed. Do not add a connection to 5 V or 3.3 V.

**Do not connect the shutter between pins 39 and 40.** Pin 40 is amplifier DIN.
The DSI profile intentionally has no separate GPIO power button. See
[the Camera Module 3 profile](../device/profiles/pi3bplus-cam3-dsi43.toml).

## Camera, display, and battery

| Component | Pi connection | Assembly note |
| --- | --- | --- |
| Camera Module 3 | 15-pin **CAMERA / CSI** socket | Insert Pi end before mounting Pi; connect camera end while its latch is accessible, either before seating the module as in photo 7 or after joining the lens halves. |
| Waveshare display | 15-pin **DISPLAY / DSI** socket | Connect display end first, then Pi end before mounting Pi. |
| PiSugar 3 Plus | Spring contacts against **underside** of Pi GPIO solder pads | Supplies power and I²C through mounting interface; no separate telemetry leads. |

Open each ribbon latch gently, insert the cable squarely with exposed contacts
facing the socket contacts, and close both sides evenly. Confirm orientation at
each socket using the [camera instructions](https://www.raspberrypi.com/documentation/accessories/camera.html)
and [display instructions](https://www.waveshare.com/wiki/4.3inch_DSI_LCD).
The cable's blue stiffener is not a universal orientation rule. See
[photo 4](photos/04-display-mounted.png) for the display's right-edge DSI socket,
[photo 5](photos/05-pi-ribbons-and-gpio.png) for Pi cable routing, and
[photo 8](photos/08-lens-assembly-screws.png) for camera connector access through
`lens_back`. The display's central factory panel ribbon stays connected.
Contact faces are not visible at every connector; verify each against its socket.

PiSugar mounts on the Pi's underside even though the Pi's component side faces
the display inside this enclosure. Keep its contact area unobstructed. Its I²C
uses BCM GPIO2/3 (physical pins 3/5), separate from amplifier I²S signals.
See [PiSugar mounting instructions](https://docs.pisugar.com/docs/product-wiki/battery/pisugar3/pisugar-3-series)
and [Muse Cam battery setup](../docs/POWER.md).

## Required software selections

1. Install with **`pi3bplus-cam3-dsi43`**; see [the build guide](BUILD.md#6-install-the-software-and-test-before-closing).
2. Configure PiSugar Power Manager and set **`MUSECAM_POWER_BACKEND=pisugar3`**
   in `/etc/musecam/device.env` following [POWER.md](../docs/POWER.md). The
   camera profile still defaults to PiSugar S Plus; the override enables
   PiSugar 3 battery reporting.
3. Complete the manual [amplifier setup](../docs/DEVICE.md#amplifier-and-speaker-bring-up).
   Compile the supplied overlay before adding these boot configuration lines
   in this order, and reboot:

   ```ini
   dtoverlay=musecam-i2s-output
   dtoverlay=max98357a,no-sdmode
   ```

The ordinary Pi 3 I²S pin group also claims GPIO20 as audio input. Muse Cam's
[output-only overlay](../device/overlays/musecam-i2s-output.dts) preserves the
shutter on GPIO20. Audio setup is **not automatic** in the general installer;
follow the linked instructions in full, including compilation and disabling
onboard analog audio.

After reboot, `aplay -l` should list `MAX98357A`. While Muse Cam runs,
`pinctrl get 18-21` should show clock, frame-sync, shutter input, and audio output
respectively. Confirm one capture per shutter press and test the cues at low
volume in Settings → Sounds.

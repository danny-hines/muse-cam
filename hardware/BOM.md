# Muse Cam parts list

Quantities are for **one camera** using the six September 16, 2026 STL exports.
Purchased parts and fastener counts follow Danny's build notes and
[assembly photos](photos/README.md). Supplier links identify the selected items;
pack sizes may exceed the quantities needed.

## Electronics

| Qty | Part | Selected item / notes |
| ---: | --- | --- |
| 1 | Raspberry Pi 3 Model B+ | [Raspberry Pi product page](https://www.raspberrypi.com/products/raspberry-pi-3-model-b-plus/) |
| 1 | Raspberry Pi Camera Module 3 | Standard, ordinary color version used by the current prototype; [selected camera](https://www.amazon.com/dp/B0BRY6MVXL). Check the variant before substituting a Wide or NoIR module. |
| 1 | PiSugar 3 Plus with battery | [Selected power board](https://www.amazon.com/dp/B0H51CW3Q5). [Photo 6](photos/06-pi-pisugar-stack.png) shows a battery marked 5000 mAh / 3.7 V / 18.5 Wh. Manufacturer lists 5 V / 3 A maximum output for the Plus. [Specifications](https://docs.pisugar.com/docs/product-wiki/battery/pisugar3/pisugar-3-series). |
| 1 | Waveshare 4.3-inch DSI touchscreen | 800×480 IPS capacitive touch; [selected display](https://www.amazon.com/dp/B0972Z6VPN), [manufacturer's 4.3inch DSI LCD](https://www.waveshare.com/product/raspberry-pi/4.3inch-dsi-lcd.htm). [Photo 4](photos/04-display-mounted.png) shows PCB revision `2.2`. |
| 1 kit | MAX98357A I²S amplifier and 3 W speaker | [Selected kit](https://www.amazon.com/dp/B0FSZQRWSF); one amplifier and one speaker. Record actual speaker impedance and size from its label before buying a substitute. |
| 1 | 10 mm momentary switch | Normally-open, non-latching; [selected prewired switch](https://www.amazon.com/dp/B0FSZ32QMX). Retain its threaded mounting nut. |
| 1 | microSD card | For Raspberry Pi OS and the local photo gallery; prototype capacity not yet recorded. |
| 1 | USB charging supply and cable | Regulated 5 V supply, up to 3 A to match PiSugar input, with a compatible USB-C charging cable. [PiSugar input specifications](https://docs.pisugar.com/docs/product-wiki/battery/pisugar3/pisugar-3-series). |

## Printed parts

Print **one of each**, six parts total. See the [STL manifest](stl/README.md)
for dimensions and print preparation.

| Qty | File | Purpose |
| ---: | --- | --- |
| 1 | [body_main.stl](stl/body_main.stl) | Main housing; supports display, amplifier, shutter, and Pi/PiSugar stack |
| 1 | [body_front.stl](stl/body_front.stl) | Front cover; holds lens assembly and speaker |
| 1 | [door_side.stl](stl/door_side.stl) | Side access door |
| 1 | [door_top.stl](stl/door_top.stl) | Top access door |
| 1 | [lens_back.stl](stl/lens_back.stl) | Camera support and rear lens-mount flange |
| 1 | [lens_front.stl](stl/lens_front.stl) | Front half of camera sandwich |

## Fasteners and magnets

`M3×6` means an M3 thread with a nominal 6 mm screw length. Head style matters,
especially for the door stops: [photo 3](photos/03-door-magnets-and-stops.png)
shows round heads exposed on the inside of each door. Exact head dimensions,
thread form, and installed protrusion still need measurement. Tighten by hand
and check clearance before substituting screws.

| Qty | Part | Where it goes | Supplied with |
| ---: | --- | --- | --- |
| 4 | M3×4 screws | Two per door, acting as stops behind the front cover | Separate hardware |
| 9 | M3×6 screws | One amplifier mount + four lens assembly mounts + four front-cover screws | Separate hardware |
| 2 | M3×8 screws | Join `lens_back` and `lens_front` | Separate hardware |
| 4 | M2.5 display screws | Attach display to `body_main` | Display kit, per builder; exact length pending |
| 4 | M2.5 Pi/PiSugar screws | Through PiSugar and Pi mounting holes into `body_main` | PiSugar kit, per builder; exact length pending |
| 1 | Switch mounting nut | Secures shutter from inside housing | Switch |
| 4 | 8 mm diameter × 2 mm thick round magnets | Two in `body_main`, one in `door_side`, one in `door_top` | [Selected magnets](https://www.amazon.com/dp/B0CDH2HCV9) |

**Screw total: 23** — 15 M3 screws purchased separately, plus 8 supplied M2.5
screws. No heat-set inserts are specified in the supplied assembly notes.

The [body and door photos](BUILD.md#1-print-and-prepare-the-enclosure) show two
magnet pairs, **four magnets total**. Match each door magnet's polarity to its
body magnet before applying adhesive.

## Cables and assembly supplies

| Qty | Item | Notes |
| ---: | --- | --- |
| 1 | Camera ribbon | Camera Module 3 to Pi 3B+ CSI; use the camera's standard 15-pin cable. Final routed length pending. [Connection reference](https://www.raspberrypi.com/documentation/accessories/camera.html). |
| 1 | Display ribbon | Use the display's included FFC for the Pi 3B+ 15-pin DSI connector. Final routed length pending. [Connection reference](https://www.waveshare.com/wiki/4.3inch_DSI_LCD). |
| 5 conductors | Amplifier-to-Pi wiring | VIN, GND, BCLK, LRC/LRCLK, DIN; insulated female connections to Pi header. Match actual amplifier connector/pad labels. |
| 2 conductors | Shutter-to-Pi wiring | Extend/terminate supplied switch leads as needed, with insulated female connections to pins 38 and 39. |
| 1 pair | Speaker leads | Use the kit's speaker connection if supplied; connects only to amplifier speaker outputs. |
| As needed | Medium-viscosity CA glue | Medium cyanoacrylate glue is shown in photos 1–2. Use adhesive compatible with the printed plastic and plated magnets. |
| As needed | Double-sided mounting tape | Attaches speaker's flat back to inside of `body_front`, with cone facing the housing interior; see [photo 10](photos/10-speaker-mounted-to-front.png). Keep diaphragm clear. |
| As needed | Insulation and strain relief | Heat-shrink for splices, insulating tape, and small cable ties or suitable anchors as routing requires. |
| As needed | Printer filament | Material and quantity depend on confirmed slicer settings; see [print notes](stl/README.md). |
| 1, optional | Camera wrist strap with cord loop | Shown in [completed-camera photos](BUILD.md#completed-camera); exact strap and attachment hardware are not specified. |

Tools: 3D printer and slicer, drivers matching the screw heads, a small wrench
for the switch nut, flush cutters, a deburring tool or fine file, calipers, and a
multimeter for switch continuity. A soldering iron is needed only if the supplied
leads/connectors require soldered terminations.

## Other configurations

The repo also supports IMX415 and IMX519 DSI profiles, an IMX415/SPI display
profile, and a Pi Zero 2 W/Display HAT Mini profile. Their camera mounts, display
fit, power parts, and wiring may differ; see [supported profiles](../docs/DEVICE.md#supported-profiles)
and [camera options](../docs/CAMERAS.md). This shopping list and STL set describe
the Camera Module 3 / Pi 3B+ / DSI build only.

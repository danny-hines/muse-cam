# Printable Muse Cam enclosure

Six original binary STL exports supplied by Danny on **2026-09-16**. Print one
of each for the Camera Module 3 / Pi 3B+ / Waveshare DSI / PiSugar 3 Plus build.
The filenames and mesh bytes are unchanged from the supplied files. See the
[parts list](../BOM.md) and [assembly guide](../BUILD.md).

## Scale and dimensions

STL does not store units. **Millimetres are the intended working assumption**
for this enclosure; import at **100% scale** and check these measured bounding
boxes before slicing. Values are X × Y × Z in the original CAD axes, rounded
to three decimals. Rotating a part changes its displayed axis dimensions.
The files retain assembly coordinates and are not laid out on a print bed.

| File | Qty | X × Y × Z (mm, assumed units) | Triangles |
| --- | ---: | --- | ---: |
| [body_front.stl](body_front.stl) | 1 | 129.000 × 10.349 × 79.000 | 7,098 |
| [body_main.stl](body_main.stl) | 1 | 133.000 × 67.656 × 83.000 | 12,338 |
| [door_side.stl](door_side.stl) | 1 | 5.300 × 59.550 × 78.990 | 3,156 |
| [door_top.stl](door_top.stl) | 1 | 64.000 × 47.639 × 5.300 | 3,066 |
| [lens_back.stl](lens_back.stl) | 1 | 55.000 × 6.921 × 55.000 | 3,188 |
| [lens_front.stl](lens_front.stl) | 1 | 44.600 × 6.049 × 44.596 | 1,504 |

## Print preparation

1. Import each file separately or separate the imported objects in your slicer.
   Rotate and place each part on the bed; do not print the assembled arrangement.
2. Check size against the table. `body_main` spans approximately 133 × 67.656 ×
   83 mm in its original axes; a much larger or smaller import has a unit/scale issue.
3. Preview every layer around screw mounts, magnet recesses, and lens locating
   pins. Keep supports removable from those features and cable openings.
4. Remove supports and burrs, then dry-fit doors, lens halves, magnets, and
   purchased parts before gluing or fitting electronics. Do not globally resize
   the enclosure to fix a single tight hole; that changes every mounting location.

## Print settings to record

No slicer profile accompanied these files. Material, orientation, or support
settings below must not be treated as tested until filled in from the actual
print. The export orientation alone is not a printing recommendation.

| Field | Status |
| --- | --- |
| Source CAD / mechanical revision | Editable source and revision name pending; see [CAD notes](../cad/README.md) |
| Printer and process | Pending |
| Material / filament used | Pending |
| Nozzle and layer height | Pending |
| Walls, top/bottom layers, and infill | Pending |
| Orientation for each of the six parts | Pending slicer screenshots |
| Supports, brim, and support interfaces | Pending slicer screenshots |
| Magnet-hole fit and door clearances | Pending printed-part measurements |
| Camera locating-pin and lens-actuator clearance | Pending fit/focus checks |
| Print time and filament quantity | Pending slicer estimates |
| Test print date and final assembled validation | Pending for this documented settings set |

## File integrity

All six files passed binary STL length/triangle-count and finite-coordinate
checks and match their supplied originals. These checks do not establish
manifoldness, slicer compatibility, print quality, or mechanical fit.

Run `shasum -a 256 *.stl` from this directory to compare with:

```text
3075b1e9511f5c1362fa5aead421a088b1111550b8816501f8101e1d849f2379  body_front.stl
7a8fc0d1022d8f4f8952f85d7305699d252f83a94111bdef06fb895fa9331fbe  body_main.stl
97ea211a343902a7f8289fae1af1e4723ec2c2171823ff44b7fcac900dadf849  door_side.stl
5e7b3fde61a35fad9752df0e19703d1eb8fb2210e5cd830ee7748e5cc2bbcd77  door_top.stl
3f474c973b71d8891eedef6b5391fd0790f6d16bde4b0bd29b184232bd79de4a  lens_back.stl
1323c2ce16437ac9b88e231a7ca4db07cb82d0bef665291462da371cb5ea52e2  lens_front.stl
```

# Notices

The code written for Sunpatch (`Assets/Scripts/`, `Assets/LeafTests/`) is MIT licensed (`LICENSE`).
The items below are third-party and are **not** covered by that license.

## Snap Inc. packages (Lens Studio Asset Library)

Included in `Packages/` as installed by Lens Studio. © Snap Inc. Used under the Snap Lens Studio terms and the license terms that ship with each package.

- Spectacles Interaction Kit (SIK) — pinch and drag interactions
- Spectacles UI Kit — the season button
- LEAF — automated Lens test framework (test scenarios only)
- Motion and Icons — dependencies installed with UI Kit
- Bitmoji 3D — included by the Spectacles project template (not used by Sunpatch)

## Lens Studio project template and presets

The project was created from Lens Studio's Spectacles project template. Template and preset content (camera and lighting setup, `Assets/Render/` environment map, `Base.png`, the `unlit` and `simple_pbr` graph shaders) is © Snap Inc. and used under the Lens Studio terms.

## Solar position equations

The sun position and sunrise/sunset times are computed with the equations of the NOAA Global Monitoring Laboratory *Solar Calculator* (NOAA spreadsheet, after Jean Meeus, *Astronomical Algorithms*), reimplemented in `Assets/Scripts/SolarPosition.ts`. NOAA material is a work of the U.S. Government. https://gml.noaa.gov/grad/solcalc/

## Generated assets

`Assets/SunpatchSoftPatch.png` (soft-edge texture) and `Assets/SunpatchChime.wav` (two-tone chime) were generated procedurally for this project and are MIT licensed with the code.

# Sunpatch

**Pinch a window once and see, on the real floor, where its sunlight lands — now, on Dec 21 and on Jun 21 — at any hour you drag the sun to.**

A Lens for Snap Spectacles, built for *Learn AR with SPECS* (Devpost).

## What it is

You are at a 15-minute apartment viewing in November and want to know: *does this living room get winter afternoon sun?* With Sunpatch you pinch the window. A soft gold patch of light appears on the floor exactly where the sunlight through that window lands, with a small label (`15:10 · today`). Look at the window and the sun's path for the day appears outside it, with a small sun you can grab and drag along that path to change the hour; the patch glides across the floor as you drag. One button switches the day: **Today → Dec 21 → Jun 21**. In December the light reaches deep into the room, to the sofa; in June it stays by the window.

## Who it is for

- Someone viewing a flat or house who wants to know where the light goes in winter and summer before signing.
- Someone deciding where a plant, a desk or a reading chair should go.

## Why glasses

- **It shares your view.** A phone sun app draws the sun's path in the sky. Sunpatch draws where the light lands on *your* floor, while you look at the window and the floor together and walk around.
- **It draws in the world.** The light patch lies on the floor; the sun's arc sits outside the window it comes through.
- **It leaves your hands free.** No phone to hold up; you grab the sun itself to change the hour.

## The one spatial moment

1. Pinch the window → the gold patch fades onto the floor with `15:10 · today`.
2. Look at the window, grab the small sun on the arc outside, drag → the patch glides; drag toward evening and the light leaves the room (`Sun lands beyond this room`, then `Sun has set / Sunset 16:24`).
3. Press the season button → **Dec 21**: the arc drops and the patch reaches the sofa; **Jun 21**: the arc rises and the patch retreats to the window.

What you see is chosen by where you look: the window shows the arc and the sun; the floor shows the patch label; anywhere else shows only the light itself. If the patch is out of view, a small gold arrow at the edge of the view points to it, with one soft chime.

## Not a simulation — and an honest preview

The patch is geometry, not an effect: the window's four corners are pushed along the sunlight direction until they meet the floor. The sun direction comes from the NOAA solar position equations for the place, the date and the clock. Nothing about the light is invented, and the Lens never judges a room: every text is a clock time, a date, a sunrise/sunset time or a plain state such as `No direct sun`.

Lens Studio's preview cannot change location, has no compass and cannot scan a real window, so the preview uses stand-ins and says so on screen in a small floor note: **`Preview: London · north fixed`**.

| Real version (on Spectacles) | Preview stand-in (this project) |
|---|---|
| Device location | London, 51.5074 N, 0.1278 W, UK time (GMT/BST) |
| Compass heading | Fixed: the front wall faces 200° (SSW); a floor "N" marker shows where the Lens thinks north is |
| The window you pinch (pinch point + surface) | A built room with three windows, each an invisible 120 × 100 cm pinch target |
| The clock | The real clock; if the sun is down in London when the Lens opens, it starts at 15:10 today (London date). The label always shows the actual date and time being computed |

The three windows face 200° (front), 290° (right) and 20° (back), so one window catches the afternoon sun, one catches the evening, and one gets no direct sun at noon.

## How it was made

- **Design brief** from the Devpost *Learn AR with SPECS* skill pack (`plan-lens` interview → `devpost/design-brief.md`).
- **CLAD** (the Lens Studio agent toolkit) driving **Lens Studio 5.23 through its MCP server**: scene edits, materials, compiling, preview captures and test runs.
- **Spectacles Interaction Kit (SIK)** for pinching the window and grabbing the sun; **Spectacles UI Kit** for the season button.
- **LEAF** (Lens Studio's automated test framework) for the scenarios below, run in the Lens Studio preview.
- TypeScript, one job per script:

| Script | Job |
|---|---|
| `SolarPosition.ts` | NOAA solar position, sunrise/sunset (pure functions) |
| `SunFrame.ts` | Compass azimuth/altitude → scene direction (north alignment constant) |
| `WindowPin.ts` | Pinch target for a window → its center, normal, size and corners |
| `PatchProjector.ts` | Window corners → floor patch; soft gold edge, glide, faint rays |
| `SunArcUI.ts` | The day's sun arc outside the window, the drag handle, the season button |
| `GazeDisclosure.ts` | Window / floor / elsewhere → what shows; off-view arrow and chime |
| `SunpatchMain.ts` | State, start rule, label, and the test API (`global.sunpatch`) |

### Look and motion

Warm gold patch at about 0.55 opacity with a 14 cm soft edge centred on the true outline (the light's corners stay exact), pale sky-blue glass, four very faint rays from the window corners to the patch corners. Changes fade in 200–300 ms and the patch glides to its new place; nothing blinks. A `reduceMotion` setting makes every change instant.

## Tests (LEAF, all passing in the Lens Studio preview)

| # | Scenario | What it checks | Result |
|---|---|---|---|
| 1 | `sunpatch-c1-june-noon` | London 2026-06-21 12:00 UTC: altitude ≈ 62°, azimuth ≈ 179° (NOAA 61.93° / 178.86°, ±0.5°) | Pass — 61.94° / 178.86° |
| 2 | `sunpatch-c2-december-noon` | London 2026-12-21 12:00 UTC: altitude ≈ 15° (NOAA 15.06°) | Pass — 15.06° (geometric) |
| 3 | `sunpatch-c3-sun-set` | 2026-11-06 20:00: patch and sun handle hidden, label `Sun has set` | Pass — `Sun has set / Sunset 16:24` |
| 4 | `sunpatch-c4-season-reach` | Front window at noon: the Dec 21 patch reaches farther into the room than Jun 21 | Pass — centroid 345 cm vs 38 cm |
| 5 | `sunpatch-c5-patch-geometry` | Patch corners on the floor and on the rays from the window corners (rebuilt independently) | Pass — 0.000 cm off-ray |
| 6 | `sunpatch-c6-north-window` | Back window at noon: no patch, `No direct sun`; re-pin brings it back | Pass |
| 7 | `sunpatch-c7-handle-drag` | A real SIK drag of the sun along the arc: time only moves forward, label and readout update, handle stays on the arc | Pass — 11:00 → 12:44, 0 steps back |
| 8 | `sunpatch-c8-season-button-repin` | UI Kit button ×3 → back to Today (arc lower in Dec, higher in Jun); pinching another window moves patch, arc and button | Pass |
| 9 | `sunpatch-c9-off-view-arrow` | Looking away shows the edge arrow and one chime; looking at the patch hides it; no second chime | Pass |
| 10 | `sunpatch-c10-gaze-switch` | Window → arc + handle; floor → label; elsewhere → neither; the patch stays visible | Pass |
| 11 | `sunpatch-c11-reduce-motion` | With reduceMotion, the patch jumps (0 cm glide) and arc/label switch fully at once | Pass — 136 cm glide normally, 0 with reduceMotion |
| 12 | `sunpatch-c12-no-claims` | 797 texts over 3 windows × 3 days × 24 hours: no judgement words, no numbers other than clock times and dates | Pass |

`sunpatch-pose` is not a test: it pins a window and fixes the time for screenshots.

## Run it

1. Open `Sunpatch.esproj` in **Lens Studio 5.23** or later (Spectacles project). The preview device is Spectacles with the empty "Plane" interactive scene.
2. In the Preview panel, use Interactive Preview: WASD to move, Q/E down/up, right-drag to look. A mouse click is a pinch.
3. Click the front window to pin it. Look at the window and drag the small sun along its arc (hover it first, then press and drag). Press **Today** below-right of the window to cycle the day.
4. Tests: open the LEAF panel and run the scenarios listed above.

## Limitations

- Preview only: London location, fixed north (200°), built room and windows. On Spectacles the location, heading and pinched window would be real; the heading sign on the device is not verified (no device was available).
- The patch is drawn on the floor plane only; light on walls and furniture, curtains, trees and neighbouring buildings are out of scope. The patch is clipped where the room ends, and it shows under furniture rather than on it.
- The sun handle must be within the 5 m reach of the pinch ray; stand within about 4.5 m of the window to grab it.
- Comfort, readability and hand tracking on real glasses are not proven; only the logic is tested.

## Credits

- Solar position: NOAA Global Monitoring Laboratory, *Solar Calculator* and its spreadsheet equations (after Jean Meeus, *Astronomical Algorithms*). https://gml.noaa.gov/grad/solcalc/
- Snap packages and templates: see `NOTICE.md`.

## License

MIT for the code in this repository (`LICENSE`). Snap packages are covered by their own terms (`NOTICE.md`).

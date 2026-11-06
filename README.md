# Sunpatch

**Pinch a window once and see, on the real floor, where its sunlight lands — now, on Dec 21 and on Jun 21 — at any hour you drag the sun to.**

A Lens for Snap Spectacles, built for *Learn AR with SPECS* (Devpost).

**Demo video:** https://youtu.be/5HDmLFhn6GA · **Devpost:** https://devpost.com/software/sunpatch-qgwhb7

## What it is

You are at a 15-minute apartment viewing in November and want to know: *does this living room get winter afternoon sun?* With Sunpatch you pinch the window. A soft patch of light appears on the floor exactly where the sunlight through that window lands, with a small label (`15:10 · Today`). Look at the window and the sun's path for the day appears outside it, with a small sun you can grab (or grab the path anywhere) and drag to change the hour; the patch follows as you drag. A three-part control next to the window picks the day: **Today | Dec 21 | Jun 21**. In December the light reaches deep into the room, to the sofa; in June it stays by the window.

## Who it is for

- Someone viewing a flat or house who wants to know where the light goes in winter and summer before signing.
- Someone deciding where a plant, a desk or a reading chair should go.

## Why glasses

- **It shares your view.** A phone sun app draws the sun's path in the sky. Sunpatch draws where the light lands on *your* floor, while you look at the window and the floor together and walk around.
- **It draws in the world.** The light patch lies on the floor; the sun's arc sits outside the window it comes through.
- **It leaves your hands free.** No phone to hold up; you grab the sun itself to change the hour.

## The one spatial moment

0. Before anything is pinned, `Pinch a window` floats above the window you face and the window outlines breathe softly.
1. Pinch the window → faint rays, then the patch grows onto the floor from the window side, then `15:10 · Today`. `Drag the sun` shows under the sun until you first drag it.
2. Look at the window, grab the sun (or the arc anywhere) and drag → the patch follows; drag toward evening and the light leaves the room (`Sun lands beyond this room`); the arc's end is the sunset itself (`Sun has set / Sunset 16:24`).
3. Pinch **Dec 21** → the arc drops and the patch reaches the sofa; **Jun 21** → the arc rises and the patch retreats to the window; **Today** → back.

What you see is chosen by where you look: the window shows the arc and the sun; the floor shows the patch label; anywhere else shows only the light itself. While you hold the sun, the arc and the floor label both stay. If you look elsewhere for 1.5 s and the light is out of view, a small gold arrow 1 m ahead, near the edge of the view, points to it. One soft chime sounds at most once per pinned window, only if a pin or a day change moved the light while you had not seen it.

## Not a simulation — and an honest preview

The patch is geometry, not an effect: the window's four corners are pushed along the sunlight direction until they meet the floor. The sun direction comes from the NOAA solar position equations for the place, the date and the clock. Nothing about the light is invented, and the Lens never judges a room: every text is a clock time, a date, a sunrise/sunset time or a plain state such as `No direct sun`.

Lens Studio's preview cannot change location, has no compass and cannot scan a real window, so the preview uses stand-ins and says so on screen in a small standing note next to the floor "N" marker: **`Preview · London · north assumed`**.

| Real version (on Spectacles) | Preview stand-in (this project) |
|---|---|
| Device location | London, 51.5074 N, 0.1278 W, UK time (GMT/BST) |
| Compass heading | Fixed: the front wall faces 200° (SSW); a floor "N" marker shows where the Lens thinks north is |
| The window you pinch (pinch point + surface) | A built room with three windows, each an invisible 120 × 100 cm pinch target |
| The clock | The real clock; if the sun is down or low in London when the Lens opens (or its light would land outside the room), it starts at 15:10 today (London date) and the note says so for the first 6 s (`Sun is down now, showing 15:10`). The label always shows the actual date and time being computed. Times are UK time (GMT/BST) even if the latitude/longitude inputs are changed |

The three windows face 200° (front), 290° (right) and 20° (back), so one window catches the afternoon sun, one catches the evening, and one gets no direct sun at noon.

## How it was made

- **Design brief** from the Devpost *Learn AR with SPECS* skill pack (`plan-lens` interview → `devpost/design-brief.md`).
- **CLAD** (the Lens Studio agent toolkit) driving **Lens Studio 5.23 through its MCP server**: scene edits, materials, compiling, preview captures and test runs.
- **Spectacles Interaction Kit (SIK)** for pinching the window, grabbing the sun and the three-part day control.
- **LEAF** (Lens Studio's automated test framework) for the scenarios below, run in the Lens Studio preview.
- TypeScript, one job per script:

| Script | Job |
|---|---|
| `SolarPosition.ts` | NOAA solar position, sunrise/sunset (pure functions) |
| `SunFrame.ts` | Compass azimuth/altitude → scene direction (north alignment constant) |
| `WindowPin.ts` | Pinch target for a window → its center, normal, size and corners; outline and aimed-at glow |
| `PatchProjector.ts` | Window corners → floor patch; light colour and penumbra edge, motion, rays |
| `SunArcUI.ts` | The day's sun arc outside the window and the drag handle |
| `SeasonControl.ts` | Today \| Dec 21 \| Jun 21 next to the window |
| `GazeDisclosure.ts` | Window / floor / elsewhere → what shows; off-view arrow and chime |
| `SunpatchMotion.ts` | Every motion duration and curve, tweens, fades, the patch spring, reduce motion |
| `SunpatchMain.ts` | State, start rule, label, notes, and the test API (`global.sunpatch`) |

### Look and motion

- **Light like light.** The patch colour follows the sun's altitude (near white high up, pale gold at 15°, warm amber near the horizon) and its opacity follows floor illuminance (about 0.44 at 9°, 0.62 at 62°), so a long winter patch is dimmer. Its soft edge is the real penumbra (the sun is 0.53° wide): 2.5–6 cm, centred on the true outline. Rays show only while the sun is held and for 2 s after a change.
- **Readable at 3–4 m.** Label cap height about 4.5 cm, 25 cm above the patch and turned to face you; sun clock about 5 cm, 12 cm above a 6 cm sun with a 12 cm halo and a 24 cm grab sphere; the arc line is 1.2 cm with 3 cm hour dots, a faint dashed line where the sun is behind the wall, and the visible ends marked (`13:09`, `Sunset 16:24`). The day control is three 16 × 10 cm parts at the window's centre height, 20 cm to its right, light plates (no dark plates on an additive display).
- **Calm motion.** Arriving things ease out, leaving things ease in, things that move to a new place ease in-out. On the pin: rays, then the patch grows from the window side (400 ms), then the label (120 ms later), then the day control (350 ms, a delay only). Dragging: the patch follows on a critically damped spring (no overshoot) and the clock moves in whole minutes with a small dead band. Day change: arc and patch move together in 500 ms; a move over 1.5 m crossfades instead of sweeping. Sunset: the patch fades in place, the label crossfades. Gaze: 120 ms to show, 250 ms to hide, a 15 cm larger area on the way out. Nothing pulses; the only loop is the onboarding outline before the first pin. `reduceMotion` makes every change instant (the anti-flicker filters stay).

## Tests (LEAF, 15 scenarios, all passing in the Lens Studio preview)

| # | Scenario | What it checks | Result |
|---|---|---|---|
| 1 | `sunpatch-c1-june-noon` | London 2026-06-21 12:00 UTC: altitude ≈ 62°, azimuth ≈ 179° (NOAA 61.93° / 178.86°, ±0.5°) | Pass — 61.94° / 178.86° |
| 2 | `sunpatch-c2-december-noon` | London 2026-12-21 12:00 UTC: altitude ≈ 15° (NOAA 15.06°) | Pass — 15.06° (geometric) |
| 3 | `sunpatch-c3-sun-set` | Sunrise/sunset = NOAA 07:02:42 / 16:24:48 (±1 min); the patch goes off at the shown sunset (lit 30 s before, set 1 s after); 20:00 → `Sun has set / Sunset 16:24 / 20:00 · …`, the sun waits dimmed at the arc's sunset end; 05:00 → `Sun not up yet` | Pass — 0.00 min off |
| 4 | `sunpatch-c4-season-reach` | Front window at noon: the Dec 21 patch reaches farther into the room than Jun 21 | Pass — centroid 345 cm vs 38 cm |
| 5 | `sunpatch-c5-patch-geometry` | Patch corners on the floor and on the rays from the window corners (rebuilt independently) | Pass — 0.000 cm off-ray |
| 6 | `sunpatch-c6-north-window` | Back window at noon: no patch, `No direct sun`; re-pin brings it back | Pass |
| 7 | `sunpatch-c7-handle-drag` | A real SIK drag of the sun along the arc: time only moves forward, label and readout update, handle stays on the arc | Pass — 11:00 → 12:42, 0 steps back |
| 8 | `sunpatch-c8-season-button-repin` | Three parts (16 × 10 cm, 2 cm apart, 20 cm right of the window, centre height) pinched with real SIK triggers: one chosen part, arc lower in Dec, higher in Jun, back to Today; another window moves patch, arc and control | Pass |
| 9 | `sunpatch-c9-off-view-arrow` | Arrow only after 1.5 s elsewhere, never while looking at the window; it points toward the patch (lower-left) about 1 m ahead; three day changes → one chime, none again | Pass — 104 cm, 1 chime |
| 10 | `sunpatch-c10-gaze-switch` | Window → arc + handle; floor → label; elsewhere → neither; the patch stays at its altitude opacity | Pass |
| 11 | `sunpatch-c11-reduce-motion` | Normal: a day change over 1.5 m crossfades; reduceMotion: the patch is in place and fully visible on the next frame, gaze switches are all-or-nothing | Pass — 192 cm then 0, alpha at its altitude target |
| 12 | `sunpatch-c12-no-claims` | 3 windows × 3 days × 24 hours: no judgement words, no numbers other than clock times and dates; the scene walk finds the Lens's texts from the objects, not by name | Pass — 1,915 texts |
| 13 | `sunpatch-c13-handle-reach` | Sun up but off the arc → handle waits dimmed at the nearest end and a real drag brings the light in; real hover → halo 0.45 ×1.25; arc and handle never fade while held (gaze on the floor) and 0.5 s after; the arc's end = sunset; `Sun lands beyond this room` at 16:00; clipped polygon at 15:10 | Pass — 0 frames off |
| 14 | `sunpatch-c14-first-minute` | Onboarding hint and breathing outlines (0.15–0.35); pin order rays → patch grows from the window side → label (+132 ms) → control; pinned outline 0.35; `Drag the sun` until the first drag; honest 15:10 note for 6 s; a bad time is refused | Pass |
| 15 | `sunpatch-c15-furniture-light` | Dec 21 noon: the light that reaches the sofa is drawn on the seat top (every point at the seat's height, inside the seat, and on a ray back through the window); the floor behind the seat is in its shadow; Jun 21 noon: nothing on the seat | Pass |

`sunpatch-pose` is not a test: it pins a window and fixes the time for screenshots.

## Run it

1. Open `Sunpatch.esproj` in **Lens Studio 5.23** or later (Spectacles project). The preview device is Spectacles with the empty "Plane" interactive scene.
2. In the Preview panel, use Interactive Preview: WASD to move, Q/E down/up, right-drag to look. A mouse click is a pinch.
3. Click the front window to pin it. Look at the window and drag the small sun (or the arc anywhere) along its path (hover it first, then press and drag). Click **Dec 21**, **Jun 21** or **Today** to the right of the window.
4. Tests: open the LEAF panel and run the scenarios listed above.

## Limitations

- Preview only: London location, fixed north (200°), built room and windows. On Spectacles the location, heading and pinched window would be real; the heading sign on the device is not verified (no device was available).
- The light is drawn on the floor and on the sofa's seat top (with the seat's shadow left on the floor behind it). Light on walls and on other furniture faces (the sofa's front and arms), curtains, trees and neighbouring buildings are out of scope. The patch is clipped where the room ends.
- The sun handle must be within the 5 m reach of the pinch ray; stand within about 4.5 m of the window to grab it.
- Comfort, readability and hand tracking on real glasses are not proven; only the logic is tested. On glasses the patch material should add light (additive blend) and the window glass tint should be off; the preview keeps normal blending and the tint so it reads on the grey preview floor.

## Credits

- Solar position: NOAA Global Monitoring Laboratory, *Solar Calculator* and its spreadsheet equations (after Jean Meeus, *Astronomical Algorithms*). https://gml.noaa.gov/grad/solcalc/
- Snap packages and templates: see `NOTICE.md`.

## License

MIT for the code in this repository (`LICENSE`). Snap packages are covered by their own terms (`NOTICE.md`).

---
status: approved
---

# Design brief: Sunpatch

<!-- Filled in by plan-lens from the learner's interview (answers taken from the learner's design notes, sunpatch-design.md). Use the learner's words. Mark any value they didn't choose as (default). -->

## The one spatial moment
At a 15-minute apartment viewing, pinch the window once and Sunpatch draws on the real floor where sunlight through that window lands — now, on Dec 21, and on Jun 21 — at any hour you drag the sun to.

The 10-second open (video opening shot):
- 0–3 s: pinch the window → a gold patch slides onto the floor with a label "15:10 · today".
- 3–8 s: grab the small sun on the arc outside the window and drag → the patch glides across the floor and the hour label updates; drag to evening → the patch fades, "Sunset 16:21".
- 8–14 s: one button, "Dec 21" → the arc drops and the patch reaches deep into the room, to the sofa; again, "Jun 21" → the patch retreats to the window.

**Who it's for:** someone viewing an apartment or house (15 minutes, in November) asking "does the living room get winter afternoon sun?" Second: someone choosing where a plant goes.

**Not a simulation:** real location + real time + the real window's position and orientation → real geometry on the real floor. Nothing about the light is invented; the patch is the window rectangle pushed along the sun direction (NOAA solar position algorithm) until it meets the floor.

## Why it belongs on glasses
- Uses: shares your view, draws in the world, leaves your body free.
- Why it's better than the phone or laptop version: a phone sun app draws the sun's path in the sky, not where light lands on *your* floor. With glasses you look at the window and the floor together while walking around the room; the gold patch lies on the floor where the light will be, and the sun's arc sits outside the window it comes through. No phone to hold: you grab the sun itself to change the hour.

## Product or overlay
- Type: overlay. It responds to a real window in a real room.
- What the real version would sense: the window rectangle (one pinch on the window; on glasses the pinch point and the surface it hits give the window's center, normal and size), the device's location (latitude/longitude) and compass heading (which way is north), and the clock.
- Stand-in for the preview:
  - The room is built in the scene: floor, walls, a window opening on the south-ish wall, a sofa block deep in the room.
  - Each window has an invisible collider (default 120 × 100 cm) that stands in for "the window the pinch hit". Pinching it pins that window.
  - Location: the preview can't override location, so the Lens uses London (51.5074° N, 0.1278° W) and London time, and says so on screen: "Preview: London location".
  - North: a fixed preview constant (the window wall faces 165°, SSE (default)) shown by a north marker "N" on the floor, so the viewer can see which way the Lens thinks north is.
  - Time: the real current time by default. Tests (and the demo) can fix the date and time.

## Where things live
- Where the user is looking during the main task: standing in the room about 3.5 m from the window (default), looking at the window and the floor between them; walking closer to grab the sun.
- Window (stand-in): on the far wall, 120 × 100 cm (default from the design), sill 50 cm above the floor (default), wall facing 165° (SSE) (default).
- Sun patch: on the floor, 1 cm above it, translucent warm gold (no black, additive display). Its shape is the window's 4 corners pushed along the sun direction to the floor, clipped to the room's floor.
- Patch label: 10 cm above the patch center, white text about 6 cm tall (default) so it reads from 2–3 m: "15:10 · today", "15:10 · Dec 21", "Sun has set", "No direct sun".
- Sun arc (later step): a thin line of today's sun path drawn outside the window, scaled so the whole arc fits around the window (about 1.5 m radius) (default).
- Sun handle (later step): a 4 cm sphere on the arc (design value), grabbed and dragged along the arc.
- Season button (later step): UI Kit button 15 cm below-right of the window, at least 8 cm (design value). Labels: "Today" → "Dec 21" → "Jun 21".
- Sofa: a simple block, deep in the room (about 2.7–3.4 m from the window wall) (default), so the Dec 21 reach is visible.
- North marker: a flat "N" with an arrow on the floor near the user, plus a small note "Preview: London location".
- Rays (later, optional): 4 thin lines from the window corners to the patch corners.

## Hands and input
Mouse = one hand pinching.
- Pin the window: pinch the window (preview: click the invisible window collider). Pinching another window re-pins.
- Change the hour: grab-drag the sun handle; it is constrained to today's arc, so it can't leave the sun's real path.
- Change the season: one button cycles Today → Dec 21 → Jun 21 → Today.
- Targets are big and highlight when aimed at.
- No voice, no custom or two-hand gestures.

## When things show
- Before a window is pinned: only the room, the north marker and the preview note. Nothing else.
- After the pin: the patch and its label show while the sun is up and in front of the window wall.
- Sun below the horizon: patch and handle hidden, label "Sun has set" at the window.
- Sun behind the window wall (e.g. a north window at noon): no patch, label "No direct sun" at the window.
- Gaze (later step): looking at the window shows the arc and sun handle; looking at the floor shows the patch and its time label; looking elsewhere shows nothing extra.
- If something needs attention out of view: patch out of view → a small edge arrow + chime (first to cut).

## Done criteria
Each one can be checked in Lens Studio's preview.
1. London, 2026-06-21 12:00 UTC: the Lens reports sun altitude ≈ 62° and azimuth ≈ 179° (within 0.5° of the NOAA spreadsheet values 61.93° / 178.86°).
2. London, 2026-12-21 12:00 UTC: altitude ≈ 15° (NOAA 15.06°, within 0.5°).
3. London, 2026-11-06 20:00: the sun is below the horizon → the patch (and handle) are hidden and the label says "Sun has set".
4. South window at noon: the Dec 21 patch reaches farther from the window than the Jun 21 patch.
5. The patch's 4 corners lie on the floor (1 cm above it) and on the rays from the window's 4 corners along the sun direction.
6. North window at noon: no patch, label "No direct sun".
7. Dragging the sun handle along the arc moves the time forward monotonically and updates the label.
8. Pressing the season button 3 times comes back to Today; pinching another window moves the patch and the arc to that window.
9. Looking away from the patch shows the edge arrow; looking at it hides it (first to cut).

## Out of scope
- Patches on walls, tree shade outdoors, curtains, neighbouring buildings, the moon.
- Real window detection (the pinch stands in).
- Remembering windows between sessions.

## Risks and open questions
- Preview heading: the preview has no compass, so north is a constant; the "N" marker shows which way it is. On glasses the heading sign must be checked (feel unproven).
- Location can't be changed in the preview, so the preview always shows London; said on screen.
- WorldQuery (finding the real wall) is not guaranteed in the preview, so the window collider stands in.
- The real-time default can be night in London when the demo runs; the label then honestly says "Sun has set" until the sun is dragged or the time is set.
- On glasses the patch is drawn on the virtual floor plane at the floor height, not on a scanned floor (feel unproven).
- Cut lines (drop in this order if short on time): 1 off-view arrow, 2 rays from window to patch, 3 "Direct sun today 10:40–14:20" summary, 4 season button (fix to Dec 21). Never drop: window pinch + floor patch + sun drag.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources

## Preview environment
- Room at real size: floor 500 × 550 cm (default), light warm gray; walls 260 cm tall (default), light beige; no ceiling so the preview camera can see in.
- Front wall (window wall, faces 165° SSE) 350 cm in front of the start position; window 120 × 100 cm, sill 50 cm, centered.
- Right wall (faces 255°, WSW) with a second window (same size) for re-pinning; back wall (faces 345°, NNW) with a third window, for the "No direct sun" case.
- Sofa block (160 × 80 cm, seat 45 cm, back 85 cm) on the left, 2.7–3.4 m from the window wall.
- Start position: standing, eyes 160 cm above the floor (default), facing the window wall.

## Changes after review
- First build (2026-11-05), core only: room, three pinchable windows (south-ish 165°, WSW 255° on the right wall, NNW 345° on the back wall), NOAA sun position, the floor patch, the label, the north marker and the preview note. Sun arc, sun handle, season button (UI Kit), gaze disclosure, rays, off-view arrow and chime are not built yet; the season change exists in the test API only.
- Season keeps the clock time, not the UTC instant: "12:00 · Jun 21" is 12:00 BST (11:00 UTC), so the Jun 21 patch sits slightly east of straight-in. Times are UK civil time (GMT/BST).
- Label wording beyond the design: before sunrise the label says "Sun not up yet / Sunrise 07:02" (after solar noon it is "Sun has set / Sunset 16:24"); if all the light lands beyond the room's walls it says "Sun lands beyond this room". "No direct sun" also shows the clock.
- The date tag says "today" only when the London date is today; otherwise the date ("15:10 · Nov 5").
- The patch is clipped to the room's floor rectangle (light that would land past a wall is dropped; walls are out of scope).
- Preview environment set to Lens Studio's empty "Plane" scene, so the built room is not mixed with the default living room's furniture.
- Open question: with the window wall at 165°, at 15:10 on Nov 5 the sun (azimuth 230°, altitude 9°) sends the light mostly past the left (west) wall, so the design's opening shot shows only a thin strip. Either the wall should face closer to 200° (SSW) or the opening shot should use an earlier hour. Not decided yet.

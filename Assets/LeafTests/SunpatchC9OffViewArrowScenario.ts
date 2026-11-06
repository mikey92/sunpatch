/**
 * Done criterion 9 — the edge arrow points to the light when it is out of view; looking at the
 * light hides it. Rules after the spatial design and bug reviews:
 *  - The arrow shows only after the gaze has been elsewhere (not window, not floor) for 1.5 s,
 *    never while looking at the window (that is where the sun is dragged).
 *  - It points toward the patch (patch to the lower left -> arrow x < 0, y < 0) and sits about
 *    1 m ahead (not 0.5 m, not stuck to the face).
 *  - The chime sounds at most once per pinned window, only after a pin or season change moved the
 *    light while it was not seen: cycling the three seasons gives one chime, not three, and coming
 *    back to Today does not chime again.
 * South window, London 2026-11-06 12:00 (patch inside the room, ahead and below the eye).
 * Gaze is scripted through GazeDisclosure's override (the same code path as the camera ray).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { sleep } from "Leaf.lspkg/Utils/common/Utils"
import { check, EYE, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC9OffViewArrowScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const gaze = (global as any).sunGaze
    const ctl = (global as any).seasonControl
    api.setReduceMotion(false)
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await pinchWindow("WindowEast")
    await pinchWindow("WindowSouth")
    await sleep(300)
    check(api.isPatchVisible(), "patch lit at 12:00")

    // Seen it: no chime later.
    await lookAt("floor")
    await waitFor(() => gaze.getArrowOpacity() <= 0.001, 1500, "no arrow while looking at the patch")
    check(gaze.isPatchInView() && !gaze.isArrowVisible() && !gaze.isChimeArmed(), "looking at the patch: in view, no arrow, nothing to chime")
    const chimes0: number = gaze.getChimeCount()

    // Look up and to the right: the patch is to the lower left, out of view.
    gaze.setGazeOverride(EYE, new vec3(1, 0.35, -0.2))
    await sleep(600)
    check(gaze.getGaze() === "none" && !gaze.isPatchInView(), "looking up-right: elsewhere, patch out of view")
    check(!gaze.isArrowVisible(), "no arrow yet after 0.6 s elsewhere (needs 1.5 s)")
    await waitFor(() => gaze.isArrowVisible(), 2500, "arrow after 1.5 s elsewhere")
    const ms: number = gaze.getElsewhereMs()
    check(ms >= 1450, "arrow came after " + ms.toFixed(0) + " ms elsewhere (>= 1500)")
    await waitFor(() => gaze.getArrowOpacity() > 0.99, 1500, "arrow faded in")
    await sleep(800)
    const d: vec2 = gaze.getArrowDir()
    log("arrow direction (" + d.x.toFixed(2) + ", " + d.y.toFixed(2) + "), distance " + gaze.getArrowDistance().toFixed(1) + " cm")
    check(d.x < 0 && d.y < 0, "arrow points lower-left, toward the patch")
    check(Math.abs(gaze.getArrowDistance() - 100) < 8, "arrow about 1 m ahead (" + gaze.getArrowDistance().toFixed(1) + " cm)")
    check(gaze.getChimeCount() === chimes0, "no chime: the light had been seen (" + gaze.getChimeCount() + ")")

    await lookAt("floor")
    check(!gaze.isArrowVisible(), "looking at the patch again: arrow hidden")
    await waitFor(() => gaze.getArrowOpacity() <= 0.001, 1500, "arrow faded out")

    // Looking at the window: never an arrow, even after 2 s, even with the patch out of view.
    await lookAt("window")
    await sleep(2000)
    check(!gaze.isArrowVisible() && gaze.getArrowOpacity() <= 0.001, "looking at the window: no arrow (patch in view: " + gaze.isPatchInView() + ")")

    // Cycle the seasons from the window (the light moves while unseen), then look away: one chime.
    for (const s of ["dec21", "jun21", "today"]) {
      ctl.pressPart(s)
      await sleep(700)
    }
    check(gaze.getChimeCount() === chimes0, "no chime while looking at the window")
    gaze.setGazeOverride(EYE, new vec3(1, 0.35, -0.2))
    await waitFor(() => gaze.isArrowVisible(), 2500, "arrow after looking away")
    await sleep(100)
    const chimes1: number = gaze.getChimeCount()
    check(chimes1 === chimes0 + 1, "one chime after the three season changes (" + chimes0 + " -> " + chimes1 + ")")

    await lookAt("window")
    await sleep(400)
    ctl.pressPart("dec21")
    await sleep(700)
    ctl.pressPart("today")
    gaze.setGazeOverride(EYE, new vec3(1, 0.35, -0.2))
    await waitFor(() => gaze.isArrowVisible(), 2500, "arrow again")
    await sleep(100)
    check(gaze.getChimeCount() === chimes1, "no second chime for this window (" + gaze.getChimeCount() + ")")
    restoreLive()
    log("C9 done")
  }
}

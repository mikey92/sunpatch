/**
 * Done criterion 9 — looking away from the patch shows the edge arrow; looking at it hides it.
 * South window, London 2026-11-06 12:00 (patch inside the room).
 * Gaze is scripted through GazeDisclosure's gaze override (the same code path as the camera ray).
 * Checks: looking at the patch -> no arrow; looking back over the shoulder -> arrow shown and
 * faded in, one chime; looking at the patch again -> arrow hidden and faded out; looking away a
 * second time -> arrow again but no second chime (one chime per window/season).
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
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await pinchWindow("WindowEast")
    // Look at the floor ahead (where the south patch will be) before the fresh south pin.
    gaze.setGazeOverride(EYE, new vec3(40, -160, -140).sub(EYE))
    await pinchWindow("WindowSouth") // a fresh pin: the chime may play once again
    await sleep(300)
    check(api.isPatchVisible(), "patch lit at 12:00")

    await lookAt("floor")
    await waitFor(() => gaze.getArrowOpacity() <= 0.001, 1500, "no arrow while looking at the patch")
    check(gaze.isPatchInView() && !gaze.isArrowVisible(), "looking at the patch: in view, no arrow")
    const chimes0: number = gaze.getChimeCount()

    await lookAt("away")
    check(!gaze.isPatchInView() && gaze.isArrowVisible(), "looking away: patch out of view, arrow shown")
    await waitFor(() => gaze.getArrowOpacity() > 0.9, 1500, "arrow faded in")
    const chimes1: number = gaze.getChimeCount()
    check(chimes1 === chimes0 + 1,
      "one chime for this window and season (" + chimes0 + " -> " + chimes1 + ")")

    await lookAt("floor")
    check(!gaze.isArrowVisible(), "looking at the patch again: arrow hidden")
    await waitFor(() => gaze.getArrowOpacity() <= 0.001, 1500, "arrow faded out")

    await lookAt("away")
    check(gaze.isArrowVisible(), "looking away again: arrow back")
    check(gaze.getChimeCount() === chimes1, "no second chime (" + gaze.getChimeCount() + ")")
    log("chimes: " + chimes0 + " -> " + gaze.getChimeCount())
    restoreLive()
    log("C9 done")
  }
}

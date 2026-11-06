/**
 * Criterion 11 — reduceMotion: everything switches at once instead of fading or gliding.
 * South window, London 2026-11-06 12:00.
 * First, with motion on, a season change leaves the drawn patch still gliding (> 1 cm from its new
 * place on the next frame), which shows the normal glide exists. Then with reduceMotion on:
 * a season change puts the patch in its new place on the next frame (glide error 0, opacity at
 * its target); gaze switches put the arc and label at fully on/off right after the 150 ms dwell,
 * with no partial opacity.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { nextFrame } from "Leaf.lspkg/Utils/common/Utils"
import { check, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC11ReduceMotionScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    await pinchWindow("WindowSouth")
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await lookAt("floor")

    api.setReduceMotion(false)
    await waitFor(() => api.getPatchGlideError() < 0.01, 2000, "patch settled")
    api.setSeason("dec21")
    await nextFrame()
    const glideOn: number = api.getPatchGlideError()
    log("motion on: glide error one frame after the season change " + glideOn.toFixed(1) + " cm")
    check(glideOn > 1, "with motion, the patch glides to its new place")
    await waitFor(() => api.getPatchGlideError() < 0.01, 3000, "patch settled again")

    api.setReduceMotion(true)
    check(api.getReduceMotion(), "reduceMotion on")
    api.setSeason("today")
    await nextFrame()
    const glideOff: number = api.getPatchGlideError()
    log("reduceMotion: glide error one frame after the season change " + glideOff.toFixed(3) + " cm, alpha "
      + api.getPatchAlpha().toFixed(3) + " / target " + api.getPatchTargetAlpha().toFixed(3))
    check(glideOff < 0.01, "patch jumps to its new place")
    check(Math.abs(api.getPatchAlpha() - api.getPatchTargetAlpha()) < 1e-3, "patch opacity at its target at once")

    await lookAt("window", 200)
    check(arc.getArcOpacity() === 1 && api.getLabelOpacity() === 0, "window: arc fully on, label fully off at once ("
      + arc.getArcOpacity() + ", " + api.getLabelOpacity() + ")")
    await lookAt("floor", 200)
    check(arc.getArcOpacity() === 0 && api.getLabelOpacity() === 1, "floor: arc fully off, label fully on at once ("
      + arc.getArcOpacity() + ", " + api.getLabelOpacity() + ")")
    await lookAt("away", 200)
    check(arc.getArcOpacity() === 0 && api.getLabelOpacity() === 0, "elsewhere: both off at once")
    restoreLive()
    log("C11 done")
  }
}

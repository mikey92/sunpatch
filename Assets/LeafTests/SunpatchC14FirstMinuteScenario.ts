/**
 * Criterion 14 (review fixes) — the first minute: onboarding, the pin moment, honesty.
 *  a. Nothing pinned: "Pinch a window" shows above the window you face and every window's
 *     outline breathes between about 0.15 and 0.35 (sampled over 1.5 s).
 *  b. The pin (a real SIK pinch): the hint fades out; the pinned window keeps a steady 0.35
 *     outline, the others go to 0. Order: the rays start first, then the patch (it grows from its
 *     window-side edge: early on its far edge is short of the target while the near edge is in
 *     place), then the label (at least 100 ms after the patch), then the season control
 *     (350 ms, a delay only).
 *  c. "Drag the sun" shows below the handle when looking at the window, and goes after the first
 *     drag.
 *  d. The preview note stands up and says "Preview · London · north assumed"; when the start rule
 *     falls back to 15:10 its second line says why ("Sun is down now, showing 15:10") for the
 *     first 6 s only.
 *  e. A bad time is refused (no NaN): setUtc("half past three") keeps the clock.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import { nextFrame, sleep } from "Leaf.lspkg/Utils/common/Utils"
import { check, EYE, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"
import { solarPosition } from "../Scripts/SolarPosition"

@component
export class SunpatchC14FirstMinuteScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    const ctl = (global as any).seasonControl
    const gaze = (global as any).sunGaze
    const proj = api.projector
    api.setReduceMotion(false)

    // a. Onboarding.
    api.unpin()
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await waitFor(() => api.isPinchHintShown(), 1500, "\"Pinch a window\" shown")
    let lo = 1
    let hi = 0
    const tEnd = getTime() + 1.5
    while (getTime() < tEnd) {
      const a: number = api.getWindowOutline("WindowEast")
      lo = Math.min(lo, a)
      hi = Math.max(hi, a)
      await nextFrame()
    }
    log("outline breath over 1.5 s: " + lo.toFixed(3) + " .. " + hi.toFixed(3))
    check(lo < 0.19 && lo >= 0.14 && hi > 0.31 && hi <= 0.36, "window outlines breathe about 0.15 <-> 0.35")

    // b. The pin moment.
    gaze.setGazeOverride(EYE, new vec3(40, -160, -140).sub(EYE))
    const first: { [k: string]: number } = {}
    let grewFromWindow = false
    let sampling = true
    const t0 = getTime()
    const sampler = (async () => {
      while (sampling) {
        const t = getTime() - t0
        if (first.ray === undefined && proj.getRayOpacity() > 0.001) first.ray = t
        if (first.patch === undefined && api.getPatchAlpha() > 0.001) {
          first.patch = t
          const d: vec3[] = proj.getDrawnCorners()
          const c: vec3[] = api.getPatchCorners()
          if (d.length === 4 && c.length === 4) {
            grewFromWindow = d[0].distance(c[0]) < 0.5 && d[1].distance(c[1]) < 0.5 && d[2].distance(c[2]) > 5
          }
        }
        if (first.label === undefined && api.getLabelOpacity() > 0.001) first.label = t
        if (first.control === undefined && ctl.isShown()) first.control = t
        await nextFrame()
      }
    })()
    await pinchWindow("WindowSouth")
    await sleep(1200)
    sampling = false
    await sampler
    log("pin order (s after the pinch call): rays " + first.ray + ", patch " + first.patch + ", label " + first.label + ", control " + first.control)
    check(first.ray !== undefined && first.patch !== undefined && first.label !== undefined && first.control !== undefined, "all four appeared")
    check(first.ray <= first.patch, "rays start no later than the patch")
    check(grewFromWindow, "the patch grows from its window-side edge")
    check(first.label - first.patch >= 0.1, "the label comes after the patch (" + ((first.label - first.patch) * 1000).toFixed(0) + " ms)")
    check(first.control >= first.patch, "the season control comes after the light")
    await waitFor(() => !api.isPinchHintShown(), 1000, "hint gone after the pin")
    await sleep(300)
    const pinnedOutline: number = api.getWindowOutline("WindowSouth")
    const otherOutline: number = api.getWindowOutline("WindowEast")
    check(Math.abs(pinnedOutline - 0.35) < 0.01 && otherOutline < 0.01,
      "pinned window keeps a 0.35 outline (" + pinnedOutline.toFixed(3) + "), others 0 (" + otherOutline.toFixed(3) + ")")

    // c. "Drag the sun".
    await lookAt("window")
    await waitFor(() => arc.isDragHintShown(), 1500, "\"Drag the sun\" shown")
    await new DefaultLeafInteractor().drag(arc.getHandleInteractable(), new vec3(0.5, 0, 0), 500)
    await waitFor(() => !arc.isDragHintShown(), 1000, "hint gone after the first drag")

    // d. Honest note.
    const used: boolean = api.replayStart()
    const alt = solarPosition(51.5074, -0.1278, Date.now()).altitudeDeg
    log("start rule now: fallback " + used + " (" + api.wasFallbackStart().why + "), London sun " + alt.toFixed(1) + " deg; note \""
      + api.getPreviewNoteText().split("\n").join(" / ") + "\"")
    check(api.getPreviewNoteText().indexOf("Preview · London · north assumed") === 0, "note says Preview · London · north assumed")
    if (alt <= 0) check(used && api.getPreviewNoteText().indexOf("\nSun is down now, showing 15:10") > 0, "sun down: second line says so")
    if (used) {
      await sleep(6300)
      check(api.getPreviewNoteText() === "Preview · London · north assumed", "after 6 s the second line is gone")
    } else {
      check(api.getPreviewNoteText().indexOf("\n") < 0, "no fallback: one line")
    }

    // e. Bad time.
    api.setUtc("2026-11-06T15:10:00Z")
    const ok: boolean = api.setUtc("half past three")
    check(!ok && api.getLocalClock() === "15:10" && api.getLabel().indexOf("NaN") < 0, "bad time refused, clock kept (" + api.getLocalClock() + ")")
    restoreLive()
    log("C14 done")
  }
}

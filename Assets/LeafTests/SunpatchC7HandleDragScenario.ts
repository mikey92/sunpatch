/**
 * Done criterion 7 — dragging the sun handle along the arc moves the time forward monotonically
 * and updates the label.
 * South window, London 2026-11-06 11:00 GMT. Looking at the window, the handle is grabbed with a
 * real SIK drag (LEAF scripted interactor) whose ray slides toward the west (+X in this room) for
 * 1.5 s. The clock is sampled every frame during the drag.
 * Checks: the handle is on the arc before the drag; the sampled clock never goes back; it moves
 * forward by at least 20 minutes; the patch label and the handle readout change to the new clock;
 * the handle stays on the arc (within 0.5 cm of the drawn path).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import { nextFrame } from "Leaf.lspkg/Utils/common/Utils"
import { check, log, lookAt, pinchWindow, restoreLive, sp, waitForLensUp } from "./SunpatchLeafHelpers"

function distToPolyline(p: vec3, pts: vec3[]): number {
  let best = Number.MAX_VALUE
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const ab = pts[i + 1].sub(a)
    const t = Math.max(0, Math.min(1, p.sub(a).dot(ab) / Math.max(1e-6, ab.dot(ab))))
    best = Math.min(best, p.distance(a.add(ab.uniformScale(t))))
  }
  return best
}

@component
export class SunpatchC7HandleDragScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    await pinchWindow("WindowSouth")
    api.setSeason("today")
    api.setUtc("2026-11-06T11:00:00Z")
    await lookAt("window")
    check(arc.isHandleVisible(), "handle on the arc at 11:00")
    const startMin: number = api.getClockMinutes()
    const startLabel: string = api.getLabel()
    const startHandle: string = arc.getHandleText()
    log("before drag: clock " + api.getLocalClock() + ", label \"" + startLabel.replace("\n", " / ") + "\", handle \"" + startHandle + "\"")

    const samples: number[] = []
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        samples.push(api.getClockMinutes())
        await nextFrame()
      }
    })()
    await new DefaultLeafInteractor().drag(arc.getHandleInteractable(), new vec3(1.2, 0, 0), 1500)
    sampling = false
    await sampler

    let backSteps = 0
    for (let i = 1; i < samples.length; i++) if (samples[i] < samples[i - 1] - 0.01) backSteps++
    const endMin: number = api.getClockMinutes()
    log("drag: " + samples.length + " samples, clock " + startMin.toFixed(1) + " -> " + endMin.toFixed(1)
      + " min (" + api.getLocalClock() + "), steps back: " + backSteps)
    check(backSteps === 0, "time never goes back during the drag")
    check(endMin - startMin >= 20, "time moved forward by >= 20 min (" + (endMin - startMin).toFixed(1) + ")")
    check(api.getLabel() !== startLabel && api.getLabel().indexOf(api.getLocalClock()) === 0,
      "patch label updated to " + api.getLocalClock() + " (\"" + api.getLabel().replace("\n", " / ") + "\")")
    check(arc.getHandleText() !== startHandle && arc.getHandleText().indexOf(api.getLocalClock()) >= 0,
      "handle readout updated (\"" + arc.getHandleText().replace("\n", " / ") + "\")")
    const off = distToPolyline(arc.getHandleWorld(), arc.getArcPoints())
    check(off < 0.5, "handle stays on the arc (" + off.toFixed(3) + " cm)")
    restoreLive()
    log("C7 done")
  }
}

/**
 * Done criterion 4 — south window at noon: the Dec 21 patch reaches farther from the window than
 * the Jun 21 patch. Distances are measured along the window's into-room normal, on the floor,
 * from the window to the patch's centroid and to its farthest corner (unclipped corners).
 * Uses the season button path (Today -> Dec 21 -> Jun 21) from a fixed 12:00 clock time.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, log, pinchWindow, restoreLive, sp, waitForLensUp } from "./SunpatchLeafHelpers"

function reach(api: any): { mean: number, far: number } {
  const corners: vec3[] = api.getPatchCorners()
  const w: vec3[] = api.getWindowCorners()
  const center = w[0].add(w[1]).add(w[2]).add(w[3]).uniformScale(0.25)
  const n = w[1].sub(w[0]).cross(w[3].sub(w[0])).normalize()
  let sum = 0
  let far = -1e9
  for (const c of corners) {
    const d = c.sub(center).dot(n)
    sum += d
    far = Math.max(far, d)
  }
  return { mean: sum / corners.length, far }
}

@component
export class SunpatchC4SeasonReachScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    await pinchWindow("WindowSouth")
    api.setSeason("today")
    api.setUtc("2026-11-05T12:00:00Z")

    check(api.cycleSeason() === "dec21", "first press -> Dec 21")
    check(api.getPatchState() === "lit", "Dec 21 noon lit (" + api.getPatchState() + ")")
    const dec = reach(api)
    check(api.cycleSeason() === "jun21", "second press -> Jun 21")
    check(api.getPatchState() === "lit", "Jun 21 noon lit (" + api.getPatchState() + ")")
    const jun = reach(api)
    log("into-room reach: Dec 21 centroid " + dec.mean.toFixed(1) + " cm, farthest " + dec.far.toFixed(1)
      + " cm; Jun 21 centroid " + jun.mean.toFixed(1) + " cm, farthest " + jun.far.toFixed(1) + " cm")
    check(dec.mean > jun.mean + 100, "Dec 21 patch centroid is farther from the window than Jun 21 by > 1 m")
    check(dec.far > jun.far, "Dec 21 farthest corner is farther than Jun 21's")
    restoreLive()
    log("C4 done")
  }
}

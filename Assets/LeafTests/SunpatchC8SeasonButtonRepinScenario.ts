/**
 * Done criterion 8 — the season control brings the day back to Today; pinching another window
 * moves the patch, the arc and the control to that window.
 *
 * The control (changed after the spatial design review) is three parts, Today | Dec 21 | Jun 21,
 * that show the chosen day. Part 1: south window, London 2026-11-06 12:00.
 *  - Layout: three parts, each 16 x 10 cm, 2 cm apart, centred at the window's centre height,
 *    the control's left edge 20 cm right of the window's right edge, facing into the room.
 *  - Each part is pinched with a real SIK trigger: Dec 21 -> Jun 21 -> Today. After each, the
 *    season, the chosen part and its text are checked, and the arc drops in December and rises in
 *    June (highest arc point).
 * Part 2: at 14:30 the right-hand window (faces 290 deg) is pinched with a real trigger. The patch
 * centre and the arc move (> 50 cm), every arc point is outside that window's wall, and the
 * control follows to that window (same layout rule).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import { findInteractablesByName } from "Leaf.lspkg/Interactors/InteractableUtils"
import { check, fmt, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

function arcTop(arc: any): number {
  let m = -1e9
  for (const p of arc.getArcPoints() as vec3[]) m = Math.max(m, p.y)
  return m
}

function arcMean(arc: any): vec3 {
  const pts: vec3[] = arc.getArcPoints()
  let s = vec3.zero()
  for (const p of pts) s = s.add(p)
  return s.uniformScale(1 / Math.max(1, pts.length))
}

async function pressPart(name: string): Promise<void> {
  const it = findInteractablesByName(name, undefined, true)[0]
  if (!it) throw new Error("[SunpatchLeaf] enabled Interactable not found: " + name)
  await new DefaultLeafInteractor().trigger(it)
}

/** Checks the control's layout next to the pinned window. */
function checkLayout(api: any, ctl: any, where: string): void {
  const parts = ctl.getParts()
  check(parts.length === 3, where + ": three parts")
  check(parts.map((p: any) => p.text).join("|") === "Today|Dec 21|Jun 21", where + ": texts Today | Dec 21 | Jun 21")
  for (const p of parts) {
    check(Math.abs(p.widthCm - 16) < 0.01 && Math.abs(p.heightCm - 10) < 0.01, where + ": " + p.text + " is 16 x 10 cm")
  }
  const w: vec3[] = api.getWindowCorners()
  const wc = w[0].add(w[1]).add(w[2]).add(w[3]).uniformScale(0.25)
  const right = w[1].sub(w[0]).normalize()
  const gapStep = parts[1].center.sub(parts[0].center).length - 16
  check(Math.abs(gapStep - 2) < 0.05, where + ": 2 cm between parts (" + gapStep.toFixed(2) + ")")
  const leftEdge = parts[0].center.sub(wc).dot(right) - 8
  check(Math.abs(leftEdge - (60 + 20)) < 0.5, where + ": 20 cm right of the window edge (" + (leftEdge - 60).toFixed(1) + " cm)")
  for (const p of parts) check(Math.abs(p.center.y - wc.y) < 0.5, where + ": " + p.text + " at the window's centre height")
}

@component
export class SunpatchC8SeasonButtonRepinScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    const ctl = (global as any).seasonControl
    api.setReduceMotion(false)
    await pinchWindow("WindowSouth")
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await lookAt("window")
    await waitFor(() => ctl.isShown(), 1500, "control shown")
    checkLayout(api, ctl, "south")
    const topToday = arcTop(arc)
    check(ctl.getParts()[0].chosen, "Today is chosen")

    const steps = [["SeasonDec21", "dec21", 1], ["SeasonJun21", "jun21", 2], ["SeasonToday", "today", 0]]
    const tops: number[] = []
    for (const [name, season, idx] of steps) {
      log("pinch " + name + " (real trigger)")
      await pressPart(name as string)
      await waitFor(() => api.getSeason() === season, 2000, "season " + season)
      await waitFor(() => !arc.isMorphing(), 1500, "arc settled")
      tops.push(arcTop(arc))
      const parts = ctl.getParts()
      check(parts.filter((p: any) => p.chosen).length === 1 && parts[idx as number].chosen,
        "after " + name + ": only \"" + parts[idx as number].text + "\" is chosen")
    }
    log("arc top y: today " + topToday.toFixed(1) + ", Dec 21 " + tops[0].toFixed(1) + ", Jun 21 " + tops[1].toFixed(1))
    check(tops[0] < topToday - 5, "Dec 21 arc is lower than today's")
    check(tops[1] > topToday + 20, "Jun 21 arc is higher than today's")
    check(api.getSeason() === "today", "back to Today")

    // Part 2: re-pin another window.
    api.setUtc("2026-11-06T14:30:00Z")
    await waitFor(() => api.getPatchState() === "lit", 1000, "south patch lit at 14:30")
    const southCenter = api.getPatchPolygon().reduce((a: vec3, b: vec3) => a.add(b), vec3.zero()).uniformScale(1 / api.getPatchPolygon().length)
    const southArc = arcMean(arc)
    const southCtl: vec3 = ctl.getParts()[1].center

    await pinchWindow("WindowEast")
    await lookAt("window")
    check(api.getPinnedWindowName() === "WindowEast", "right-hand window pinned")
    check(api.getPatchState() === "lit" && api.isPatchVisible(), "patch lit for the right-hand window (" + api.getPatchState() + ")")
    const poly: vec3[] = api.getPatchPolygon()
    const eastCenter = poly.reduce((a: vec3, b: vec3) => a.add(b), vec3.zero()).uniformScale(1 / poly.length)
    const eastArc = arcMean(arc)
    await waitFor(() => ctl.isShown(), 1500, "control shown at the right-hand window")
    const eastCtl: vec3 = ctl.getParts()[1].center
    log("patch centre " + fmt(southCenter) + " -> " + fmt(eastCenter) + "; arc mean " + fmt(southArc) + " -> " + fmt(eastArc)
      + "; control " + fmt(southCtl) + " -> " + fmt(eastCtl))
    check(southCenter.distance(eastCenter) > 50, "patch moved (" + southCenter.distance(eastCenter).toFixed(1) + " cm)")
    check(southArc.distance(eastArc) > 50, "arc moved (" + southArc.distance(eastArc).toFixed(1) + " cm)")

    const w: vec3[] = api.getWindowCorners()
    const wc = w[0].add(w[1]).add(w[2]).add(w[3]).uniformScale(0.25)
    const out = w[1].sub(w[0]).cross(w[3].sub(w[0])).normalize().uniformScale(-1)
    let inside = 0
    for (const p of arc.getArcPoints() as vec3[]) if (p.sub(wc).dot(out) <= 0) inside++
    check(arc.getArcPoints().length > 1 && inside === 0, "every arc point is outside the right-hand window's wall")
    check(eastCtl.distance(southCtl) > 100, "control moved to the right-hand window")
    checkLayout(api, ctl, "right-hand")
    restoreLive()
    await pinchWindow("WindowSouth")
    log("C8 done")
  }
}

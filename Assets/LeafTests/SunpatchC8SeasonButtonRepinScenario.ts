/**
 * Done criterion 8 — pressing the season button 3 times comes back to Today; pinching another
 * window moves the patch and the arc to that window.
 * Part 1: south window, London 2026-11-06 12:00. The UI Kit season button is pressed with a real
 * SIK trigger three times: Today -> Dec 21 -> Jun 21 -> Today, checking the season, the button
 * text, and that the arc drops in December and rises in June (highest arc point).
 * Part 2: at 14:30 the right-hand window (faces 290 deg) is pinched with a real trigger. The patch
 * centre and the arc move (> 50 cm), every arc point is outside that window's wall, and the
 * season button follows to that window.
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

async function pressButton(): Promise<void> {
  const it = findInteractablesByName("SeasonButton", undefined, true)[0]
  if (!it) throw new Error("[SunpatchLeaf] enabled SeasonButton Interactable not found")
  await new DefaultLeafInteractor().trigger(it)
}

@component
export class SunpatchC8SeasonButtonRepinScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    await pinchWindow("WindowSouth")
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await lookAt("window")
    const topToday = arcTop(arc)
    check(arc.getSeasonText() === "Today", "button reads Today")

    const expect = [["dec21", "Dec 21"], ["jun21", "Jun 21"], ["today", "Today"]]
    const tops: number[] = []
    for (let i = 0; i < 3; i++) {
      log("press " + (i + 1) + " (real trigger on the UI Kit button)")
      await pressButton()
      await waitFor(() => api.getSeason() === expect[i][0], 2000, "season " + expect[i][0])
      await waitFor(() => arc.getArcPoints().length > 1, 1000, "arc rebuilt")
      tops.push(arcTop(arc))
      check(arc.getSeasonText() === expect[i][1], "press " + (i + 1) + ": season " + expect[i][0] + ", button reads \"" + arc.getSeasonText() + "\"")
    }
    log("arc top y: today " + topToday.toFixed(1) + ", Dec 21 " + tops[0].toFixed(1) + ", Jun 21 " + tops[1].toFixed(1))
    check(tops[0] < topToday - 5, "Dec 21 arc is lower than today's")
    check(tops[1] > topToday + 20, "Jun 21 arc is higher than today's")
    check(api.getSeason() === "today", "three presses -> back to Today")

    // Part 2: re-pin another window.
    api.setUtc("2026-11-06T14:30:00Z")
    await waitFor(() => api.getPatchState() === "lit", 1000, "south patch lit at 14:30")
    const southCenter = api.getPatchPolygon().reduce((a: vec3, b: vec3) => a.add(b), vec3.zero()).uniformScale(1 / api.getPatchPolygon().length)
    const southArc = arcMean(arc)
    const southButton: vec3 = arc.getSeasonButtonObject().getTransform().getWorldPosition()

    await pinchWindow("WindowEast")
    await lookAt("window")
    check(api.getPinnedWindowName() === "WindowEast", "right-hand window pinned")
    check(api.getPatchState() === "lit" && api.isPatchVisible(), "patch lit for the right-hand window (" + api.getPatchState() + ")")
    const poly: vec3[] = api.getPatchPolygon()
    const eastCenter = poly.reduce((a: vec3, b: vec3) => a.add(b), vec3.zero()).uniformScale(1 / poly.length)
    const eastArc = arcMean(arc)
    const eastButton: vec3 = arc.getSeasonButtonObject().getTransform().getWorldPosition()
    log("patch centre " + fmt(southCenter) + " -> " + fmt(eastCenter) + "; arc mean " + fmt(southArc) + " -> " + fmt(eastArc)
      + "; button " + fmt(southButton) + " -> " + fmt(eastButton))
    check(southCenter.distance(eastCenter) > 50, "patch moved (" + southCenter.distance(eastCenter).toFixed(1) + " cm)")
    check(southArc.distance(eastArc) > 50, "arc moved (" + southArc.distance(eastArc).toFixed(1) + " cm)")

    const w: vec3[] = api.getWindowCorners()
    const wc = w[0].add(w[1]).add(w[2]).add(w[3]).uniformScale(0.25)
    const out = w[1].sub(w[0]).cross(w[3].sub(w[0])).normalize().uniformScale(-1)
    let inside = 0
    for (const p of arc.getArcPoints() as vec3[]) if (p.sub(wc).dot(out) <= 0) inside++
    check(arc.getArcPoints().length > 1 && inside === 0, "every arc point is outside the right-hand window's wall")
    check(eastButton.distance(wc) < 120 && eastButton.distance(southButton) > 100, "season button moved to the right-hand window")
    restoreLive()
    await pinchWindow("WindowSouth")
    log("C8 done")
  }
}

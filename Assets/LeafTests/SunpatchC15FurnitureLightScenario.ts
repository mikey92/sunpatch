/**
 * Criterion 15 (fourth pass) — light on the furniture, not under it.
 *  a. Dec 21 at noon the low sun reaches the sofa: the light on the seat top is a polygon at the
 *     seat's top height, inside the seat's rectangle, and every point lies on a ray from the window
 *     (it is the floor patch moved back along the light).
 *  b. The floor behind the seat is in its shadow: the shadow rectangle is the seat top moved down
 *     along the light to the floor.
 *  c. Jun 21 at noon the high sun stays by the window: nothing on the seat.
 *  d. Matches tools/measure_year.ts: light on the seat on Jan 21 at noon, none on Feb 21 at noon.
 *  e. With motion on, the seat light follows the drawn patch through a crossfaded day change.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { sleep } from "Leaf.lspkg/Utils/common/Utils"
import { check, fmt, log, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC15FurnitureLightScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const proj = api.projector
    api.setReduceMotion(true)
    await pinchWindow("WindowSouth")

    // a. Dec 21 noon.
    api.setSeason("dec21")
    api.setUtc("2026-11-06T12:00:00Z")
    await waitFor(() => proj.getFurniturePolygon().length >= 3, 3000, "light on the seat top on Dec 21 at noon")
    const top: number[] = proj.furnitureTopRect()
    const poly: vec3[] = proj.getFurniturePolygon()
    log("seat top y " + top[0].toFixed(2) + ", rect x " + top[1].toFixed(1) + ".." + top[2].toFixed(1) + " z " + top[3].toFixed(1) + ".." + top[4].toFixed(1) + ", polygon " + poly.map(fmt).join(" "))
    for (const p of poly) {
      check(Math.abs(p.y - top[0]) < 0.01, "point " + fmt(p) + " is at the seat top height")
      check(p.x >= top[1] - 0.01 && p.x <= top[2] + 0.01 && p.z >= top[3] - 0.01 && p.z <= top[4] + 0.01, "point " + fmt(p) + " is on the seat top")
    }
    // Each point is on a ray through the window opening: moving it along the light to the window
    // plane lands inside the window rectangle.
    const w: vec3[] = api.getWindowCorners()
    const L: vec3 = api.getPatchCorners().length === 4 ? api.getPatchCorners()[0].sub(w[0]).normalize() : new vec3(0, -1, 0)
    const wz = w[0].z
    const minX = Math.min(w[0].x, w[1].x, w[2].x, w[3].x) - 0.5
    const maxX = Math.max(w[0].x, w[1].x, w[2].x, w[3].x) + 0.5
    const minY = Math.min(w[0].y, w[1].y, w[2].y, w[3].y) - 0.5
    const maxY = Math.max(w[0].y, w[1].y, w[2].y, w[3].y) + 0.5
    for (const p of poly) {
      const k = (wz - p.z) / L.z
      const q = p.add(L.uniformScale(k))
      check(q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY, "point " + fmt(p) + " traces back through the window (" + fmt(q) + ")")
    }

    // b. The floor shadow is the seat top moved down along the light.
    const sh: number[] = proj.floorShadowRect()
    const k = (api.getPatchPlaneY() - top[0]) / L.y
    check(Math.abs(sh[0] - (top[1] + L.x * k)) < 0.05 && Math.abs(sh[2] - (top[3] + L.z * k)) < 0.05,
      "floor shadow is the seat top moved along the light (" + sh.map((v: number) => v.toFixed(1)).join(", ") + ")")

    // c. Jun 21 noon: nothing on the seat.
    api.setSeason("jun21")
    await sleep(200)
    await waitFor(() => proj.getFurniturePolygon().length === 0, 3000, "no light on the seat on Jun 21 at noon")
    check(proj.getFurniturePolygon().length === 0, "Jun 21 at noon: no light on the seat")
    // d. The year at this window (tools/measure_year.ts): the seat gets direct sun only from late
    //    November to late January. Jan 21 noon: light on the seat; Feb 21 noon: none.
    api.setSeason("today")
    api.setUtc("2027-01-21T12:00:00Z")
    await waitFor(() => proj.getFurniturePolygon().length >= 3, 3000, "light on the seat on Jan 21 at noon")
    check(proj.getFurniturePolygon().length >= 3, "Jan 21 at noon: light on the seat")
    api.setUtc("2027-02-21T12:00:00Z")
    await waitFor(() => proj.getFurniturePolygon().length === 0, 3000, "no light on the seat on Feb 21 at noon")
    check(proj.getFurniturePolygon().length === 0, "Feb 21 at noon: no light on the seat")
    // e. With motion on (the day change crossfades a big move), the seat light follows the drawn
    //    patch: after Today -> Dec 21 it is on the seat, after -> Jun 21 it is gone.
    api.setReduceMotion(false)
    api.setSeason("today")
    api.setUtc("2026-11-06T12:35:00Z")
    await sleep(1500)
    api.setSeason("dec21")
    await waitFor(() => proj.getFurniturePolygon().length >= 3, 4000, "seat light after a crossfaded day change to Dec 21")
    check(proj.getFurniturePolygon().length >= 3, "motion on, Dec 21: light on the seat")
    api.setSeason("jun21")
    await waitFor(() => proj.getFurniturePolygon().length === 0, 4000, "no seat light after the change to Jun 21")
    check(proj.getFurniturePolygon().length === 0, "motion on, Jun 21: no light on the seat")
    restoreLive()
    log("C15 done")
  }
}

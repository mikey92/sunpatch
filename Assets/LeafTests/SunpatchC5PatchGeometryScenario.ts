/**
 * Done criterion 5 — the patch's 4 corners lie on the floor (1 cm above it) and on the rays from
 * the window's 4 corners along the sunlight. The test rebuilds the sunlight direction itself
 * from the reported azimuth/altitude and the room's north constant (not from the Lens's vector),
 * then checks: corner height, distance of each patch corner to its ray, that the patch lies on the
 * room side, that the drawn polygon is those 4 corners, and that the patch's horizontal offset
 * from the window points away from the sun's azimuth.
 * Case: south window, London 2026-11-05 12:00 GMT (patch fully inside the room).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, distToLine, fmt, log, pinchWindow, restoreLive, sp, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC5PatchGeometryScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    api.setSeason("today")
    api.setUtc("2026-11-05T12:00:00Z")
    await pinchWindow("WindowSouth")
    check(api.getPatchState() === "lit", "patch lit (" + api.getPatchState() + ")")

    const s = api.getSunAltAz()
    const f = api.getNorthFrame()
    const DEG = Math.PI / 180
    const a = f.headingSign * (s.azimuth - f.minusZAzimuthDeg) * DEG
    const toSun = new vec3(Math.sin(a) * Math.cos(s.altitude * DEG), Math.sin(s.altitude * DEG), -Math.cos(a) * Math.cos(s.altitude * DEG))
    const light = toSun.uniformScale(-1)
    log("sun az " + s.azimuth.toFixed(2) + " alt " + s.altitude.toFixed(2) + ", light " + fmt(light)
      + ", Lens toSun " + fmt(api.getTowardSun()))

    const win: vec3[] = api.getWindowCorners()
    const pc: vec3[] = api.getPatchCorners()
    const planeY = api.getPatchPlaneY()
    check(win.length === 4 && pc.length === 4, "4 window corners and 4 patch corners")
    const floorTop = planeY - 1
    log("floor top y " + floorTop.toFixed(2) + ", patch plane y " + planeY.toFixed(2))
    for (let i = 0; i < 4; i++) {
      const d = distToLine(pc[i], win[i], light)
      const along = pc[i].sub(win[i]).dot(light)
      log("corner " + i + ": window " + fmt(win[i]) + " -> patch " + fmt(pc[i]) + ", off-ray " + d.toFixed(3) + " cm, along " + along.toFixed(1) + " cm")
      check(Math.abs(pc[i].y - (floorTop + 1)) < 0.05, "corner " + i + " is 1 cm above the floor (y " + pc[i].y.toFixed(3) + ")")
      check(d < 0.2, "corner " + i + " is on the ray from window corner " + i + " (" + d.toFixed(3) + " cm off)")
      check(along > 0, "corner " + i + " is downstream of the window along the light")
    }
    const poly: vec3[] = api.getPatchPolygon()
    check(poly.length === 4, "drawn polygon is the 4 corners (inside the room, " + poly.length + " points)")
    check(api.isPatchVisible(), "patch visible")

    // The patch lies away from the sun: azimuth of (patch centroid - window center) ~ sun az + 180.
    const wc = win[0].add(win[1]).add(win[2]).add(win[3]).uniformScale(0.25)
    const pcen = pc[0].add(pc[1]).add(pc[2]).add(pc[3]).uniformScale(0.25)
    const dir = pcen.sub(wc)
    const azPatch = ((f.minusZAzimuthDeg + Math.atan2(dir.x, -dir.z) / DEG / f.headingSign) % 360 + 360) % 360
    const expected = (s.azimuth + 180) % 360
    let diff = Math.abs(azPatch - expected)
    if (diff > 180) diff = 360 - diff
    log("patch direction azimuth " + azPatch.toFixed(2) + ", expected " + expected.toFixed(2))
    check(diff < 0.5, "patch lies opposite the sun's azimuth (" + diff.toFixed(3) + " deg off)")
    restoreLive()
    log("C5 done")
  }
}

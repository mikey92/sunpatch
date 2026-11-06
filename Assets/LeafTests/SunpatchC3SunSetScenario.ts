/**
 * Done criterion 3 — London, 2026-11-06 20:00 (GMT): the sun is below the horizon, so the patch
 * is hidden and the label says "Sun has set". The window is pinned with a real pinch, the patch
 * is first shown at 12:00 the same day, then the clock moves to 20:00.
 *
 * Also (review fixes):
 *  - Sunrise / sunset are the NOAA times (independent spreadsheet values for 2026-11-06 London:
 *    sunrise 07:02:42, sunset 16:24:48 GMT), within 1 minute.
 *  - The patch goes off at the shown sunset, not 110 s earlier: 30 s before it the state is
 *    "lit" (the light lands beyond the room), 1 s after it "set".
 *  - 05:00 says "Sun not up yet" with the sunrise time.
 *  - At night the sun handle is not on the arc; it waits, dimmed, at the arc's sunset end so it
 *    can still be grabbed (before this review it was hidden and the hour could not be changed).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

const SUNRISE_UTC = Date.UTC(2026, 10, 6, 7, 2, 42)
const SUNSET_UTC = Date.UTC(2026, 10, 6, 16, 24, 48)

@component
export class SunpatchC3SunSetScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    api.setReduceMotion(false)
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await pinchWindow("WindowSouth")
    check(api.isPatchVisible(), "patch shown at 12:00 (state " + api.getPatchState() + ")")
    await waitFor(() => api.getPatchAlpha() > 0.15, 2000, "patch faded in")
    await lookAt("window")
    await waitFor(() => arc.isHandleVisible() && arc.isHandleOnArc(), 2000, "sun handle on the arc at 12:00")
    check(arc.isHandleVisible() && arc.isHandleOnArc(), "sun handle on the arc at 12:00")

    const day = api.getDayInfo()
    const dr = (day.sunriseMs - SUNRISE_UTC) / 60000
    const ds = (day.sunsetMs - SUNSET_UTC) / 60000
    log("NOAA day: sunrise " + api.getSunTimes().sunrise + " (" + dr.toFixed(2) + " min off), sunset "
      + api.getSunTimes().sunset + " (" + ds.toFixed(2) + " min off)")
    check(Math.abs(dr) <= 1, "sunrise 07:02:42 GMT within 1 min (" + dr.toFixed(2) + ")")
    check(Math.abs(ds) <= 1, "sunset 16:24:48 GMT within 1 min (" + ds.toFixed(2) + ")")
    check(api.getSunTimes().sunset === "16:24" && api.getSunTimes().sunrise === "07:02", "shown as 07:02 / 16:24")

    // The patch goes off at the shown sunset.
    api.setUtc(day.sunsetMs - 30000)
    check(api.isSunUp() && api.getPatchState() === "lit", "30 s before the shown sunset: sun up, state lit (" + api.getPatchState() + ")")
    api.setUtc(day.sunsetMs + 1000)
    check(!api.isSunUp() && api.getPatchState() === "set", "1 s after the shown sunset: state set (" + api.getPatchState() + ")")

    api.setUtc("2026-11-06T20:00:00Z")
    const s = api.getSunAltAz()
    log("2026-11-06 20:00: altitude " + s.altitude.toFixed(2) + ", state " + api.getPatchState()
      + ", label \"" + api.getLabel().split("\n").join(" / ") + "\"")
    check(s.altitude < 0, "sun below the horizon (" + s.altitude.toFixed(2) + ")")
    check(api.getPatchState() === "set", "patch state 'set' (" + api.getPatchState() + ")")
    check(!api.isPatchVisible(), "patch hidden")
    await waitFor(() => api.getPatchAlpha() <= 0.001, 2000, "patch faded out")
    check(api.getLabel().indexOf("Sun has set\nSunset 16:24\n20:00 · ") === 0, "label: Sun has set / Sunset 16:24 / 20:00 · date")
    check(api.isLabelVisible(), "label visible (at the window)")
    await waitFor(() => arc.isHandleVisible(), 1000, "handle shown while looking at the window")
    check(!arc.isHandleOnArc(), "at night the handle is not on the arc")
    const pts: vec3[] = arc.getArcPoints()
    const end = pts[pts.length - 1]
    const h: vec3 = arc.getHandleWorld()
    check(h.distance(end) < 0.5, "it waits at the arc's sunset end (" + h.distance(end).toFixed(2) + " cm)")
    check(arc.getHandleOpacity() < 0.6, "dimmed (" + arc.getHandleOpacity().toFixed(2) + ")")
    check(arc.getEventText() === "Sunset 16:24", "readout says Sunset 16:24 (\"" + arc.getHandleText().replace("\n", " / ") + "\")")

    api.setTime(5, 0)
    check(api.getPatchState() === "set" && api.getLabel().indexOf("Sun not up yet\nSunrise 07:02\n05:00 · ") === 0,
      "05:00: \"" + api.getLabel().split("\n").join(" / ") + "\"")
    const first: vec3 = arc.getArcPoints()[0]
    await waitFor(() => arc.getHandleWorld().distance(first) < 0.5, 1000, "handle at the sunrise end at 05:00")
    restoreLive()
    log("C3 done")
  }
}

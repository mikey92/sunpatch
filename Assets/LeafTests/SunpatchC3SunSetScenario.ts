/**
 * Done criterion 3 — London, 2026-11-06 20:00 (GMT): the sun is below the horizon, so the patch
 * is hidden and the label says "Sun has set". The window is pinned with a real pinch, the patch
 * is first shown at 12:00 the same day, then the clock moves to 20:00.
 * The sun handle is on the arc at 12:00 (looking at the window) and hidden at 20:00.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC3SunSetScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    await pinchWindow("WindowSouth")
    check(api.isPatchVisible(), "patch shown at 12:00 (state " + api.getPatchState() + ")")
    await waitFor(() => api.getPatchAlpha() > 0.3, 2000, "patch faded in")
    await lookAt("window")
    const arc = (global as any).sunArc
    check(arc.isHandleVisible(), "sun handle on the arc at 12:00")

    api.setUtc("2026-11-06T20:00:00Z")
    const s = api.getSunAltAz()
    log("2026-11-06 20:00: altitude " + s.altitude.toFixed(2) + ", state " + api.getPatchState()
      + ", label \"" + api.getLabel().replace("\n", " / ") + "\"")
    check(s.altitude < 0, "sun below the horizon (" + s.altitude.toFixed(2) + ")")
    check(api.getPatchState() === "set", "patch state 'set' (" + api.getPatchState() + ")")
    check(!api.isPatchVisible(), "patch hidden")
    await waitFor(() => api.getPatchAlpha() <= 0.001, 2000, "patch faded out")
    check(api.getLabel().indexOf("Sun has set") === 0, "label starts with \"Sun has set\"")
    check(api.isLabelVisible(), "label visible (at the window)")
    await waitFor(() => !arc.isHandleVisible(), 1000, "sun handle hidden")
    check(!arc.isHandleVisible(), "sun handle hidden after sunset")
    restoreLive()
    log("C3 done")
  }
}

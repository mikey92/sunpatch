/**
 * Done criterion 6 — north window at noon: no patch, label "No direct sun".
 * The north-facing window (faces 345 deg) is pinned with a real pinch at London 2026-11-05 12:00.
 * Then the south window is pinched again and the patch comes back (re-pin).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, log, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC6NorthWindowScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    api.setSeason("today")
    api.setUtc("2026-11-05T12:00:00Z")
    await pinchWindow("WindowNorth")
    const s = api.getSunAltAz()
    log("north window, sun alt " + s.altitude.toFixed(2) + " az " + s.azimuth.toFixed(2)
      + ": state " + api.getPatchState() + ", label \"" + api.getLabel().replace("\n", " / ") + "\"")
    check(s.altitude > 0, "sun is up")
    check(api.getPatchState() === "noDirect", "state 'noDirect' (" + api.getPatchState() + ")")
    check(!api.isPatchVisible(), "no patch")
    await waitFor(() => api.getPatchAlpha() <= 0.001, 2000, "patch faded out")
    check(api.getLabel().indexOf("No direct sun") === 0, "label starts with \"No direct sun\"")
    check(api.isLabelVisible(), "label visible (at the window)")

    await pinchWindow("WindowSouth")
    check(api.getPatchState() === "lit" && api.isPatchVisible(), "re-pin the south window: patch back")
    restoreLive()
    log("C6 done")
  }
}

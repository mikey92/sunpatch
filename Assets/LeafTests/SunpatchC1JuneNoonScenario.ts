/**
 * Done criterion 1 — London, 2026-06-21 12:00 UTC: sun altitude ~62 deg, azimuth ~179 deg,
 * within 0.5 deg of the NOAA spreadsheet (61.927 / 178.862).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, log, restoreLive, sp, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC1JuneNoonScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    api.setSeason("today")
    api.setUtc("2026-06-21T12:00:00Z")
    const s = api.getSunAltAz()
    log("2026-06-21 12:00 UTC: altitude " + s.altitude.toFixed(3) + " (geometric " + s.geometricAltitude.toFixed(3)
      + "), azimuth " + s.azimuth.toFixed(3) + ", clock " + api.getLocalClock())
    check(Math.abs(s.geometricAltitude - 61.927) <= 0.5, "altitude within 0.5 deg of NOAA 61.927 (" + s.geometricAltitude.toFixed(3) + ")")
    check(Math.abs(s.altitude - 62) <= 0.5, "altitude ~62 deg (" + s.altitude.toFixed(3) + ")")
    check(Math.abs(s.azimuth - 178.862) <= 0.5, "azimuth within 0.5 deg of NOAA 178.862 (" + s.azimuth.toFixed(3) + ")")
    check(api.getLocalClock() === "13:00", "shown in UK summer time: 13:00 BST (" + api.getLocalClock() + ")")
    restoreLive()
    log("C1 done")
  }
}

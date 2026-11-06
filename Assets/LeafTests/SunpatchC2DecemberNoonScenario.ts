/**
 * Done criterion 2 — London, 2026-12-21 12:00 UTC: sun altitude ~15 deg
 * (NOAA spreadsheet 15.055, within 0.5 deg). Also checks the Dec 21 season button path:
 * "today" fixed at 2026-11-05 12:00 + season Dec 21 gives the same sun as 2026-12-21 12:00.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, log, restoreLive, sp, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC2DecemberNoonScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    api.setSeason("today")
    api.setUtc("2026-12-21T12:00:00Z")
    const s = api.getSunAltAz()
    log("2026-12-21 12:00 UTC: altitude " + s.altitude.toFixed(3) + " (geometric " + s.geometricAltitude.toFixed(3)
      + "), azimuth " + s.azimuth.toFixed(3))
    check(Math.abs(s.geometricAltitude - 15.055) <= 0.5, "altitude within 0.5 deg of NOAA 15.055 (" + s.geometricAltitude.toFixed(3) + ")")
    check(Math.abs(s.altitude - 15) <= 0.5, "altitude ~15 deg (" + s.altitude.toFixed(3) + ")")
    check(Math.abs(s.azimuth - 180.335) <= 0.5, "azimuth within 0.5 deg of NOAA 180.335 (" + s.azimuth.toFixed(3) + ")")

    api.setUtc("2026-11-05T12:00:00Z")
    api.setSeason("dec21")
    const d = api.getSunAltAz()
    log("season Dec 21 from 2026-11-05 12:00: altitude " + d.geometricAltitude.toFixed(3) + ", clock " + api.getLocalClock())
    check(Math.abs(d.geometricAltitude - s.geometricAltitude) < 0.01, "season Dec 21 keeps the clock and moves the date")
    restoreLive()
    log("C2 done")
  }
}

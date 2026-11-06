/**
 * Not a test — a helper for screenshots and the demo video. Pins a window with a real pinch and
 * fixes the time and season, then leaves the Lens in that state.
 * Parameters: window (scene object name), utc (ISO time, or "now" = the start rule), season (today | dec21 | jun21).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { ScenarioConfig } from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import { log, pinchWindow, sp, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchPoseScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const win = (config && config.get("window")) || "WindowSouth"
    const utc = (config && config.get("utc")) || "now"
    const season = (config && config.get("season")) || "today"
    await pinchWindow(win)
    if (utc === "now") api.useDemoDefault()
    else api.setUtc(utc)
    api.setSeason(season)
    log("pose: " + win + ", " + api.getLocalClock() + " " + season + ", state " + api.getPatchState()
      + ", label \"" + api.getLabel().replace("\n", " / ") + "\"")
  }
}

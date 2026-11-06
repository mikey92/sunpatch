/**
 * Not a test — a helper for screenshots and the demo video. Pins a window with a real pinch and
 * fixes the time and season, then leaves the Lens in that state. The gaze is the preview camera.
 * Parameters: window (scene object name, or "none" = nothing pinned, onboarding), utc (ISO time,
 * or "now" = the start rule), season (today | dec21 | jun21), hand ("none", "hover" = a real SIK
 * hover on the sun handle, "drag" = a slow real SIK drag of the sun), handMs (how long the hand
 * stays).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { ScenarioConfig } from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import { sleep } from "Leaf.lspkg/Utils/common/Utils"
import { fmt, log, pinchWindow, sp, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchPoseScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const g = (global as any).sunGaze
    if (g) g.clearGazeOverride()
    const win = (config && config.get("window")) || "WindowSouth"
    const utc = (config && config.get("utc")) || "now"
    const season = (config && config.get("season")) || "today"
    const hand = (config && config.get("hand")) || "none"
    const handMs = parseFloat((config && config.get("handMs")) || "20000")
    if (utc === "now") api.useDemoDefault()
    else api.setUtc(utc)
    api.setSeason(season)
    if (win === "none") api.unpin()
    else await pinchWindow(win)
    log("pose: " + win + ", " + api.getLocalClock() + " " + season + ", state " + api.getPatchState()
      + ", label \"" + api.getLabel().replace("\n", " / ") + "\"")
    const arc = (global as any).sunArc
    if (arc) log("pose: sun handle at " + fmt(arc.getHandleWorld()))
    if (arc && hand !== "none") {
      await sleep(800)
      const it = arc.getHandleInteractable()
      // Not awaited: the hand stays after the scenario ends.
      if (hand === "hover") new DefaultLeafInteractor().hover(it, handMs)
      else if (hand === "drag") new DefaultLeafInteractor().drag(it, new vec3(0.012, 0, 0), handMs)
      await sleep(300)
    }
  }
}

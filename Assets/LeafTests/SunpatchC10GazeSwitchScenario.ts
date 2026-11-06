/**
 * Criterion 10 — gaze decides what shows: the window -> arc + handle; the floor -> the patch
 * label; elsewhere -> neither. The light patch itself stays visible in all three.
 * South window, London 2026-11-06 12:00 (patch inside the room). Gaze is scripted through
 * GazeDisclosure's override. Each switch is checked after the fade has settled.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { check, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC10GazeSwitchScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    api.setReduceMotion(false)
    await pinchWindow("WindowSouth")
    api.setSeason("today")
    api.setUtc("2026-11-06T12:00:00Z")
    check(api.isPatchVisible() && api.getLabelPlace() === "floor", "patch lit, label belongs on the floor")

    await lookAt("window")
    await waitFor(() => arc.getArcOpacity() >= 0.999 && api.getLabelOpacity() <= 0.001, 1500, "window: arc in, label out")
    check(arc.isArcShown() && arc.isHandleVisible(), "window: arc and handle shown")
    check(!api.isLabelVisible(), "window: patch label hidden")
    check(api.isPatchVisible() && api.getPatchAlpha() > 0.3, "window: patch still visible")

    await lookAt("floor")
    await waitFor(() => arc.getArcOpacity() <= 0.001 && api.getLabelOpacity() >= 0.999, 1500, "floor: arc out, label in")
    check(!arc.isArcShown() && !arc.isHandleVisible(), "floor: arc and handle hidden")
    check(api.isLabelVisible(), "floor: patch label shown (\"" + api.getLabel().replace("\n", " / ") + "\")")
    check(api.isPatchVisible() && api.getPatchAlpha() > 0.3, "floor: patch visible")

    await lookAt("away")
    await waitFor(() => arc.getArcOpacity() <= 0.001 && api.getLabelOpacity() <= 0.001, 1500, "away: both out")
    check(!arc.isArcShown() && !api.isLabelVisible(), "elsewhere: no arc, no label")
    check(api.isPatchVisible() && api.getPatchAlpha() > 0.3, "elsewhere: patch still visible (it is the light)")

    // A window-side label ("Sun has set") shows when looking at the window.
    api.setUtc("2026-11-06T20:00:00Z")
    await lookAt("window")
    await waitFor(() => api.getLabelOpacity() >= 0.999, 1500, "window label in")
    check(api.getLabelPlace() === "window" && api.isLabelVisible(), "after sunset the window label shows for the window")
    restoreLive()
    log("C10 done")
  }
}

/**
 * Criterion 13 (review fixes) — the sun handle can always be reached and held, and the arc's
 * ends are real.
 *  a. Sun up but not in front of the window (front window, Jun 21 09:00 BST, sun in the east):
 *     the arc is drawn and the handle waits, dimmed, at the arc's nearest end; a real SIK drag
 *     from there moves the time onto the arc (the light comes in).
 *  b. Hover: with a real SIK hover the halo brightens (0.22 -> 0.45) and grows (x1.25).
 *  c. Hold: during a real drag the gaze moves to the floor (where the patch is); the arc and
 *     handle stay on every frame while held, the floor label shows too, and they are still on
 *     0.5 s after letting go; then they fade (the 1 s hold has ended).
 *  d. The arc's end is the shown sunset: a pinch ray past the end gives exactly the sunset
 *     time, the patch is off and the label says "Sun has set".
 *  e. Clipping: at 16:00 the light lands beyond the walls ("Sun lands beyond this room", no
 *     polygon); at 15:10 the drawn polygon is clipped to the room's floor (every point inside).
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import { nextFrame, sleep } from "Leaf.lspkg/Utils/common/Utils"
import { check, EYE, log, lookAt, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

@component
export class SunpatchC13HandleReachScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    const gaze = (global as any).sunGaze
    api.setReduceMotion(false)
    await pinchWindow("WindowSouth")

    // a. Off the arc in the morning.
    api.setSeason("today")
    api.setUtc("2026-06-21T08:00:00Z")
    await lookAt("window")
    log("Jun 21 " + api.getLocalClock() + ": state " + api.getPatchState() + ", label \"" + api.getLabel().split("\n").join(" / ") + "\"")
    check(api.isSunUp() && api.getPatchState() === "noDirect", "09:00 BST: sun up, no direct sun through the front window")
    await waitFor(() => arc.isArcShown() && arc.isHandleVisible() && !arc.isMorphing(), 1500, "arc and handle shown (day change settled)")
    check(!arc.isHandleOnArc(), "the handle is not on the lit arc")
    const pts: vec3[] = arc.getArcPoints()
    check(arc.getHandleWorld().distance(pts[0]) < 0.5, "it waits at the arc's morning end (" + arc.getHandleWorld().distance(pts[0]).toFixed(2) + " cm)")
    check(arc.getHandleOpacity() < 0.6, "dimmed (" + arc.getHandleOpacity().toFixed(2) + ")")
    const t0: number = api.getUtcMs()
    await new DefaultLeafInteractor().drag(arc.getHandleInteractable(), new vec3(0.8, 0, 0), 900)
    const times: number[] = arc.getArcTimes()
    log("after the drag: " + api.getLocalClock() + ", on arc " + arc.isHandleOnArc() + ", state " + api.getPatchState())
    check(api.getUtcMs() >= times[0] && api.getUtcMs() > t0, "the drag moved the time onto the arc (" + api.getLocalClock() + ")")
    check(arc.isHandleOnArc(), "handle now on the arc")

    // b. Hover.
    api.setUtc("2026-11-06T13:00:00Z")
    await lookAt("window")
    await waitFor(() => arc.isHandleVisible() && arc.isHandleOnArc(), 1500, "handle on the arc at 13:00")
    await sleep(300)
    const h0 = arc.getHalo()
    const hovering = new DefaultLeafInteractor().hover(arc.getHandleInteractable(), 700)
    await sleep(450)
    const h1 = arc.getHalo()
    await hovering
    log("halo idle " + h0.alpha.toFixed(2) + " x" + h0.scale.toFixed(2) + ", hovered " + h1.alpha.toFixed(2) + " x" + h1.scale.toFixed(2))
    check(Math.abs(h0.alpha - 0.22) < 0.02 && Math.abs(h0.scale - 1) < 0.01, "idle halo 0.22, x1")
    check(Math.abs(h1.alpha - 0.45) < 0.02 && Math.abs(h1.scale - 1.25) < 0.01, "hovered halo 0.45, x1.25")

    // c. Hold while dragging and looking at the floor.
    api.setUtc("2026-11-06T12:00:00Z")
    await lookAt("window")
    await waitFor(() => arc.isHandleVisible() && arc.getArcOpacity() > 0.99, 1500, "arc in")
    let offFrames = 0
    let labelSeen = false
    let watching = true
    const watcher = (async () => {
      while (watching) {
        if (arc.isHeld()) {
          if (!arc.isHandleVisible() || arc.getArcOpacity() < 0.99) offFrames++
          if (api.isLabelVisible()) labelSeen = true
        }
        await nextFrame()
      }
    })()
    const dragging = new DefaultLeafInteractor().drag(arc.getHandleInteractable(), new vec3(0.6, 0, 0), 1500)
    await sleep(400)
    const c: vec3[] = api.getPatchPolygon()
    let pc = vec3.zero()
    for (const p of c) pc = pc.add(p)
    gaze.setGazeOverride(EYE, pc.uniformScale(1 / c.length).sub(EYE))
    await dragging
    await sleep(500)
    const stillOn = arc.isHandleVisible() && arc.getArcOpacity() > 0.99
    watching = false
    await watcher
    log("held frames with the handle or arc off: " + offFrames + "; gaze " + gaze.getGaze())
    check(gaze.getGaze() === "floor", "gaze moved to the floor during the drag")
    check(offFrames === 0, "while held the arc and handle never faded")
    check(labelSeen, "while held, the floor label showed too")
    check(stillOn, "0.5 s after letting go they are still on")
    await waitFor(() => !arc.isHandleVisible() && arc.getArcOpacity() <= 0.001, 2000, "then they fade (hold over)")

    // d. Drag past the end of the arc: exactly the sunset.
    api.setUtc("2026-11-06T16:00:00Z")
    await lookAt("window")
    const ap: vec3[] = arc.getArcPoints()
    const end = ap[ap.length - 1]
    const past = end.add(end.sub(ap[ap.length - 4]).normalize().uniformScale(30))
    arc.dragHandleToward(EYE, past.sub(EYE).normalize())
    const day = api.getDayInfo()
    log("ray past the end -> " + api.getLocalClock() + " (sunset " + api.getSunTimes().sunset + "), state " + api.getPatchState())
    check(Math.abs(api.getUtcMs() - day.sunsetMs) < 1, "the arc's end is the sunset instant")
    check(api.getPatchState() === "set" && api.getLabel().indexOf("Sun has set") === 0, "patch off, \"Sun has set\"")

    // e. Clipping.
    api.setUtc("2026-11-06T16:00:00Z")
    check(api.getPatchState() === "lit" && api.getPatchPolygon().length === 0, "16:00: lit but none of it inside the room")
    check(api.getLabel().indexOf("Sun lands beyond this room\n16:00 · ") === 0, "label \"" + api.getLabel().split("\n").join(" / ") + "\"")
    api.setUtc("2026-11-06T15:10:00Z")
    const poly: vec3[] = api.getPatchPolygon()
    const corners: vec3[] = api.getPatchCorners()
    const room = [-250, 250, -350, 200]
    let outside = 0
    for (const p of corners) if (p.x < room[0] - 0.01 || p.x > room[1] + 0.01 || p.z < room[2] - 0.01 || p.z > room[3] + 0.01) outside++
    let bad = 0
    for (const p of poly) if (p.x < room[0] - 0.01 || p.x > room[1] + 0.01 || p.z < room[2] - 0.01 || p.z > room[3] + 0.01) bad++
    log("15:10: " + outside + " of 4 corners beyond the walls, drawn polygon " + poly.length + " points")
    check(outside > 0 && poly.length >= 3, "15:10: part of the light falls beyond the walls and the rest is drawn")
    check(bad === 0, "every drawn point is on the room's floor")
    restoreLive()
    log("C13 done")
  }
}

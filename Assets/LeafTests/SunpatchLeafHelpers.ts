/**
 * SunpatchLeafHelpers — shared helpers for the Sunpatch LEAF scenarios.
 *
 * Reads Lens state through the test API published by SunpatchMain on global.sunpatch and pins
 * windows through LEAF's scripted SIK interactor (a real Interactable trigger, the same path as a
 * pinch). Test-only: never changes the Lens's behavior scripts.
 *
 * Reference values come from an independent implementation of the NOAA Solar Calculator
 * spreadsheet (London 51.5074 N, 0.1278 W), geometric altitude.
 */
import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import { findInteractablesByName } from "Leaf.lspkg/Interactors/InteractableUtils"
import { sleep } from "Leaf.lspkg/Utils/common/Utils"

export const TAG = "[SunpatchLeaf]"

export function log(msg: string): void {
  print(TAG + " " + msg)
}

/** Throws with the measured values so the LEAF FAILED line is self-explanatory. */
export function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(TAG + " CHECK FAILED: " + msg)
  log("ok: " + msg)
}

export function sp(): any {
  const api = (global as any).sunpatch
  if (!api) throw new Error(TAG + " global.sunpatch is missing (SunpatchMain not initialized)")
  return api
}

export async function waitFor(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = getTime()
  while (!pred()) {
    if ((getTime() - start) * 1000 > timeoutMs) throw new Error(TAG + " timed out after " + timeoutMs + " ms waiting for: " + what)
    await sleep(33)
  }
}

export async function waitForLensUp(): Promise<void> {
  await sleep(500)
  await waitFor(() => !!(global as any).sunpatch, 5000, "global.sunpatch")
}

export function fmt(v: vec3): string {
  return "(" + v.x.toFixed(2) + ", " + v.y.toFixed(2) + ", " + v.z.toFixed(2) + ")"
}

/** Real SIK trigger on a window's Interactable (the pinch), then waits until it is pinned. */
export async function pinchWindow(name: string): Promise<void> {
  const it = findInteractablesByName(name, undefined, true)[0]
  if (!it) throw new Error(TAG + " enabled Interactable not found: " + name)
  log("real trigger " + name + " (pinch the window)")
  await new DefaultLeafInteractor().trigger(it)
  await waitFor(() => sp().getPinnedWindowName() === name, 2000, name + " pinned")
}

/** Leaves the Lens on its start rule (real time, or 15:10 today if the sun is down) and clears test overrides. */
export function restoreLive(): void {
  const api = sp()
  api.setReduceMotion(false)
  api.useDemoDefault()
  const g = (global as any).sunGaze
  if (g) g.clearGazeOverride()
}

/** Distance from point p to the line through a with unit direction d. */
export function distToLine(p: vec3, a: vec3, d: vec3): number {
  const ap = p.sub(a)
  return ap.sub(d.uniformScale(ap.dot(d))).length
}

/** Horizontal (x/z) distance between two points. */
export function horizDist(a: vec3, b: vec3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

/** Standing point used for scripted gaze (the start position, eyes at the camera origin). */
export const EYE = new vec3(0, 0, 0)

/**
 * Points the gaze (GazeDisclosure override) at the pinned window, at the floor (the patch if lit,
 * else 1.5 m ahead), or away (back over the shoulder, upward), then waits past the dwell.
 */
export async function lookAt(kind: "window" | "floor" | "away", settleMs: number = 350): Promise<void> {
  const g = (global as any).sunGaze
  if (!g) throw new Error(TAG + " global.sunGaze is missing (GazeDisclosure not initialized)")
  const api = sp()
  const w: vec3[] = api.getWindowCorners()
  const wc = w.length === 4 ? w[0].add(w[1]).add(w[2]).add(w[3]).uniformScale(0.25) : new vec3(0, -60, -350)
  let target: vec3
  if (kind === "window") {
    target = wc
  } else if (kind === "floor") {
    const c: vec3[] = api.getPatchPolygon()
    if (c.length >= 3) {
      let s = vec3.zero()
      for (const p of c) s = s.add(p)
      target = s.uniformScale(1 / c.length)
    } else {
      const ahead = new vec3(wc.x - EYE.x, 0, wc.z - EYE.z).normalize().uniformScale(150)
      target = new vec3(EYE.x + ahead.x, api.getPatchPlaneY(), EYE.z + ahead.z)
    }
  } else {
    const back = new vec3(EYE.x - wc.x, 0, EYE.z - wc.z).normalize()
    target = EYE.add(back.uniformScale(100)).add(new vec3(0, 60, 0))
  }
  g.setGazeOverride(EYE, target.sub(EYE))
  await sleep(settleMs)
  if (g.getGaze() !== (kind === "away" ? "none" : kind)) {
    throw new Error(TAG + " gaze did not switch to " + kind + " (is " + g.getGaze() + ")")
  }
}

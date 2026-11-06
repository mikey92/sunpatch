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

/** Leaves the Lens on today's real time with no fixed instant (end of each scenario). */
export function restoreLive(): void {
  const api = sp()
  api.setSeason("today")
  api.useNow()
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

/**
 * SpotSun — stand where the chair would go and look down: a ring of 12 months on the floor shows
 * which months that spot gets direct sun through the pinned window, and one line says when.
 *
 * The body is the input: the spot is where your gaze meets the floor near your feet (within reachCm
 * of your head, so you have to look down, not across the room). Nothing to pinch or drag. The spot
 * snaps to a 10 cm grid so the ring holds still while your head moves a little.
 *
 * Geometry (no simulation, same as the patch): for the 21st of each month and every 10 minutes of
 * the UK day, the ray from your spot toward the sun must leave the room through the window's
 * opening (and not be blocked by the sofa's seat). The sun comes from SunpatchMain.towardSunAt
 * (NOAA). tools/measure_year.ts does the same for the sofa seat over a whole year.
 *
 * Ring: Jan at the far side (toward the window), then clockwise seen from above. Lit months gold,
 * others faint. Label: "Sun here: Nov–Jan" / "10:30–14:00", or "No direct sun here".
 *
 * Test API (global.spotSun): setSpotOverride(x, z), clearSpotOverride, getResult, isShown,
 * getLabelText, computeAt(x, z), spotFromGaze(eye, dir).
 */
import { SunpatchMain } from "./SunpatchMain"
import { ukOffsetMinutes } from "./SolarPosition"
import { Fader, MotionMs } from "./SunpatchMotion"

const MS_MIN = 60000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export interface SpotResult {
  /** Spot on the floor (world). */
  spot: vec3
  /** Direct sun on the 21st of each month (Jan..Dec). */
  months: boolean[]
  /** First and last lit minute of the day (UK clock), per month; -1 if none. */
  from: number[]
  to: number[]
  label: string
}

@component
export class SpotSun extends BaseScriptComponent {
  @input
  main: SunpatchMain

  @input
  @hint("The device camera: where you stand and where you look.")
  cameraObject: SceneObject

  @input
  @hint("Ring radius (cm).")
  radiusCm: number = 30

  @input
  @hint("Show the ring only where the gaze meets the floor this close to your head (cm, level).")
  reachCm: number = 90

  private litObj: SceneObject
  private dimObj: SceneObject
  private litRmv: RenderMeshVisual
  private dimRmv: RenderMeshVisual
  private litMat: Material
  private dimMat: Material
  private litMb: MeshBuilder
  private dimMb: MeshBuilder
  private labelObj: SceneObject
  private label: Text
  private labelBase: vec4
  private labelBg: vec4
  private ticks: Text[] = []
  private tickObjs: SceneObject[] = []
  private fade = new Fader(0)
  private result: SpotResult | null = null
  private override: vec3 | null = null
  private lastKey = ""
  private shown = false

  onAwake(): void {
    if (!this.main || !this.cameraObject) {
      print("SpotSun: main and cameraObject inputs are required.")
      return
    }
    const base = this.main.projector.patchMaterial
    this.litMat = base.clone()
    this.litMat.mainPass.baseColor = new vec4(1, 0.86, 0.5, 0.95)
    this.dimMat = base.clone()
    this.dimMat.mainPass.baseColor = new vec4(1, 1, 1, 0.2)
    this.litObj = global.scene.createSceneObject("SpotSunLit")
    this.dimObj = global.scene.createSceneObject("SpotSunDim")
    this.litRmv = this.litObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.dimRmv = this.dimObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.litRmv.mainMaterial = this.litMat
    this.dimRmv.mainMaterial = this.dimMat
    this.litRmv.setRenderOrder(12)
    this.dimRmv.setRenderOrder(12)
    this.litMb = newBuilder()
    this.dimMb = newBuilder()
    this.labelObj = global.scene.createSceneObject("SpotSunLabel")
    this.label = this.labelObj.copyComponent(this.main.label) as Text
    this.labelObj.getTransform().setLocalScale(this.main.label.getSceneObject().getTransform().getLocalScale().uniformScale(0.8))
    this.labelBase = this.label.textFill.color
    this.labelBg = this.label.backgroundSettings.fill.color
    // Small month names at the quarters of the ring: Jan, Apr, Jul, Oct.
    const baseScale = this.main.label.getSceneObject().getTransform().getLocalScale()
    for (const name of ["Jan", "Apr", "Jul", "Oct"]) {
      const o = global.scene.createSceneObject("SpotSunTick" + name)
      const t = o.copyComponent(this.main.label) as Text
      t.text = name
      t.backgroundSettings.enabled = false
      o.getTransform().setLocalScale(baseScale.uniformScale(0.55))
      this.ticks.push(t)
      this.tickObjs.push(o)
    }
    this.setShown(0)
    ;(global as any).spotSun = this
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ── test API ──
  setSpotOverride(x: number, z: number): void { this.override = new vec3(x, 0, z); this.lastKey = "" }
  clearSpotOverride(): void { this.override = null; this.lastKey = "" }
  getResult(): SpotResult | null { return this.result }
  isShown(): boolean { return this.shown }
  getLabelText(): string { return this.label ? this.label.text : "" }

  /** Direct sun at a floor spot through the pinned window, month by month (21st, every 10 min). */
  computeAt(x: number, z: number): SpotResult | null {
    const w = this.main.getPinnedWindow()
    if (!w) return null
    const g = w.getGeometry()
    const proj = this.main.projector
    const y = proj.getPatchPlaneY()
    const p = new vec3(x, y, z)
    const top = proj.furnitureTopRect()
    const year = new Date(this.main.getUtcMs()).getUTCFullYear()
    const months: boolean[] = []
    const from: number[] = []
    const to: number[] = []
    for (let m = 0; m < 12; m++) {
      let first = -1
      let last = -1
      for (let t = 5 * 60; t <= 21 * 60; t += 10) {
        const local = Date.UTC(year, m, 21, Math.floor(t / 60), t % 60)
        const utc = local - ukOffsetMinutes(local - 60 * MS_MIN) * MS_MIN
        const s = this.main.towardSunAt(utc)
        if (s.altitude <= 0) continue
        if (lit(p, s.dir, g, top)) {
          if (first < 0) first = t
          last = t
        }
      }
      months.push(first >= 0)
      from.push(first)
      to.push(last)
    }
    return { spot: p, months, from, to, label: describe(months, from, to) }
  }

  /** The floor spot you are looking down at, near your feet; null when looking elsewhere. */
  private feet(): vec3 | null {
    const y = this.main.projector.getPatchPlaneY()
    if (this.override) return new vec3(this.override.x, y, this.override.z)
    const t = this.cameraObject.getTransform()
    return this.spotFromGaze(t.getWorldPosition(), t.getWorldRotation().multiplyVec3(new vec3(0, 0, -1)))
  }

  /** Where a gaze from c along fwd meets the floor, if that is within reachCm of c (else null). */
  spotFromGaze(c: vec3, fwd: vec3): vec3 | null {
    const y = this.main.projector.getPatchPlaneY()
    fwd = fwd.normalize()
    if (fwd.y > -0.2) return null
    const k = (y - c.y) / fwd.y
    if (k <= 0) return null
    const hx = c.x + fwd.x * k, hz = c.z + fwd.z * k
    if (Math.sqrt((hx - c.x) * (hx - c.x) + (hz - c.z) * (hz - c.z)) > this.reachCm) return null
    const r = this.main.projector.floorRect()
    if (hx < r[0] || hx > r[1] || hz < r[2] || hz > r[3]) return null
    return new vec3(Math.round(hx / 10) * 10, y, Math.round(hz / 10) * 10)
  }

  private onUpdate(): void {
    if (!this.litObj) return
    const f = this.feet()
    const w = this.main.getPinnedWindow()
    const want = !!(f && w)
    if (f && w) {
      // Recompute when the spot moved (10 cm grid), or the window or the year changed.
      const key = w.getGeometry().name + "|" + f.x.toFixed(1) + "|" + f.z.toFixed(1) + "|" + new Date(this.main.getUtcMs()).getUTCFullYear()
      if (key !== this.lastKey) {
        this.lastKey = key
        this.result = this.computeAt(f.x, f.z)
        if (this.result) {
          this.buildRing(f, w.getGeometry().intoRoom)
          this.label.text = this.result.label
        }
      }
    }
    this.fade.set(want ? 1 : 0, MotionMs.gazeIn, MotionMs.gazeOut)
    this.fade.step()
    this.setShown(this.fade.value)
    if (this.fade.value > 0.001 && f && this.result) this.placeLabel(f, w ? w.getGeometry().intoRoom : new vec3(0, 0, 1))
  }

  private setShown(a: number): void {
    this.shown = a > 0.5
    const on = a > 0.001
    this.litObj.enabled = on
    this.dimObj.enabled = on
    this.labelObj.enabled = on
    for (const o of this.tickObjs) o.enabled = on
    for (const t of this.ticks) t.textFill.color = new vec4(this.labelBase.x, this.labelBase.y, this.labelBase.z, this.labelBase.w * 0.85 * a)
    this.litMat.mainPass.baseColor = new vec4(1, 0.86, 0.5, 0.95 * a)
    this.dimMat.mainPass.baseColor = new vec4(1, 1, 1, 0.2 * a)
    const b = this.labelBase
    this.label.textFill.color = new vec4(b.x, b.y, b.z, b.w * a)
    const bg = this.labelBg
    this.label.backgroundSettings.fill.color = new vec4(bg.x, bg.y, bg.z, bg.w * a)
  }

  /** 12 arc segments around the spot, Jan toward the window, clockwise seen from above. */
  private buildRing(c: vec3, intoRoom: vec3): void {
    const r = this.result!
    const toWindow = new vec3(-intoRoom.x, 0, -intoRoom.z).normalize()
    const a0 = Math.atan2(toWindow.x, toWindow.z)
    const lit: number[] = [], litIdx: number[] = [], dim: number[] = [], dimIdx: number[] = []
    const inner = this.radiusCm - 4
    const outer = this.radiusCm + 4
    const y = c.y + 0.5
    for (let m = 0; m < 12; m++) {
      const verts = r.months[m] ? lit : dim
      const idx = r.months[m] ? litIdx : dimIdx
      const s0 = a0 - (m * 30 + 2) * Math.PI / 180
      const s1 = a0 - (m * 30 + 28) * Math.PI / 180
      const steps = 6
      const base = verts.length / 8
      for (let k = 0; k <= steps; k++) {
        const a = s0 + (s1 - s0) * k / steps
        const dx = Math.sin(a), dz = Math.cos(a)
        verts.push(c.x + dx * inner, y, c.z + dz * inner, 0, 1, 0, 0.5, 0.5)
        verts.push(c.x + dx * outer, y, c.z + dz * outer, 0, 1, 0, 0.5, 0.5)
      }
      for (let k = 0; k < steps; k++) {
        const i = base + k * 2
        idx.push(i, i + 1, i + 3, i, i + 3, i + 2)
      }
    }
    fill(this.litMb, this.litRmv, lit, litIdx)
    fill(this.dimMb, this.dimRmv, dim, dimIdx)
  }

  /** The line of text in the middle of the ring; the quarter names just outside it. */
  private placeLabel(c: vec3, intoRoom: vec3): void {
    this.faceEye(this.labelObj, c.add(new vec3(0, 2, 0)))
    const toWindow = new vec3(-intoRoom.x, 0, -intoRoom.z).normalize()
    const a0 = Math.atan2(toWindow.x, toWindow.z)
    for (let i = 0; i < 4; i++) {
      const a = a0 - (i * 90 + 15) * Math.PI / 180
      const r = this.radiusCm + 12
      this.faceEye(this.tickObjs[i], new vec3(c.x + Math.sin(a) * r, c.y + 1, c.z + Math.cos(a) * r))
    }
  }

  /** Puts a text at pos, upright on screen (turned as the eye is turned). */
  private faceEye(o: SceneObject, pos: vec3): void {
    const t = o.getTransform()
    t.setWorldPosition(pos)
    t.setWorldRotation(this.cameraObject.getTransform().getWorldRotation())
  }

}

/** Does sunlight reach floor point p through the window (and past the seat)? */
export function lit(p: vec3, toSun: vec3, g: any, top: number[] | null): boolean {
  const n: vec3 = g.intoRoom
  const dn = toSun.dot(n)
  if (dn >= -1e-4) return false // sun behind the window wall
  const t = g.center.sub(p).dot(n) / dn
  if (t <= 0) return false
  const q = p.add(toSun.uniformScale(t))
  const u = q.sub(g.center).dot(g.right)
  const v = q.sub(g.center).dot(g.up)
  if (Math.abs(u) > g.widthCm / 2 || Math.abs(v) > g.heightCm / 2) return false
  // The sofa as a box from the floor up to its seat top: the ray to the window must not pass through it.
  if (top && hitsBox(p, toSun, t, top[1], top[2], p.y - 1, top[0], top[3], top[4])) return false
  return true
}

/** Does the segment p + d*s, 0 < s < len, pass through the axis-aligned box? (slab test) */
function hitsBox(p: vec3, d: vec3, len: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): boolean {
  let lo = 1e-3, hi = len
  const axis = (o: number, v: number, a: number, b: number): boolean => {
    if (Math.abs(v) < 1e-9) return o >= a && o <= b
    let t0 = (a - o) / v, t1 = (b - o) / v
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp }
    lo = Math.max(lo, t0); hi = Math.min(hi, t1)
    return lo <= hi
  }
  return axis(p.x, d.x, x0, x1) && axis(p.y, d.y, y0, y1) && axis(p.z, d.z, z0, z1)
}

/** "Sun here: Nov–Jan\n10:30–14:00", or "No direct sun here". */
export function describe(months: boolean[], from: number[], to: number[]): string {
  const n = months.filter((m) => m).length
  if (n === 0) return "No direct sun here"
  const hhmm = (x: number) => (x < 600 ? "0" : "") + Math.floor(x / 60) + ":" + (x % 60 < 10 ? "0" : "") + (x % 60)
  let lo = 24 * 60, hi = -1
  for (let m = 0; m < 12; m++) if (months[m]) { lo = Math.min(lo, from[m]); hi = Math.max(hi, to[m]) }
  let span: string
  if (n === 12) {
    span = "all year"
  } else {
    // Contiguous runs, wrapping Dec -> Jan: start right after an unlit month.
    const off = months.indexOf(false)
    const runs: string[] = []
    let runStart = -1
    for (let k = 1; k <= 12; k++) {
      const m = (off + k) % 12
      if (months[m] && runStart < 0) runStart = m
      const endHere = months[m] && !months[(m + 1) % 12]
      if (endHere) {
        runs.push(runStart === m ? MONTHS[m] : MONTHS[runStart] + "–" + MONTHS[m])
        runStart = -1
      }
    }
    span = runs.join(", ")
  }
  return "Sun here: " + span + "\n" + hhmm(lo) + "–" + hhmm(hi + 10)
}

function newBuilder(): MeshBuilder {
  const mb = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "normal", components: 3, normalized: true },
    { name: "texture0", components: 2 },
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  return mb
}

function fill(mb: MeshBuilder, rmv: RenderMeshVisual, verts: number[], idx: number[]): void {
  const nv = mb.getVerticesCount()
  if (nv > 0) mb.eraseVertices(0, nv)
  const ni = mb.getIndicesCount()
  if (ni > 0) mb.eraseIndices(0, ni)
  if (verts.length === 0) { rmv.enabled = false; return }
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  if (mb.isValid()) mb.updateMesh()
  if (rmv.mesh === null || rmv.mesh === undefined) rmv.mesh = mb.getMesh()
  rmv.enabled = true
}

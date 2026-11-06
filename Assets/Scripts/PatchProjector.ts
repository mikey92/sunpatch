/**
 * PatchProjector — draws where sunlight through the pinned window lands on the floor.
 *
 * Geometry (no simulation): each of the window's 4 corners is pushed along the light's travel
 * direction until it meets the floor plane; the 4 floor points are the patch. The patch is then
 * clipped to the room's floor rectangle (the light that would land beyond the walls is dropped;
 * patches on walls are out of scope) and drawn 1 cm above the floor.
 *
 * Look (like real light, calm):
 *   - Colour follows the sun's altitude: near white above 40 deg, pale gold at 15 deg, warm
 *     amber at 5 deg and below (interpolated).
 *   - Opacity follows floor illuminance (~ sin altitude): 0.16 + 0.22 sin(alt)^0.6 (0.22 at 9 deg,
 *     0.36 at 62 deg), times a smooth ramp to 0.15 below 6 deg. A long winter patch is dimmer.
 *   - The soft border is the real penumbra: 0.0093 x the distance from the window to the floor
 *     point (the sun is 0.53 deg wide), 2.5-6 cm, centred on the true outline; inside is even.
 *   - Four faint rays from the window corners to the patch corners show only while the sun is
 *     dragged and for 2 s after a change; they stop at the room's walls.
 *
 * Motion (SunpatchMotion):
 *   - Pin: rays in (150 ms), then the patch grows from its window-side edge to its far edge
 *     (400 ms ease-out, after 80 ms) while it fades in (250 ms).
 *   - Drag / clock change: each corner follows on a critically damped spring (no overshoot).
 *   - Season: a 500 ms ease-in-out move; if a corner would travel 150 cm or more, a crossfade
 *     instead (out 200 ms where it was, in 250 ms where it goes) — a large bright area never sweeps
 *     across the room fast.
 *   - Sunset / no direct sun / beyond the room: rays out (200 ms), patch out (350 ms ease-in) in
 *     place; coming back: 250 ms in place.
 *   With reduce motion everything is at its end value in the same frame.
 *
 * States:
 *   "none"     no window pinned
 *   "set"      the sun is down (before sunrise or after sunset, NOAA times)
 *   "noDirect" sun is up but behind the window's wall (e.g. a north window at noon)
 *   "lit"      patch computed (drawn if any of it is inside the room)
 *
 * Test-facing values (getLast, isVisible) are the target geometry, updated at once; only the drawn
 * mesh moves.
 */
import { WindowGeometry } from "./WindowPin"
import { easeIn, easeInOut, easeOut, Fader, isReduceMotion, MotionMs, motionNow, sec, smoothstep, springStep } from "./SunpatchMotion"

/** Fraction of the soft-patch texture (from each edge) over which it fades in. */
const TEX_FEATHER = 0.14
const DEG = Math.PI / 180

export type PatchState = "none" | "set" | "noDirect" | "lit"

/** Why the patch is being recomputed (chooses the motion). */
export type PatchCause = "pin" | "season" | "time" | "drag" | "tick"

export interface PatchResult {
  state: PatchState
  /** The 4 window corners projected to the patch plane (unclipped), world. Empty unless lit. */
  corners: vec3[]
  /** Clipped polygon actually drawn, world. Empty unless lit and inside the room. */
  polygon: vec3[]
  /** Centroid of the drawn polygon (or of the corners if fully clipped), world. */
  center: vec3
}

/** Light colour for a sun altitude (deg). */
export function lightColor(altDeg: number): vec3 {
  const stops: [number, vec3][] = [[5, new vec3(1, 0.76, 0.48)], [15, new vec3(1, 0.9, 0.72)], [40, new vec3(1, 0.97, 0.9)]]
  if (altDeg <= stops[0][0]) return stops[0][1]
  for (let i = 0; i + 1 < stops.length; i++) {
    const [a0, c0] = stops[i]
    const [a1, c1] = stops[i + 1]
    if (altDeg <= a1) {
      const t = (altDeg - a0) / (a1 - a0)
      return c0.add(c1.sub(c0).uniformScale(t))
    }
  }
  return stops[stops.length - 1][1]
}

@component
export class PatchProjector extends BaseScriptComponent {
  @input
  @hint("Floor box: its top face is the floor plane, its x/z extent the room.")
  floor: SceneObject

  @input
  @hint("Translucent material for the patch (its texture is the soft edge).")
  patchMaterial: Material

  @input
  @hint("Height of the patch above the floor (cm).")
  liftCm: number = 1

  @input
  @hint("Below this sun altitude (deg) the patch eases toward the horizon.")
  fadeBelowDeg: number = 6

  @input
  @hint("Penumbra per cm of distance from the window (the sun's angular size, 0.53 deg).")
  penumbraPerCm: number = 0.0093

  @input
  @hint("Soft border limits (cm).")
  featherMinCm: number = 2.5

  @input
  featherMaxCm: number = 6

  @input
  @allowUndefined
  @hint("Optional: very faint material for the 4 rays window -> patch.")
  rayMaterial: Material

  @input
  @hint("Width of each ray line (cm).")
  rayWidthCm: number = 0.8

  @input
  @hint("Ray opacity while shown.")
  rayAlpha: number = 0.12

  private patchObj: SceneObject
  private rmv: RenderMeshVisual
  private mat: Material
  private patchMb: MeshBuilder
  private last: PatchResult = { state: "none", corners: [], polygon: [], center: vec3.zero() }
  private win: WindowGeometry | null = null

  // Motion state.
  private target: vec3[] = []
  private pos: vec3[] = []
  private vel: vec3[] = []
  private grow = new Fader(1)
  private vis = new Fader(0)
  private glideFrom: vec3[] = []
  private glideT0: number = -1
  private glideDur: number = 0
  private crossPending: boolean = false
  private level: number = 0
  private levelTarget: number = 0
  private levelFrom: number = 0
  private color: vec3 = new vec3(1, 0.9, 0.72)
  private colorTarget: vec3 = new vec3(1, 0.9, 0.72)
  private colorFrom: vec3 = new vec3(1, 0.9, 0.72)
  private featherCm: number = 4
  private dirty: boolean = false
  private dragging: boolean = false

  private rayObj: SceneObject | null = null
  private rayRmv: RenderMeshVisual | null = null
  private rayMat: Material | null = null
  private rayMb: MeshBuilder | null = null
  private rayBase: vec4 = new vec4(1, 0.86, 0.55, 0.12)
  private rays = new Fader(0)
  private raysUntil: number = -1

  onAwake(): void {
    if (!this.floor || !this.patchMaterial) {
      print("PatchProjector: floor and patchMaterial inputs are required.")
      return
    }
    this.patchObj = global.scene.createSceneObject("SunPatch")
    this.rmv = this.patchObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.mat = this.patchMaterial.clone()
    this.rmv.mainMaterial = this.mat
    this.rmv.setRenderOrder(10)
    this.patchMb = newBuilder()
    this.patchObj.enabled = false
    if (this.rayMaterial) {
      this.rayObj = global.scene.createSceneObject("SunRays")
      this.rayRmv = this.rayObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      this.rayMat = this.rayMaterial.clone()
      this.rayBase = this.rayMat.mainPass.baseColor
      this.rayRmv.mainMaterial = this.rayMat
      this.rayRmv.setRenderOrder(11)
      this.rayMb = newBuilder()
      this.rayObj.enabled = false
    }
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** World y of the patch plane (floor top + lift). */
  getPatchPlaneY(): number {
    return this.floorTopY() + this.liftCm
  }

  floorTopY(): number {
    const t = this.floor.getTransform()
    return t.getWorldPosition().y + t.getWorldScale().y / 2
  }

  /** Room floor rectangle in world x/z: [minX, maxX, minZ, maxZ]. */
  floorRect(): number[] {
    const t = this.floor.getTransform()
    const p = t.getWorldPosition()
    const s = t.getWorldScale()
    return [p.x - s.x / 2, p.x + s.x / 2, p.z - s.z / 2, p.z + s.z / 2]
  }

  getLast(): PatchResult {
    return this.last
  }

  isVisible(): boolean {
    return this.last.state === "lit" && this.last.polygon.length >= 3
  }

  /** Current drawn opacity. */
  getAlpha(): number {
    return this.vis.value * this.level
  }

  /** Opacity the patch is going toward. */
  getTargetAlpha(): number {
    return this.vis.target * this.levelTarget
  }

  /** Light colour the patch is drawn with. */
  getColor(): vec3 {
    return this.color
  }

  /** Soft border width now (cm). */
  getFeatherCm(): number {
    return this.featherCm
  }

  /** The 4 corners as currently drawn. */
  getDrawnCorners(): vec3[] {
    return this.displayed()
  }

  /** Centre of the drawn patch inside the room (the label follows it), or the target centre. */
  getDrawnCenter(): vec3 {
    const d = this.displayed()
    if (d.length !== 4) return this.last.center
    const r = this.floorRect()
    const poly = clipToRect(d, r[0], r[1], r[2], r[3])
    if (poly.length < 3) return this.last.center
    let s = vec3.zero()
    for (const p of poly) s = s.add(p)
    return s.uniformScale(1 / poly.length)
  }

  /** Largest distance (cm) between a drawn corner and its target. 0 when settled. */
  getGlideError(): number {
    const d = this.displayed()
    if (d.length !== 4 || this.target.length !== 4) return 0
    let m = 0
    for (let i = 0; i < 4; i++) m = Math.max(m, d[i].distance(this.target[i]))
    return m
  }

  /** Whether the 4 rays are drawn. */
  areRaysVisible(): boolean {
    return !!this.rayObj && this.rayObj.enabled
  }

  /** Ray opacity now (0..rayAlpha). */
  getRayOpacity(): number {
    return this.rayAlpha * this.rays.value * this.vis.value
  }

  /** Set by SunArcUI through SunpatchMain: rays stay while the sun is held. */
  setDragging(on: boolean): void {
    if (this.dragging && !on) this.raysUntil = motionNow() + sec(MotionMs.raysHold)
    this.dragging = on
  }

  /** Pure check: would this window throw light inside the room for this sun (start rule)? */
  wouldLight(win: WindowGeometry, towardSun: vec3, altitudeDeg: number): boolean {
    const r = this.compute(win, towardSun, altitudeDeg, true)
    return r.state === "lit" && r.polygon.length >= 3
  }

  /**
   * Recomputes the patch for a window and a sun direction (unit vector toward the sun) and
   * returns the result. Pass null to clear. `sunUp` comes from the NOAA sunrise/sunset times, so
   * the patch goes off at the shown sunset time.
   */
  project(win: WindowGeometry | null, towardSun: vec3, altitudeDeg: number, sunUp: boolean = altitudeDeg > 0,
    cause: PatchCause = "time"): PatchResult {
    const r = win ? this.compute(win, towardSun, altitudeDeg, sunUp) : { state: "none" as PatchState, corners: [], polygon: [], center: vec3.zero() }
    const wasVisible = this.vis.target > 0
    const prevWin = this.win ? this.win.name : ""
    this.last = r
    this.win = win
    if (cause === "pin" || cause === "season" || cause === "time") this.showRays()

    if (this.isVisible()) {
      const alt = Math.max(0, altitudeDeg)
      const level = (0.16 + 0.22 * Math.pow(Math.sin(alt * DEG), 0.6)) * (0.15 + 0.85 * smoothstep(0, this.fadeBelowDeg, alt))
      const color = lightColor(alt)
      let dist = 0
      for (let i = 0; i < 4; i++) dist += win!.corners[i].distance(r.corners[i])
      this.featherCm = Math.max(this.featherMinCm, Math.min(this.featherMaxCm, this.penumbraPerCm * dist / 4))
      const fresh = !wasVisible || this.pos.length !== 4 || this.vis.value <= 0.001 || (cause === "pin" && prevWin !== win!.name)
      if (fresh) {
        // Appearing: in place; after a pin it grows from the window-side edge.
        this.pos = r.corners.slice()
        this.vel = [vec3.zero(), vec3.zero(), vec3.zero(), vec3.zero()]
        this.glideT0 = -1
        this.crossPending = false
        this.level = level
        this.color = color
        if (cause === "pin") {
          this.grow.jump(0)
          this.grow.start(1, MotionMs.patchGrow, easeOut, MotionMs.patchDelay)
          this.vis.jump(0)
          this.vis.start(1, MotionMs.patchFadeIn, easeOut, MotionMs.patchDelay)
        } else {
          this.grow.jump(1)
          this.vis.start(1, MotionMs.relit, easeOut)
        }
      } else if (cause === "season") {
        let move = 0
        for (let i = 0; i < 4; i++) move = Math.max(move, this.pos[i].distance(r.corners[i]))
        this.grow.jump(1)
        if (move >= 150) {
          // A large bright area must not sweep the room: fade out here, in there.
          this.crossPending = true
          this.glideT0 = -1
          this.vis.start(0, MotionMs.patchCrossOut, easeIn)
        } else {
          this.glideFrom = this.displayed()
          this.pos = this.glideFrom.slice()
          this.glideT0 = motionNow()
          this.glideDur = sec(MotionMs.seasonMorph)
          this.levelFrom = this.level
          this.colorFrom = this.color
        }
      } else {
        // Clock moves (drag, time change): the spring follows. A running season move hands over.
        if (this.glideT0 >= 0) this.glideT0 = -1
        if (!this.crossPending) { this.level = level; this.color = color }
      }
      this.levelTarget = level
      this.colorTarget = color
      this.target = r.corners.slice()
      this.patchObj.enabled = true
      this.dirty = true
    } else if (this.vis.target > 0 || this.vis.value > 0) {
      // Gone (set, no direct sun, beyond the room, unpinned): fade out where it is.
      this.crossPending = false
      this.glideT0 = -1
      this.vis.start(0, MotionMs.setOut, easeIn)
      this.rays.start(0, MotionMs.rayOut, easeIn)
      this.raysUntil = -1
    }
    // Reduce motion: everything at its end value now.
    if (isReduceMotion()) this.settleNow()
    return r
  }

  private compute(win: WindowGeometry, towardSun: vec3, altitudeDeg: number, sunUp: boolean): PatchResult {
    if (!sunUp) return { state: "set", corners: [], polygon: [], center: win.center }
    if (towardSun.dot(win.intoRoom.uniformScale(-1)) <= 1e-4) return { state: "noDirect", corners: [], polygon: [], center: win.center }
    // Between the 0 deg line and the shown sunset (upper limb still up) the light is horizontal:
    // project it nearly flat, so it lands far beyond the room.
    let ts = towardSun
    const minY = Math.sin(0.3 * DEG)
    if (ts.y < minY) {
      const h = new vec3(ts.x, 0, ts.z).normalize().uniformScale(Math.cos(0.3 * DEG))
      ts = new vec3(h.x, minY, h.z)
    }
    const light = ts.uniformScale(-1)
    const y = this.getPatchPlaneY()
    const corners = win.corners.map((c) => c.add(light.uniformScale((y - c.y) / light.y)))
    const rect = this.floorRect()
    const polygon = clipToRect(corners, rect[0], rect[1], rect[2], rect[3])
    const ref = polygon.length >= 3 ? polygon : corners
    let cx = 0
    let cz = 0
    for (const p of ref) { cx += p.x; cz += p.z }
    return { state: "lit", corners, polygon, center: new vec3(cx / ref.length, y, cz / ref.length) }
  }

  private showRays(): void {
    this.rays.set(1, MotionMs.rayIn, MotionMs.rayOut)
    this.raysUntil = motionNow() + sec(MotionMs.raysHold)
  }

  private settleNow(): void {
    if (this.crossPending) {
      // A crossfade that would fade out and back in: just be there.
      this.crossPending = false
      this.vis.jump(1)
    }
    this.glideT0 = -1
    if (this.target.length === 4) this.pos = this.target.slice()
    this.vel = [vec3.zero(), vec3.zero(), vec3.zero(), vec3.zero()]
    this.level = this.levelTarget
    this.color = this.colorTarget
    this.grow.jump(1)
    this.vis.jump(this.vis.target)
    this.dirty = true
    this.onUpdate()
  }

  /** Drawn corners: spring/tween positions, with the far edge pulled in while growing. */
  private displayed(): vec3[] {
    if (this.pos.length !== 4) return []
    const g = this.grow.value
    if (g >= 1) return this.pos.slice()
    const p = this.pos
    return [p[0], p[1], p[1].add(p[2].sub(p[1]).uniformScale(g)), p[0].add(p[3].sub(p[0]).uniformScale(g))]
  }

  private onUpdate(): void {
    if (!this.patchObj) return
    const dt = Math.min(0.1, getDeltaTime())
    const now = motionNow()
    this.grow.step()
    this.vis.step()
    let moving = this.dirty || !this.grow.isSettled()

    if (this.crossPending && this.vis.value <= 0) {
      this.crossPending = false
      this.pos = this.target.slice()
      this.vel = [vec3.zero(), vec3.zero(), vec3.zero(), vec3.zero()]
      this.level = this.levelTarget
      this.color = this.colorTarget
      this.vis.start(1, MotionMs.patchCrossIn, easeOut)
      moving = true
    } else if (!this.crossPending && this.target.length === 4 && this.pos.length === 4) {
      if (this.glideT0 >= 0) {
        const k = this.glideDur <= 0 ? 1 : Math.min(1, (now - this.glideT0) / this.glideDur)
        const e = easeInOut(k)
        for (let i = 0; i < 4; i++) this.pos[i] = this.glideFrom[i].add(this.target[i].sub(this.glideFrom[i]).uniformScale(e))
        this.level = this.levelFrom + (this.levelTarget - this.levelFrom) * k
        this.color = this.colorFrom.add(this.colorTarget.sub(this.colorFrom).uniformScale(k))
        if (k >= 1) this.glideT0 = -1
        moving = true
      } else {
        for (let i = 0; i < 4; i++) {
          const d = this.target[i].sub(this.pos[i])
          if (d.length < 0.05 && this.vel[i].length < 0.5) {
            if (d.length > 0) moving = true
            this.pos[i] = this.target[i]
            this.vel[i] = vec3.zero()
          } else {
            const s = springStep(this.pos[i], this.vel[i], this.target[i], dt)
            this.pos[i] = s.x
            this.vel[i] = s.v
            moving = true
          }
        }
      }
    }
    if (moving && this.vis.value > 0.001) {
      this.dirty = false
      this.buildMesh(this.displayed())
    }

    // Rays: on while dragging and for a while after a change.
    if (this.dragging) {
      this.rays.set(1, MotionMs.rayIn, MotionMs.rayOut)
    } else if (this.raysUntil >= 0 && now >= this.raysUntil) {
      this.raysUntil = -1
      this.rays.start(0, MotionMs.rayOut, easeIn)
    }
    this.rays.step()

    const c = this.color
    this.mat.mainPass.baseColor = new vec4(c.x, c.y, c.z, this.vis.value * this.level)
    if (this.rayMat && this.rayObj) {
      const b = this.rayBase
      const a = this.getRayOpacity()
      this.rayMat.mainPass.baseColor = new vec4(b.x, b.y, b.z, a)
      this.rayObj.enabled = a > 0.001 && this.patchObj.enabled
    }
    if (this.vis.value <= 0.001 && this.vis.target === 0) this.patchObj.enabled = false
  }

  /**
   * Builds the patch mesh from the 4 drawn corners: the parallelogram is cut into 3 x 3 cells so
   * the soft border has a fixed width in centimetres however long the patch is; each cell is
   * clipped to the floor and gets texture coordinates that put the texture's fade exactly on the
   * border cells. The mesh builder is reused (no new mesh per frame). Then the rays.
   */
  private buildMesh(corners: vec3[]): void {
    if (corners.length !== 4) return
    const rect = this.floorRect()
    const ex0 = corners[1].sub(corners[0])
    const ey0 = corners[3].sub(corners[0])
    if (ex0.length < 1e-3 || ey0.length < 1e-3) { this.rmv.enabled = false; return }
    const fw = this.featherCm
    const h = fw / 2
    const exn = ex0.normalize()
    const eyn = ey0.normalize()
    const c0 = corners[0].sub(exn.uniformScale(h)).sub(eyn.uniformScale(h))
    const ex = ex0.add(exn.uniformScale(2 * h))
    const ey = ey0.add(eyn.uniformScale(2 * h))
    const det = ex.x * ey.z - ex.z * ey.x
    if (Math.abs(det) < 1e-6) { this.rmv.enabled = false; return }
    const W = Math.sqrt(ex.x * ex.x + ex.z * ex.z)
    const L = Math.sqrt(ey.x * ey.x + ey.z * ey.z)
    const a = Math.min(0.45, fw / Math.max(1, W))
    const b = Math.min(0.45, fw / Math.max(1, L))
    const F = TEX_FEATHER
    const sCuts = [0, a, 1 - a, 1]
    const tCuts = [0, b, 1 - b, 1]
    const texOf = (x: number, cuts: number[]): number => {
      if (x <= cuts[1]) return cuts[1] > 0 ? (x / cuts[1]) * F : F
      if (x >= cuts[2]) return 1 - F + ((x - cuts[2]) / Math.max(1e-6, 1 - cuts[2])) * F
      return F + ((x - cuts[1]) / Math.max(1e-6, cuts[2] - cuts[1])) * (1 - 2 * F)
    }
    const at = (s0: number, t0: number): vec3 => c0.add(ex.uniformScale(s0)).add(ey.uniformScale(t0))
    const inv = this.patchObj.getTransform().getInvertedWorldTransform()
    const verts: number[] = []
    const idx: number[] = []
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const s0 = sCuts[i], s1 = sCuts[i + 1], t0 = tCuts[j], t1 = tCuts[j + 1]
        if (s1 - s0 < 1e-6 || t1 - t0 < 1e-6) continue
        const cell = clipToRect([at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)], rect[0], rect[1], rect[2], rect[3])
        if (cell.length < 3) continue
        const base = verts.length / 8
        for (const w of cell) {
          const dx = w.x - c0.x
          const dz = w.z - c0.z
          const ss = Math.max(s0, Math.min(s1, (dx * ey.z - dz * ey.x) / det))
          const tt = Math.max(t0, Math.min(t1, (ex.x * dz - ex.z * dx) / det))
          const p = inv.multiplyPoint(w)
          verts.push(p.x, p.y, p.z, 0, 1, 0, texOf(ss, sCuts), texOf(tt, tCuts))
        }
        for (let k = 1; k + 1 < cell.length; k++) idx.push(base, base + k, base + k + 1)
      }
    }
    if (idx.length === 0) { this.rmv.enabled = false; return }
    refill(this.patchMb, verts, idx)
    if (this.rmv.mesh === null || this.rmv.mesh === undefined) this.rmv.mesh = this.patchMb.getMesh()
    this.rmv.enabled = true
    this.buildRays(corners)
  }

  /** Four thin cross-shaped strips from the window corners to the patch corners, cut at the walls. */
  private buildRays(corners: vec3[]): void {
    if (!this.rayObj || !this.rayRmv || !this.rayMb || !this.win) return
    const inv = this.rayObj.getTransform().getInvertedWorldTransform()
    const rect = this.floorRect()
    const verts: number[] = []
    const idx: number[] = []
    const hw = this.rayWidthCm / 2
    for (let i = 0; i < 4; i++) {
      const a = this.win.corners[i]
      const b = cutAtRoom(a, corners[i], rect)
      const d = b.sub(a)
      if (d.length < 1) continue
      const dir = d.normalize()
      let s1 = dir.cross(vec3.up())
      if (s1.length < 1e-3) s1 = vec3.right()
      s1 = s1.normalize()
      const s2 = dir.cross(s1).normalize()
      for (const side of [s1, s2]) {
        const o = side.uniformScale(hw)
        const base = verts.length / 8
        for (const p of [a.sub(o), a.add(o), b.add(o), b.sub(o)]) {
          const q = inv.multiplyPoint(p)
          verts.push(q.x, q.y, q.z, 0, 1, 0, 0, 0)
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
    if (verts.length === 0) { this.rayRmv.enabled = false; return }
    refill(this.rayMb, verts, idx)
    if (this.rayRmv.mesh === null || this.rayRmv.mesh === undefined) this.rayRmv.mesh = this.rayMb.getMesh()
    this.rayRmv.enabled = true
  }
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

/** Replaces a builder's contents and updates its mesh in place. */
function refill(mb: MeshBuilder, verts: number[], idx: number[]): void {
  const nv = mb.getVerticesCount()
  if (nv > 0) mb.eraseVertices(0, nv)
  const ni = mb.getIndicesCount()
  if (ni > 0) mb.eraseIndices(0, ni)
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  if (mb.isValid()) mb.updateMesh()
}

/** End of the segment a -> b where it leaves the room's x/z rectangle (b if it stays inside). */
function cutAtRoom(a: vec3, b: vec3, rect: number[]): vec3 {
  let t = 1
  const d = b.sub(a)
  const lim = (p0: number, dd: number, lo: number, hi: number): void => {
    if (dd > 1e-6 && p0 + dd * t > hi) t = Math.min(t, (hi - p0) / dd)
    if (dd < -1e-6 && p0 + dd * t < lo) t = Math.min(t, (lo - p0) / dd)
  }
  lim(a.x, d.x, rect[0], rect[1])
  lim(a.z, d.z, rect[2], rect[3])
  return a.add(d.uniformScale(Math.max(0, t)))
}

/** Sutherland–Hodgman clip of a convex polygon (x/z plane) against an axis-aligned rectangle. */
export function clipToRect(pts: vec3[], minX: number, maxX: number, minZ: number, maxZ: number): vec3[] {
  type Edge = { inside: (p: vec3) => boolean, cut: (a: vec3, b: vec3) => vec3 }
  const lerp = (a: vec3, b: vec3, t: number): vec3 => a.add(b.sub(a).uniformScale(t))
  const edges: Edge[] = [
    { inside: (p) => p.x >= minX, cut: (a, b) => lerp(a, b, (minX - a.x) / (b.x - a.x)) },
    { inside: (p) => p.x <= maxX, cut: (a, b) => lerp(a, b, (maxX - a.x) / (b.x - a.x)) },
    { inside: (p) => p.z >= minZ, cut: (a, b) => lerp(a, b, (minZ - a.z) / (b.z - a.z)) },
    { inside: (p) => p.z <= maxZ, cut: (a, b) => lerp(a, b, (maxZ - a.z) / (b.z - a.z)) },
  ]
  let out = pts
  for (const e of edges) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      const ci = e.inside(cur)
      const pi = e.inside(prev)
      if (ci) {
        if (!pi) out.push(e.cut(prev, cur))
        out.push(cur)
      } else if (pi) {
        out.push(e.cut(prev, cur))
      }
    }
    if (out.length === 0) break
  }
  return out
}

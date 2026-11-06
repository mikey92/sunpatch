/**
 * PatchProjector — draws where sunlight through the pinned window lands on the floor.
 *
 * Geometry (no simulation): each of the window's 4 corners is pushed along the light's travel
 * direction until it meets the floor plane; the 4 floor points are the patch. The patch is then
 * clipped to the room's floor rectangle (the light that would land beyond the walls is dropped;
 * patches on walls are out of scope) and drawn 1 cm above the floor as a translucent warm gold
 * polygon. Brightness eases down as the sun nears the horizon, so the patch fades at evening.
 *
 * Look: the patch material carries a soft-edged texture mapped in "window space" (u along the
 * window's width, v along its height), so the light's border fades like a real patch instead of
 * ending in a hard line. When the sun moves the drawn patch glides to the new place (about a
 * quarter second) and appears/disappears with a short fade; with reduceMotion it jumps.
 * Optional: four very faint rays from the window corners to the patch corners.
 *
 * States:
 *   "none"     no window pinned
 *   "set"      sun at or below the horizon
 *   "noDirect" sun is up but behind the window's wall (e.g. a north window at noon)
 *   "lit"      patch drawn
 *
 * Expects (@input): the Floor box (unit box mesh scaled to the floor; its top face is the floor
 * plane and its x/z extent the room) and a translucent patch material.
 *
 * Test-facing values (getLast, isVisible) are the target geometry, updated at once; only the drawn
 * mesh glides.
 */
import { WindowGeometry } from "./WindowPin"

export type PatchState = "none" | "set" | "noDirect" | "lit"

export interface PatchResult {
  state: PatchState
  /** The 4 window corners projected to the patch plane (unclipped), world. Empty unless lit. */
  corners: vec3[]
  /** Clipped polygon actually drawn, world. Empty unless lit and inside the room. */
  polygon: vec3[]
  /** Centroid of the drawn polygon (or of the corners if fully clipped), world. */
  center: vec3
}

@component
export class PatchProjector extends BaseScriptComponent {
  @input
  @hint("Floor box: its top face is the floor plane, its x/z extent the room.")
  floor: SceneObject

  @input
  @hint("Translucent warm gold material for the patch.")
  patchMaterial: Material

  @input
  @hint("Height of the patch above the floor (cm).")
  liftCm: number = 1

  @input
  @hint("Peak opacity of the patch.")
  @widget(new SliderWidget(0.1, 1, 0.05))
  maxAlpha: number = 0.55

  @input
  @hint("Below this sun altitude (deg) the patch fades toward the horizon.")
  fadeBelowDeg: number = 6

  @input
  @allowUndefined
  @hint("Optional: very faint material for the 4 rays window -> patch.")
  rayMaterial: Material

  @input
  @hint("Width of each ray line (cm).")
  rayWidthCm: number = 0.8

  /** Jump instead of gliding/fading (set by SunpatchMain). */
  reduceMotion: boolean = false

  private patchObj: SceneObject
  private rmv: RenderMeshVisual
  private mat: Material
  private baseColor: vec4 = new vec4(1, 0.8, 0.35, 1)
  private targetAlpha: number = 0
  private alpha: number = 0
  private last: PatchResult = { state: "none", corners: [], polygon: [], center: vec3.zero() }
  private win: WindowGeometry | null = null
  private target: vec3[] = []
  private drawn: vec3[] = []
  private dirty: boolean = false
  private rayObj: SceneObject | null = null
  private rayRmv: RenderMeshVisual | null = null
  private rayMat: Material | null = null
  private rayBase: vec4 = new vec4(1, 0.86, 0.55, 0.12)

  onAwake(): void {
    if (!this.floor || !this.patchMaterial) {
      print("PatchProjector: floor and patchMaterial inputs are required.")
      return
    }
    this.patchObj = global.scene.createSceneObject("SunPatch")
    this.rmv = this.patchObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.mat = this.patchMaterial.clone()
    this.baseColor = this.mat.mainPass.baseColor
    this.rmv.mainMaterial = this.mat
    this.rmv.setRenderOrder(10)
    this.patchObj.enabled = false
    if (this.rayMaterial) {
      this.rayObj = global.scene.createSceneObject("SunRays")
      this.rayRmv = this.rayObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      this.rayMat = this.rayMaterial.clone()
      this.rayBase = this.rayMat.mainPass.baseColor
      this.rayRmv.mainMaterial = this.rayMat
      this.rayRmv.setRenderOrder(11)
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

  /** Current drawn opacity (0..maxAlpha). */
  getAlpha(): number {
    return this.alpha
  }

  /** Opacity the patch is fading toward. */
  getTargetAlpha(): number {
    return this.targetAlpha
  }

  /** The 4 corners as currently drawn (they glide toward getLast().corners). */
  getDrawnCorners(): vec3[] {
    return this.drawn.slice()
  }

  /** Largest distance (cm) between a drawn corner and its target. 0 when settled. */
  getGlideError(): number {
    if (this.drawn.length !== 4 || this.target.length !== 4) return 0
    let m = 0
    for (let i = 0; i < 4; i++) m = Math.max(m, this.drawn[i].distance(this.target[i]))
    return m
  }

  /** Whether the 4 rays are drawn. */
  areRaysVisible(): boolean {
    return !!this.rayObj && this.rayObj.enabled
  }

  /**
   * Recomputes the patch for a window and a sun direction (unit vector toward the sun) and
   * returns the result. Pass null to clear.
   */
  project(win: WindowGeometry | null, towardSun: vec3, altitudeDeg: number): PatchResult {
    let r: PatchResult
    if (!win) {
      r = { state: "none", corners: [], polygon: [], center: vec3.zero() }
    } else if (altitudeDeg <= 0 || towardSun.y <= 0) {
      r = { state: "set", corners: [], polygon: [], center: win.center }
    } else if (towardSun.dot(win.intoRoom.uniformScale(-1)) <= 1e-4) {
      r = { state: "noDirect", corners: [], polygon: [], center: win.center }
    } else {
      const light = towardSun.uniformScale(-1)
      const y = this.getPatchPlaneY()
      const corners = win.corners.map((c) => c.add(light.uniformScale((y - c.y) / light.y)))
      const rect = this.floorRect()
      const polygon = clipToRect(corners, rect[0], rect[1], rect[2], rect[3])
      const ref = polygon.length >= 3 ? polygon : corners
      let cx = 0
      let cz = 0
      for (const p of ref) { cx += p.x; cz += p.z }
      r = { state: "lit", corners, polygon, center: new vec3(cx / ref.length, y, cz / ref.length) }
    }
    this.last = r
    this.win = win
    if (this.isVisible()) {
      const fade = Math.max(0.15, Math.min(1, altitudeDeg / Math.max(0.1, this.fadeBelowDeg)))
      // Appearing from nothing: start in place (it fades in); otherwise glide from where it is.
      if (this.drawn.length !== 4 || !this.patchObj.enabled || this.alpha <= 0.001 || this.reduceMotion) {
        this.drawn = r.corners.slice()
      }
      this.target = r.corners.slice()
      this.targetAlpha = this.maxAlpha * fade
      if (this.reduceMotion) this.alpha = this.targetAlpha
      this.patchObj.enabled = true
      this.dirty = true
    } else {
      this.targetAlpha = 0
      if (this.reduceMotion) this.alpha = 0
    }
    return r
  }

  private onUpdate(): void {
    const dt = Math.min(0.1, getDeltaTime())
    if (this.reduceMotion) {
      this.alpha = this.targetAlpha
    } else {
      // ~250 ms fade, ~300 ms glide (exponential ease-out).
      const ka = 1 - Math.exp(-dt / 0.08)
      this.alpha += (this.targetAlpha - this.alpha) * ka
      if (Math.abs(this.alpha - this.targetAlpha) < 0.003) this.alpha = this.targetAlpha
    }
    if (this.target.length === 4 && this.drawn.length === 4 && this.targetAlpha > 0) {
      const kp = this.reduceMotion ? 1 : 1 - Math.exp(-dt / 0.1)
      let moving = false
      for (let i = 0; i < 4; i++) {
        const d = this.target[i].sub(this.drawn[i])
        if (d.length < 0.05 || kp >= 1) {
          if (d.length > 0) moving = true
          this.drawn[i] = this.target[i]
        } else {
          this.drawn[i] = this.drawn[i].add(d.uniformScale(kp))
          moving = true
        }
      }
      if (moving || this.dirty) {
        this.dirty = false
        this.buildMesh(this.drawn)
      }
    }
    if (this.mat) {
      const c = this.baseColor
      this.mat.mainPass.baseColor = new vec4(c.x, c.y, c.z, this.alpha)
    }
    if (this.rayMat && this.rayObj) {
      const c = this.rayBase
      const a = this.maxAlpha > 0 ? c.w * (this.alpha / this.maxAlpha) : 0
      this.rayMat.mainPass.baseColor = new vec4(c.x, c.y, c.z, a)
      this.rayObj.enabled = this.alpha > 0.001
    }
    if (this.patchObj && this.alpha <= 0.001 && this.targetAlpha === 0) this.patchObj.enabled = false
  }

  /** Clips the 4 drawn corners to the floor, builds the patch mesh (window-space UVs) and the rays. */
  private buildMesh(corners: vec3[]): void {
    const rect = this.floorRect()
    const worldPts = clipToRect(corners, rect[0], rect[1], rect[2], rect[3])
    if (worldPts.length < 3) return
    // Inverse of p = c0 + u (c1 - c0) + v (c3 - c0) in x/z (the projected window is a parallelogram).
    const c0 = corners[0]
    const ex = corners[1].sub(c0)
    const ey = corners[3].sub(c0)
    const det = ex.x * ey.z - ex.z * ey.x
    const inv = this.patchObj.getTransform().getInvertedWorldTransform()
    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3, normalized: true },
      { name: "texture0", components: 2 },
    ])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const verts: number[] = []
    for (const w of worldPts) {
      const p = inv.multiplyPoint(w)
      const dx = w.x - c0.x
      const dz = w.z - c0.z
      const u = Math.abs(det) > 1e-6 ? (dx * ey.z - dz * ey.x) / det : 0.5
      const v = Math.abs(det) > 1e-6 ? (ex.x * dz - ex.z * dx) / det : 0.5
      verts.push(p.x, p.y, p.z, 0, 1, 0, u, v)
    }
    mb.appendVerticesInterleaved(verts)
    const idx: number[] = []
    for (let i = 1; i + 1 < worldPts.length; i++) idx.push(0, i, i + 1)
    mb.appendIndices(idx)
    if (mb.isValid()) {
      mb.updateMesh()
      this.rmv.mesh = mb.getMesh()
    }
    this.buildRays(corners)
  }

  /** Four thin cross-shaped strips from the window corners to the patch corners. */
  private buildRays(corners: vec3[]): void {
    if (!this.rayObj || !this.rayRmv || !this.win) return
    const inv = this.rayObj.getTransform().getInvertedWorldTransform()
    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3, normalized: true },
      { name: "texture0", components: 2 },
    ])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const verts: number[] = []
    const idx: number[] = []
    const hw = this.rayWidthCm / 2
    for (let i = 0; i < 4; i++) {
      const a = this.win.corners[i]
      const b = corners[i]
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
    if (verts.length === 0) return
    mb.appendVerticesInterleaved(verts)
    mb.appendIndices(idx)
    if (mb.isValid()) {
      mb.updateMesh()
      this.rayRmv.mesh = mb.getMesh()
    }
  }
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

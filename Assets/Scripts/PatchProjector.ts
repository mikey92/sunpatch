/**
 * PatchProjector — draws where sunlight through the pinned window lands on the floor.
 *
 * Geometry (no simulation): each of the window's 4 corners is pushed along the light's travel
 * direction until it meets the floor plane; the 4 floor points are the patch. The patch is then
 * clipped to the room's floor rectangle (the light that would land beyond the walls is dropped;
 * patches on walls are out of scope) and drawn 1 cm above the floor as a translucent warm gold
 * polygon. Brightness eases down as the sun nears the horizon, so the patch fades at evening.
 *
 * States:
 *   "none"     no window pinned
 *   "set"      sun at or below the horizon
 *   "noDirect" sun is up but behind the window's wall (e.g. a north window at noon)
 *   "lit"      patch drawn
 *
 * Expects (@input): the Floor box (unit box mesh scaled to the floor; its top face is the floor
 * plane and its x/z extent the room) and a translucent patch material.
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

  private patchObj: SceneObject
  private rmv: RenderMeshVisual
  private mat: Material
  private baseColor: vec4 = new vec4(1, 0.8, 0.35, 1)
  private targetAlpha: number = 0
  private alpha: number = 0
  private last: PatchResult = { state: "none", corners: [], polygon: [], center: vec3.zero() }

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
    if (this.isVisible()) {
      this.buildMesh(r.polygon)
      const fade = Math.max(0.15, Math.min(1, altitudeDeg / Math.max(0.1, this.fadeBelowDeg)))
      this.targetAlpha = this.maxAlpha * fade
      this.patchObj.enabled = true
    } else {
      this.targetAlpha = 0
    }
    return r
  }

  private onUpdate(): void {
    const dt = Math.min(0.1, getDeltaTime())
    const k = 1 - Math.exp(-dt / 0.12)
    this.alpha += (this.targetAlpha - this.alpha) * k
    if (Math.abs(this.alpha - this.targetAlpha) < 0.003) this.alpha = this.targetAlpha
    if (this.mat) {
      const c = this.baseColor
      this.mat.mainPass.baseColor = new vec4(c.x, c.y, c.z, this.alpha)
    }
    if (this.patchObj && this.alpha <= 0.001 && this.targetAlpha === 0) this.patchObj.enabled = false
  }

  private buildMesh(worldPts: vec3[]): void {
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
      verts.push(p.x, p.y, p.z, 0, 1, 0, 0, 0)
    }
    mb.appendVerticesInterleaved(verts)
    const idx: number[] = []
    for (let i = 1; i + 1 < worldPts.length; i++) idx.push(0, i, i + 1)
    mb.appendIndices(idx)
    if (mb.isValid()) {
      mb.updateMesh()
      this.rmv.mesh = mb.getMesh()
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

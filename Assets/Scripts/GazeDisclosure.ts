/**
 * GazeDisclosure — shows each piece only where the user is looking.
 *
 *   Looking at the pinned window (or the sky band just above it) -> the sun arc and the handle.
 *   Looking at the floor of the room                               -> the patch label.
 *   Looking anywhere else                                          -> neither.
 * The light patch itself is never hidden by gaze: it is the light, not a panel.
 * ("Sun has set" / "No direct sun" sit at the window, so they show for the window too.)
 *
 * A gaze class must hold for a short dwell (150 ms) before it switches, so a glance across an edge
 * does not flicker. Fades are done by SunpatchMain / SunArcUI (instant with reduceMotion).
 *
 * Off-view arrow: if the patch is lit but outside the view, a small gold chevron sits near the edge
 * of the view pointing toward it, with one soft chime (once per pinned window / season).
 * Looking at the patch hides the arrow.
 *
 * Gaze is the camera's forward ray. Tests can fix it with setGazeOverride (same code path after).
 *
 * Test API (global.sunGaze): getGaze, setGazeOverride, clearGazeOverride, isArrowVisible,
 * getArrowOpacity, getChimeCount, isPatchInView.
 */
import { SunpatchMain } from "./SunpatchMain"
import { SunArcUI } from "./SunArcUI"
import { PatchProjector } from "./PatchProjector"

export type Gaze = "window" | "floor" | "none"

@component
export class GazeDisclosure extends BaseScriptComponent {
  @input
  main: SunpatchMain

  @input
  arc: SunArcUI

  @input
  projector: PatchProjector

  @input
  @hint("Camera object (gaze = its forward ray).")
  cameraObject: SceneObject

  @input
  @hint("Material that ignores depth, for the edge arrow.")
  overlayMaterial: Material

  @input
  @allowUndefined
  @hint("Soft chime played once when the patch first goes out of view.")
  chime: AudioTrackAsset

  @input
  @hint("Extra margin around the window that still counts as looking at it (cm): sides, below, above.")
  windowMargin: vec3 = new vec3(80, 50, 140)

  @input
  @hint("Seconds a new gaze class must hold before it switches.")
  dwellSec: number = 0.15

  @input
  @hint("Fraction of the half field of view that counts as 'in view' for the patch.")
  inViewFraction: number = 0.85

  private cam: Camera | null = null
  private gaze: Gaze = "none"
  private pending: Gaze = "none"
  private pendingSince: number = 0
  private override: { o: vec3, d: vec3 } | null = null

  private arrowObj: SceneObject
  private arrowMat: Material
  private arrowAlpha: number = 0
  private arrowWanted: boolean = false
  private patchInView: boolean = true
  private audio: AudioComponent | null = null
  private chimeCount: number = 0
  private chimeKey: string = ""
  private chimedFor: string = ""

  onAwake(): void {
    if (!this.main || !this.arc || !this.projector || !this.cameraObject || !this.overlayMaterial) {
      print("GazeDisclosure: main, arc, projector, cameraObject and overlayMaterial inputs are required.")
      return
    }
    ;(global as any).sunGaze = this
    this.cam = this.cameraObject.getComponent("Component.Camera") as Camera

    this.arrowObj = global.scene.createSceneObject("OffViewArrow")
    this.arrowObj.setParent(this.cameraObject)
    const rmv = this.arrowObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = buildChevron(1.6)
    this.arrowMat = this.overlayMaterial.clone()
    this.arrowMat.mainPass.baseColor = new vec4(1, 0.84, 0.4, 0)
    rmv.mainMaterial = this.arrowMat
    rmv.setRenderOrder(40)
    this.arrowObj.enabled = false

    if (this.chime) {
      this.audio = this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent
      this.audio.audioTrack = this.chime
      this.audio.volume = 0.5
    }

    this.createEvent("LateUpdateEvent").bind(() => this.onLateUpdate())
  }

  // ── Test API ──────────────────────────────────────────────────────

  getGaze(): Gaze {
    return this.gaze
  }

  /** Fixes the gaze ray (world origin and direction) until clearGazeOverride. */
  setGazeOverride(origin: vec3, dir: vec3): void {
    this.override = { o: origin, d: dir.normalize() }
  }

  clearGazeOverride(): void {
    this.override = null
  }

  isArrowVisible(): boolean {
    return this.arrowWanted
  }

  getArrowOpacity(): number {
    return this.arrowAlpha
  }

  getChimeCount(): number {
    return this.chimeCount
  }

  isPatchInView(): boolean {
    return this.patchInView
  }

  // ── Internals ─────────────────────────────────────────────────────

  private gazeRay(): { o: vec3, d: vec3 } {
    if (this.override) return this.override
    const t = this.cameraObject.getTransform()
    return { o: t.getWorldPosition(), d: t.getWorldRotation().multiplyVec3(new vec3(0, 0, -1)).normalize() }
  }

  private classify(o: vec3, d: vec3): Gaze {
    const w = this.main.getPinnedWindow()
    if (!w) return "none"
    const g = w.getGeometry()
    let best: Gaze = "none"
    let bestT = Number.MAX_VALUE
    const dn = d.dot(g.intoRoom)
    if (dn < -1e-3) {
      const t = g.center.sub(o).dot(g.intoRoom) / dn
      if (t > 0) {
        const hit = o.add(d.uniformScale(t))
        const u = hit.sub(g.center).dot(g.right)
        const v = hit.sub(g.center).dot(g.up)
        const m = this.windowMargin
        if (Math.abs(u) <= g.widthCm / 2 + m.x && v >= -g.heightCm / 2 - m.y && v <= g.heightCm / 2 + m.z) {
          best = "window"
          bestT = t
        }
      }
    }
    if (d.y < -0.05) {
      const y = this.projector.getPatchPlaneY()
      const t = (y - o.y) / d.y
      if (t > 0 && t < bestT) {
        const hit = o.add(d.uniformScale(t))
        const r = this.projector.floorRect()
        if (hit.x >= r[0] && hit.x <= r[1] && hit.z >= r[2] && hit.z <= r[3]) best = "floor"
      }
    }
    return best
  }

  private onLateUpdate(): void {
    if (!this.main) return
    const ray = this.gazeRay()
    const now = getTime()
    const c = this.classify(ray.o, ray.d)
    if (c !== this.pending) {
      this.pending = c
      this.pendingSince = now
    }
    if (this.pending !== this.gaze && now - this.pendingSince >= this.dwellSec) this.gaze = this.pending

    const place = this.main.getLabelPlace()
    this.arc.setShown(this.gaze === "window")
    this.main.setLabelShown(this.gaze === "floor" || (this.gaze === "window" && place === "window"))

    this.updateArrow(ray.o, ray.d)
  }

  private updateArrow(o: vec3, d: vec3): void {
    const reduce = this.main.getReduceMotion()
    const pinned = this.main.getPinnedWindow()
    const visible = this.main.isPatchVisible()
    const key = (pinned ? pinned.getSceneObject().name : "-") + "|" + this.main.getSeason()
    if (key !== this.chimeKey) this.chimeKey = key

    let wanted = false
    let dir2 = new vec2(0, -1)
    if (visible && this.cam) {
      const center = this.projector.getLast().center
      // Camera-space position of the patch, using the gaze ray as the view direction.
      const fwd = d
      let right = fwd.cross(vec3.up())
      if (right.length < 1e-3) right = vec3.right()
      right = right.normalize()
      const up = right.cross(fwd).normalize()
      const rel = center.sub(o)
      const z = rel.dot(fwd)
      const x = rel.dot(right)
      const y = rel.dot(up)
      const tanV = Math.tan(this.cam.fov / 2)
      const tanH = tanV * this.cam.aspect
      const f = this.inViewFraction
      this.patchInView = z > 1 && Math.abs(x / z) <= tanH * f && Math.abs(y / z) <= tanV * f
      wanted = !this.patchInView
      if (wanted) {
        const len = Math.sqrt(x * x + y * y)
        dir2 = len > 1e-3 ? new vec2(x / len, y / len) : new vec2(0, -1)
      }
    } else {
      this.patchInView = true
    }
    this.arrowWanted = wanted

    if (wanted && this.chimedFor !== this.chimeKey) {
      this.chimedFor = this.chimeKey
      this.chimeCount++
      if (this.audio) this.audio.play(1)
    }

    const target = wanted ? 1 : 0
    if (reduce) {
      this.arrowAlpha = target
    } else {
      const k = 1 - Math.exp(-Math.min(0.1, getDeltaTime()) / 0.08)
      this.arrowAlpha += (target - this.arrowAlpha) * k
      if (Math.abs(target - this.arrowAlpha) < 0.01) this.arrowAlpha = target
    }
    this.arrowMat.mainPass.baseColor = new vec4(1, 0.84, 0.4, 0.9 * this.arrowAlpha)
    this.arrowObj.enabled = this.arrowAlpha > 0.001
    if (!this.arrowObj.enabled || !this.cam) return
    if (wanted) {
      // Near the edge of the view, 50 cm ahead, pointing toward the patch.
      const D = 50
      const hv = D * Math.tan(this.cam.fov / 2) * 0.72
      const hh = hv * this.cam.aspect
      const s = 1 / Math.max(Math.abs(dir2.x) / hh, Math.abs(dir2.y) / hv)
      const t = this.arrowObj.getTransform()
      t.setLocalPosition(new vec3(dir2.x * s, dir2.y * s, -D))
      t.setLocalRotation(quat.angleAxis(Math.atan2(dir2.y, dir2.x), new vec3(0, 0, 1)))
    }
  }
}

/** A flat chevron ">" in the x/y plane pointing +X, size ~2r. */
function buildChevron(r: number): RenderMesh {
  const mb = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "normal", components: 3, normalized: true },
    { name: "texture0", components: 2 },
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  const th = r * 0.38
  const pts = [
    new vec3(-r * 0.6, r, 0), new vec3(-r * 0.6 + th, r, 0),
    new vec3(r * 0.6 + th, 0, 0), new vec3(r * 0.6, 0, 0),
    new vec3(-r * 0.6, -r, 0), new vec3(-r * 0.6 + th, -r, 0),
  ]
  const verts: number[] = []
  for (const p of pts) verts.push(p.x, p.y, p.z, 0, 0, 1, 0, 0)
  mb.appendVerticesInterleaved(verts)
  // Upper arm: 0,1,2,3; lower arm: 4,5,2,3.
  mb.appendIndices([0, 1, 2, 0, 2, 3, 4, 3, 2, 4, 2, 5])
  mb.updateMesh()
  return mb.getMesh()
}

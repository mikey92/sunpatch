/**
 * GazeDisclosure — shows each piece only where the user is looking.
 *
 *   Looking at the pinned window (or the sky band just above it) -> the sun arc and the handle.
 *   Looking at the floor of the room                               -> the patch label.
 *   Looking anywhere else                                          -> neither.
 * The light patch itself is never hidden by gaze: it is the light, not a panel.
 * ("Sun has set" / "No direct sun" sit at the window, so they show for the window too.)
 * While the sun is held the floor label shows as well, so the time can be read on the patch.
 *
 * Switching: a new gaze class must hold 120 ms to appear, 250 ms to go back to "elsewhere"
 * (quick to show, reluctant to hide), and the current window / floor area is 15 cm larger on the
 * way out than on the way in, so slow head motion over an edge does not flicker.
 *
 * Off-view arrow: only when the user has looked elsewhere (not the window, not the floor) for
 * 1.5 s, the sun is not held, and the patch is lit but out of view. The view test has
 * hysteresis (out past 85 % of the half field of view, back in within 75 %). The arrow is a
 * small gold arrow with a shaft, 1 m ahead near the edge of the view, pointing toward the patch;
 * it follows the head lazily (200 ms) instead of being fixed to it. In 200 ms ease-out with a
 * 1.5 cm slide from the edge, out 150 ms ease-in.
 * Chime: one soft note (volume 0.35), at most once per pinned window, and only when a pin or a
 * season change has moved the light while the user has not seen it since; never within 600 ms of
 * that change.
 *
 * Gaze is the camera's forward ray. Tests can fix it with setGazeOverride (same code path after).
 *
 * Test API (global.sunGaze): getGaze, setGazeOverride, clearGazeOverride, isArrowVisible,
 * getArrowOpacity, getChimeCount, isPatchInView, getArrowDir, getArrowDistance, isChimeArmed,
 * getElsewhereMs.
 */
import { SunpatchMain } from "./SunpatchMain"
import { SunArcUI } from "./SunArcUI"
import { PatchProjector } from "./PatchProjector"
import { easeOut, Fader, FilterMs, followK, MotionCm, MotionMs } from "./SunpatchMotion"

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
  @hint("Soft chime played when the light moved out of view after a pin or a season change.")
  chime: AudioTrackAsset

  @input
  @hint("Extra margin around the window that still counts as looking at it (cm): sides, below, above.")
  windowMargin: vec3 = new vec3(80, 50, 140)

  @input
  @hint("Extra margin (cm) on the way out of the window or floor area (spatial hysteresis).")
  exitMarginCm: number = 15

  @input
  @hint("Fraction of the half field of view: out of view past this...")
  outFraction: number = 0.85

  @input
  @hint("...and back in view within this.")
  inFraction: number = 0.75

  @input
  @hint("Distance of the arrow ahead of the eye (cm).")
  arrowDistanceCm: number = 100

  private cam: Camera | null = null
  private gaze: Gaze = "none"
  private pending: Gaze = "none"
  private pendingSince: number = 0
  private elsewhereSince: number = 0
  private override: { o: vec3, d: vec3 } | null = null

  private arrowObj: SceneObject
  private arrowMat: Material
  private arrowFade = new Fader(0)
  private arrowSlide = new Fader(1)
  private arrowWanted: boolean = false
  private arrowDir: vec2 = new vec2(0, -1)
  private arrowPos: vec3 | null = null
  private arrowRot: quat | null = null
  private patchInView: boolean = true
  private audio: AudioComponent | null = null
  private chimeCount: number = 0
  private eventKey: string = ""
  private windowKey: string = ""
  private armed: boolean = false
  private armedAt: number = 0
  private chimedWindow: boolean = false

  onAwake(): void {
    if (!this.main || !this.arc || !this.projector || !this.cameraObject || !this.overlayMaterial) {
      print("GazeDisclosure: main, arc, projector, cameraObject and overlayMaterial inputs are required.")
      return
    }
    ;(global as any).sunGaze = this
    this.cam = this.cameraObject.getComponent("Component.Camera") as Camera

    this.arrowObj = global.scene.createSceneObject("OffViewArrow")
    const rmv = this.arrowObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = buildArrow()
    this.arrowMat = this.overlayMaterial.clone()
    this.arrowMat.mainPass.baseColor = new vec4(1, 0.84, 0.4, 0)
    rmv.mainMaterial = this.arrowMat
    rmv.setRenderOrder(40)
    this.arrowObj.enabled = false

    if (this.chime) {
      this.audio = this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent
      this.audio.audioTrack = this.chime
      this.audio.volume = 0.35
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

  /** The arrow is wanted (it fades in/out from here). */
  isArrowVisible(): boolean {
    return this.arrowWanted
  }

  getArrowOpacity(): number {
    return this.arrowFade.value
  }

  getChimeCount(): number {
    return this.chimeCount
  }

  isPatchInView(): boolean {
    return this.patchInView
  }

  /** Direction the arrow points in the view (x right, y up, unit). */
  getArrowDir(): vec2 {
    return this.arrowDir
  }

  /** Distance from the eye to the drawn arrow (cm), 0 if not drawn. */
  getArrowDistance(): number {
    if (!this.arrowObj.enabled) return 0
    return this.arrowObj.getTransform().getWorldPosition().distance(this.gazeRay().o)
  }

  /** A pin or season change moved the light and the user has not seen it since. */
  isChimeArmed(): boolean {
    return this.armed
  }

  /** How long the gaze has been "elsewhere" (ms), 0 if not. */
  getElsewhereMs(): number {
    return this.gaze === "none" ? (getTime() - this.elsewhereSince) * 1000 : 0
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
        const e = this.gaze === "window" ? this.exitMarginCm : 0
        if (Math.abs(u) <= g.widthCm / 2 + m.x + e && v >= -g.heightCm / 2 - m.y - e && v <= g.heightCm / 2 + m.z + e) {
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
        const e = this.gaze === "floor" ? this.exitMarginCm : 0
        if (hit.x >= r[0] - e && hit.x <= r[1] + e && hit.z >= r[2] - e && hit.z <= r[3] + e) best = "floor"
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
    const dwell = (this.pending === "none" ? FilterMs.dwellOut : FilterMs.dwellIn) / 1000
    if (this.pending !== this.gaze && now - this.pendingSince >= dwell) {
      this.gaze = this.pending
      if (this.gaze === "none") this.elsewhereSince = now
    }

    const place = this.main.getLabelPlace()
    const held = this.arc.isHeld()
    this.arc.setShown(this.gaze === "window")
    this.main.setLabelShown(this.gaze === "floor" || (this.gaze === "window" && place === "window") || (held && place === "floor"))

    this.updateArrow(ray.o, ray.d, now, held)
  }

  private updateArrow(o: vec3, d: vec3, now: number, held: boolean): void {
    const pinned = this.main.getPinnedWindow()
    const visible = this.main.isPatchVisible()
    const wkey = pinned ? pinned.getSceneObject().name : "-"
    if (wkey !== this.windowKey) {
      this.windowKey = wkey
      this.chimedWindow = false
    }
    const ekey = wkey + "|" + this.main.getSeason()
    if (ekey !== this.eventKey) {
      this.eventKey = ekey
      if (pinned) { this.armed = true; this.armedAt = now }
    }

    let out = false
    if (visible && this.cam) {
      const center = this.projector.getDrawnCenter()
      const fwd = d
      let right = fwd.cross(vec3.up())
      if (right.length < 1e-3) right = vec3.right()
      right = right.normalize()
      const up = right.cross(fwd).normalize()
      const tanV = Math.tan(this.cam.fov / 2)
      const tanH = tanV * this.cam.aspect
      const f = this.patchInView ? this.outFraction : this.inFraction
      const inView = (p: vec3): boolean => {
        const r = p.sub(o)
        const zz = r.dot(fwd)
        return zz > 1 && Math.abs(r.dot(right) / zz) <= tanH * f && Math.abs(r.dot(up) / zz) <= tanV * f
      }
      // In view if its center, or a point a quarter of the way in from any corner, is in view.
      let seen = inView(center)
      for (const p of this.projector.getLast().polygon) {
        if (seen) break
        seen = inView(p.add(center.sub(p).uniformScale(0.25)))
      }
      this.patchInView = seen
      out = !seen
      const rel = center.sub(o)
      const x = rel.dot(right)
      const y = rel.dot(up)
      const len = Math.sqrt(x * x + y * y)
      if (out && len > 1e-3) this.arrowDir = new vec2(x / len, y / len)
    } else {
      this.patchInView = true
    }
    if (this.patchInView && visible) this.armed = false

    const elsewhereLong = this.gaze === "none" && (now - this.elsewhereSince) * 1000 >= FilterMs.arrowDwell
    const wanted = out && elsewhereLong && !held
    const rising = wanted && !this.arrowWanted
    this.arrowWanted = wanted

    if (rising) {
      this.arrowSlide.jump(0)
      this.arrowSlide.start(1, MotionMs.arrowIn, easeOut)
      if (this.armed && !this.chimedWindow && (now - this.armedAt) * 1000 >= MotionMs.chimeQuiet) {
        this.chimedWindow = true
        this.armed = false
        this.chimeCount++
        if (this.audio) this.audio.play(1)
      }
    }
    this.arrowFade.set(wanted ? 1 : 0, MotionMs.arrowIn, MotionMs.arrowOut)
    const a = this.arrowFade.step()
    const slide = this.arrowSlide.step()
    this.arrowMat.mainPass.baseColor = new vec4(1, 0.84, 0.4, 0.6 * a)
    this.arrowObj.enabled = a > 0.001
    if (!this.arrowObj.enabled || !this.cam) {
      this.arrowPos = null
      this.arrowRot = null
      return
    }
    // Target: near the edge of the view, 1 m ahead, pointing toward the patch (head frame).
    const D = this.arrowDistanceCm
    const hv = D * Math.tan(this.cam.fov / 2) * 0.72
    const hh = hv * this.cam.aspect
    const dir2 = this.arrowDir
    const s = 1 / Math.max(Math.abs(dir2.x) / hh, Math.abs(dir2.y) / hv) + (1 - slide) * MotionCm.arrowSlide
    let right = d.cross(vec3.up())
    if (right.length < 1e-3) right = vec3.right()
    right = right.normalize()
    const up = right.cross(d).normalize()
    const target = o.add(d.uniformScale(D)).add(right.uniformScale(dir2.x * s)).add(up.uniformScale(dir2.y * s))
    const look = quat.lookAt(d.uniformScale(-1), up)
    const rot = look.multiply(quat.angleAxis(Math.atan2(dir2.y, dir2.x), new vec3(0, 0, 1)))
    // Lazy follow (a filter: kept with reduce motion).
    const k = followK(Math.min(0.1, getDeltaTime()), FilterMs.arrowFollow)
    this.arrowPos = this.arrowPos ? this.arrowPos.add(target.sub(this.arrowPos).uniformScale(k)) : target
    this.arrowRot = this.arrowRot ? quat.slerp(this.arrowRot, rot, k) : rot
    const t = this.arrowObj.getTransform()
    t.setWorldPosition(this.arrowPos)
    t.setWorldRotation(this.arrowRot)
  }
}

/** A flat arrow with a shaft in the x/y plane pointing +X: shaft 3 x 0.6 cm, head 60 deg, 4.5 cm long. */
function buildArrow(): RenderMesh {
  const mb = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "normal", components: 3, normalized: true },
    { name: "texture0", components: 2 },
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  const total = 4.5
  const headLen = 1.5
  const headHalf = headLen * Math.tan(30 * Math.PI / 180)
  const x0 = -total / 2
  const xs = x0 + total - headLen
  const xt = x0 + total
  const sh = 0.3
  const pts = [
    new vec3(x0, -sh, 0), new vec3(xs, -sh, 0), new vec3(xs, sh, 0), new vec3(x0, sh, 0),
    new vec3(xs, -headHalf, 0), new vec3(xt, 0, 0), new vec3(xs, headHalf, 0),
  ]
  const verts: number[] = []
  for (const p of pts) verts.push(p.x, p.y, p.z, 0, 0, 1, 0, 0)
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices([0, 1, 2, 0, 2, 3, 4, 5, 6])
  mb.updateMesh()
  return mb.getMesh()
}

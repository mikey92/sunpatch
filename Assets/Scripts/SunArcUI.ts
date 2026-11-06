/**
 * SunArcUI — the sun's path outside the pinned window, the sun handle, and the season button.
 *
 * Arc: for the computed day (today, Dec 21 or Jun 21), the sun direction is sampled every 3 minutes
 * from sunrise to sunset and each direction is drawn at `radiusCm` from the window center, so the
 * arc is the real sky path seen through that window. Only the part in front of the window wall
 * (sun up and outside) is drawn: that is the only light that can come in. Small dots mark whole
 * hours. On glasses the arc is drawn over the real wall, so its material ignores depth.
 *
 * Handle: a 4 cm sun on the arc at the current time. Grab and drag it: the handle follows the arc
 * point nearest to the pinch ray, and the time becomes that point's time (it cannot leave the
 * real path). A short clock readout floats above it ("15:10", and the sunset time near the end).
 * The grab target is larger than the sun (an invisible sphere) so it is easy to hit.
 *
 * Season button (UI Kit): 15 cm below-right of the pinned window, Today -> Dec 21 -> Jun 21.
 *
 * Visibility: GazeDisclosure calls setShown(); the arc and handle fade in/out (about 250 ms, or at
 * once with reduceMotion). The season button stays while a window is pinned.
 *
 * Test API (global.sunArc): getArcPoints, getArcTimes, getHandleWorld, isHandleVisible,
 * getArcOpacity, isArcShown, getHandleInteractable, getSeasonButtonObject, pressSeason,
 * getSeasonText, getHandleText, setShown, dragHandleToward.
 */
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import { SunpatchMain } from "./SunpatchMain"
import { WindowGeometry } from "./WindowPin"

const MS_MIN = 60000
const SAMPLE_MIN = 3

interface ArcSample {
  utcMs: number
  pos: vec3
}

@component
export class SunArcUI extends BaseScriptComponent {
  @input
  main: SunpatchMain

  @input
  @hint("Material that ignores depth (drawn over the wall, as on glasses).")
  overlayMaterial: Material

  @input
  cameraObject: SceneObject

  @input
  @hint("UI Kit button for the season (RectangleButton).")
  seasonButton: SceneObject

  @input
  @hint("Text inside the season button.")
  seasonText: Text

  @input
  @hint("Small clock readout above the handle.")
  handleLabel: Text

  @input
  @hint("Distance of the arc from the window center (cm). Outside the window, 1-3 m; keep the handle within the 5 m pinch-ray reach from where the user stands.")
  radiusCm: number = 120

  @input
  handleDiameterCm: number = 4

  @input
  @hint("Invisible grab sphere around the handle (cm).")
  grabDiameterCm: number = 16

  @input
  lineWidthCm: number = 0.7

  @input
  @hint("Gap between the window edge and the season button (cm).")
  buttonGapCm: number = 15

  private arcObj: SceneObject
  private arcRmv: RenderMeshVisual
  private arcMat: Material
  private handleObj: SceneObject
  private handleMat: Material
  private haloMat: Material
  private haloObj: SceneObject
  private interactable: Interactable | null = null
  private button: RectangleButton | null = null

  private segments: ArcSample[][] = []
  private arcKey: string = ""
  private shown: boolean = true
  private alpha: number = 0
  private handleOnArc: boolean = false
  private handlePos: vec3 = vec3.zero()
  private dragging: boolean = false
  private handleText: string = ""

  onAwake(): void {
    if (!this.main || !this.overlayMaterial || !this.cameraObject) {
      print("SunArcUI: main, overlayMaterial and cameraObject inputs are required.")
      return
    }
    ;(global as any).sunArc = this

    this.arcObj = global.scene.createSceneObject("SunArc")
    this.arcRmv = this.arcObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.arcMat = this.overlayMaterial.clone()
    this.arcMat.mainPass.baseColor = new vec4(1, 0.93, 0.72, 0)
    this.arcRmv.mainMaterial = this.arcMat
    this.arcRmv.setRenderOrder(30)
    this.arcObj.enabled = false

    this.handleObj = global.scene.createSceneObject("SunHandle")
    const hv = this.handleObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    hv.mesh = buildSphere(this.handleDiameterCm / 2, 14, 10)
    this.handleMat = this.overlayMaterial.clone()
    this.handleMat.mainPass.baseColor = new vec4(1, 0.82, 0.3, 0)
    hv.mainMaterial = this.handleMat
    hv.setRenderOrder(32)
    this.haloObj = global.scene.createSceneObject("SunHandleHalo")
    this.haloObj.setParent(this.handleObj)
    const halo = this.haloObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    halo.mesh = buildSphere(this.handleDiameterCm * 0.95, 14, 10)
    this.haloMat = this.overlayMaterial.clone()
    this.haloMat.mainPass.baseColor = new vec4(1, 0.85, 0.45, 0)
    halo.mainMaterial = this.haloMat
    halo.setRenderOrder(31)
    const col = this.handleObj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createSphereShape()
    shape.radius = this.grabDiameterCm / 2
    col.shape = shape
    col.fitVisual = false
    this.interactable = this.handleObj.createComponent(Interactable.getTypeName()) as Interactable
    this.handleObj.enabled = false

    if (this.handleLabel) this.handleLabel.getSceneObject().enabled = false
    if (this.seasonButton) {
      this.button = this.seasonButton.getComponent(RectangleButton.getTypeName()) as RectangleButton
      this.seasonButton.enabled = false
    }

    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("LateUpdateEvent").bind(() => this.onLateUpdate())
  }

  private onStart(): void {
    if (this.interactable) {
      this.interactable.enableInstantDrag = true
      this.interactable.onDragStart.add((e) => { this.dragging = true; this.dragTo(e.interactor.startPoint, e.interactor.direction) })
      this.interactable.onDragUpdate.add((e) => this.dragTo(e.interactor.startPoint, e.interactor.direction))
      this.interactable.onDragEnd.add(() => { this.dragging = false })
    }
    if (this.button) this.button.onTriggerUp.add(() => this.pressSeason())
    this.updateSeasonText()
  }

  // ── Test API ──────────────────────────────────────────────────────

  /** Drawn arc points (world), all segments joined in time order. */
  getArcPoints(): vec3[] {
    const out: vec3[] = []
    for (const s of this.segments) for (const p of s) out.push(p.pos)
    return out
  }

  /** UTC ms of each arc point, same order as getArcPoints. */
  getArcTimes(): number[] {
    const out: number[] = []
    for (const s of this.segments) for (const p of s) out.push(p.utcMs)
    return out
  }

  getHandleWorld(): vec3 {
    return this.handlePos
  }

  isHandleVisible(): boolean {
    return this.handleObj.enabled
  }

  getArcOpacity(): number {
    return this.alpha
  }

  /** The arc is on screen (has points, gaze wants it, not fully faded). */
  isArcShown(): boolean {
    return this.arcObj.enabled && this.alpha > 0.001
  }

  getHandleInteractable(): Interactable | null {
    return this.interactable
  }

  getSeasonButtonObject(): SceneObject {
    return this.seasonButton
  }

  getSeasonText(): string {
    return this.seasonText ? this.seasonText.text : ""
  }

  getHandleText(): string {
    return this.handleText
  }

  /** Called by GazeDisclosure: show the arc and handle (looking at the window) or not. */
  setShown(on: boolean): void {
    this.shown = on
    if (this.main.getReduceMotion()) this.alpha = this.targetAlpha()
  }

  /** Same as pressing the season button. Returns the new season. */
  pressSeason(): string {
    const s = this.main.cycleSeason()
    this.updateSeasonText()
    return s
  }

  /** Moves the time to the arc point nearest to a ray (what a drag does each frame). */
  dragHandleToward(origin: vec3, dir: vec3): void {
    this.dragTo(origin, dir)
  }

  // ── Internals ─────────────────────────────────────────────────────

  private targetAlpha(): number {
    return this.shown && this.segments.length > 0 && !!this.main.getPinnedWindow() ? 1 : 0
  }

  private updateSeasonText(): void {
    if (!this.seasonText) return
    const s = this.main.getSeason()
    this.seasonText.text = s === "dec21" ? "Dec 21" : s === "jun21" ? "Jun 21" : "Today"
  }

  private dragTo(origin: vec3 | null, dir: vec3 | null): void {
    if (!origin || !dir || this.segments.length === 0) return
    const d = dir.normalize()
    let best = Number.MAX_VALUE
    let bestT = NaN
    for (const seg of this.segments) {
      for (let i = 0; i + 1 < seg.length; i++) {
        const r = closestOnSegmentToRay(seg[i].pos, seg[i + 1].pos, origin, d)
        if (r.dist < best) {
          best = r.dist
          bestT = seg[i].utcMs + (seg[i + 1].utcMs - seg[i].utcMs) * r.t
        }
      }
    }
    if (isNaN(bestT)) return
    const day = this.main.getDayInfo()
    this.main.setClockMinutes((bestT - day.midnightUtcMs) / MS_MIN)
  }

  private rebuildArc(win: WindowGeometry): void {
    const day = this.main.getDayInfo()
    this.segments = []
    if (isNaN(day.sunriseMs) || isNaN(day.sunsetMs)) {
      this.arcObj.enabled = false
      return
    }
    const out = win.intoRoom.uniformScale(-1)
    let cur: ArcSample[] = []
    const step = SAMPLE_MIN * MS_MIN
    for (let t = day.sunriseMs; t <= day.sunsetMs + 1; t += step) {
      const s = this.main.towardSunAt(Math.min(t, day.sunsetMs))
      const ok = s.altitude > 0.05 && s.dir.dot(out) > 0.03
      if (ok) {
        cur.push({ utcMs: Math.min(t, day.sunsetMs), pos: win.center.add(s.dir.uniformScale(this.radiusCm)) })
      } else if (cur.length > 0) {
        if (cur.length > 1) this.segments.push(cur)
        cur = []
      }
    }
    if (cur.length > 1) this.segments.push(cur)
    this.buildArcMesh(day.midnightUtcMs)
  }

  private buildArcMesh(midnightUtcMs: number): void {
    if (this.segments.length === 0) {
      this.arcObj.enabled = false
      return
    }
    const mb = newBuilder()
    const verts: number[] = []
    const idx: number[] = []
    const hw = this.lineWidthCm / 2
    const cam = this.cameraObject.getTransform().getWorldPosition()
    for (const seg of this.segments) {
      for (let i = 0; i + 1 < seg.length; i++) addStrip(verts, idx, seg[i].pos, seg[i + 1].pos, hw)
      // Whole-hour dots.
      for (let i = 0; i + 1 < seg.length; i++) {
        const h0 = Math.floor((seg[i].utcMs - midnightUtcMs) / 3600000)
        const h1 = Math.floor((seg[i + 1].utcMs - midnightUtcMs) / 3600000)
        if (h1 > h0) addDot(verts, idx, seg[i + 1].pos, 1.1, cam)
      }
    }
    mb.appendVerticesInterleaved(verts)
    mb.appendIndices(idx)
    if (mb.isValid()) {
      mb.updateMesh()
      this.arcRmv.mesh = mb.getMesh()
      this.arcObj.enabled = true
    }
  }

  /** Position on the arc for the current instant, if the sun is on the drawn part. */
  private handleAt(utcMs: number): vec3 | null {
    for (const seg of this.segments) {
      if (utcMs < seg[0].utcMs || utcMs > seg[seg.length - 1].utcMs) continue
      for (let i = 0; i + 1 < seg.length; i++) {
        const a = seg[i]
        const b = seg[i + 1]
        if (utcMs >= a.utcMs && utcMs <= b.utcMs) {
          const t = (utcMs - a.utcMs) / Math.max(1, b.utcMs - a.utcMs)
          return a.pos.add(b.pos.sub(a.pos).uniformScale(t))
        }
      }
    }
    return null
  }

  private onLateUpdate(): void {
    if (!this.main) return
    const pinned = this.main.getPinnedWindow()
    if (!pinned) {
      this.arcObj.enabled = false
      this.handleObj.enabled = false
      if (this.seasonButton) this.seasonButton.enabled = false
      if (this.handleLabel) this.handleLabel.getSceneObject().enabled = false
      this.arcKey = ""
      return
    }
    const win = pinned.getGeometry()
    const day = this.main.getDayInfo()
    const key = win.name + "|" + day.key
    if (key !== this.arcKey) {
      this.arcKey = key
      this.rebuildArc(win)
      if (!this.main.getReduceMotion()) this.alpha = 0 // fade the new arc in
      this.placeButton(pinned.getSceneObject().getTransform(), win)
      this.updateSeasonText()
    }

    // Fade.
    const target = this.targetAlpha()
    if (this.main.getReduceMotion()) {
      this.alpha = target
    } else {
      const k = 1 - Math.exp(-Math.min(0.1, getDeltaTime()) / 0.08)
      this.alpha += (target - this.alpha) * k
      if (Math.abs(target - this.alpha) < 0.005) this.alpha = target
    }
    this.arcMat.mainPass.baseColor = new vec4(1, 0.93, 0.72, 0.6 * this.alpha)
    this.arcObj.enabled = this.segments.length > 0 && this.alpha > 0.001

    // Handle.
    const utc = this.main.getUtcMs()
    const p = this.handleAt(utc)
    this.handleOnArc = !!p
    if (p) this.handlePos = p
    const handleOn = this.handleOnArc && this.alpha > 0.001
    this.handleObj.enabled = handleOn || (this.dragging && this.alpha > 0.001)
    this.handleMat.mainPass.baseColor = new vec4(1, 0.82, 0.3, this.alpha)
    this.haloMat.mainPass.baseColor = new vec4(1, 0.85, 0.45, 0.22 * this.alpha)
    if (this.handleObj.enabled) this.handleObj.getTransform().setWorldPosition(this.handlePos)

    // Clock readout above the handle.
    const t = this.main.getSunTimes()
    const clock = this.main.getLocalClock()
    const nearSet = !isNaN(day.sunsetMs) && day.sunsetMs - utc < 20 * MS_MIN && day.sunsetMs >= utc
    const nearRise = !isNaN(day.sunriseMs) && utc - day.sunriseMs < 20 * MS_MIN && utc >= day.sunriseMs
    this.handleText = nearSet ? clock + "\nSunset " + t.sunset : nearRise ? "Sunrise " + t.sunrise + "\n" + clock : clock
    if (this.handleLabel) {
      const so = this.handleLabel.getSceneObject()
      so.enabled = this.handleObj.enabled
      if (so.enabled) {
        this.handleLabel.text = this.handleText
        const c = this.handleLabel.textFill.color
        this.handleLabel.textFill.color = new vec4(c.x, c.y, c.z, this.alpha)
        const pos = this.handlePos.add(new vec3(0, 9, 0))
        so.getTransform().setWorldPosition(pos)
        const cam = this.cameraObject.getTransform().getWorldPosition()
        const d = cam.sub(pos)
        so.getTransform().setWorldRotation(quat.angleAxis(Math.atan2(d.x, d.z), vec3.up()))
      }
    }

    if (this.seasonButton) this.seasonButton.enabled = true
  }

  /** Season button 15 cm below-right of the window, facing into the room. */
  private placeButton(t: Transform, win: WindowGeometry): void {
    if (!this.seasonButton) return
    const halfW = 5
    const halfH = 2
    const pos = win.center
      .add(win.right.uniformScale(win.widthCm / 2 + this.buttonGapCm + halfW))
      .sub(win.up.uniformScale(win.heightCm / 2 + this.buttonGapCm + halfH))
      .add(win.intoRoom.uniformScale(4))
    const bt = this.seasonButton.getTransform()
    bt.setWorldPosition(pos)
    bt.setWorldRotation(t.getWorldRotation())
  }
}

// ── Geometry helpers ─────────────────────────────────────────────────

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

/** Two crossed thin quads from a to b (visible from any side). */
function addStrip(verts: number[], idx: number[], a: vec3, b: vec3, hw: number): void {
  const d = b.sub(a)
  if (d.length < 1e-3) return
  const dir = d.normalize()
  let s1 = dir.cross(vec3.up())
  if (s1.length < 1e-3) s1 = vec3.right()
  s1 = s1.normalize()
  const s2 = dir.cross(s1).normalize()
  for (const side of [s1, s2]) {
    const o = side.uniformScale(hw)
    const base = verts.length / 8
    for (const p of [a.sub(o), a.add(o), b.add(o), b.sub(o)]) verts.push(p.x, p.y, p.z, 0, 1, 0, 0, 0)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

/** A small diamond facing the camera. */
function addDot(verts: number[], idx: number[], c: vec3, r: number, cam: vec3): void {
  const f = cam.sub(c).normalize()
  let u = vec3.up()
  let s = f.cross(u)
  if (s.length < 1e-3) s = vec3.right()
  s = s.normalize()
  u = s.cross(f).normalize()
  const base = verts.length / 8
  for (const p of [c.add(u.uniformScale(r)), c.add(s.uniformScale(r)), c.sub(u.uniformScale(r)), c.sub(s.uniformScale(r))]) {
    verts.push(p.x, p.y, p.z, f.x, f.y, f.z, 0, 0)
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/** UV sphere mesh centered at the origin. */
function buildSphere(r: number, seg: number, rings: number): RenderMesh {
  const mb = newBuilder()
  const verts: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= rings; j++) {
    const th = (j / rings) * Math.PI
    for (let i = 0; i <= seg; i++) {
      const ph = (i / seg) * Math.PI * 2
      const n = new vec3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph))
      verts.push(n.x * r, n.y * r, n.z * r, n.x, n.y, n.z, i / seg, j / rings)
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i
      const b = a + seg + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  mb.updateMesh()
  return mb.getMesh()
}

/** Closest point on segment ab to a ray (origin o, unit dir d): t in [0,1] along ab, and distance. */
function closestOnSegmentToRay(a: vec3, b: vec3, o: vec3, d: vec3): { t: number, dist: number } {
  const u = b.sub(a)
  const w = a.sub(o)
  const uu = u.dot(u)
  const ud = u.dot(d)
  const uw = u.dot(w)
  const dw = d.dot(w)
  const den = uu - ud * ud
  let t = den > 1e-6 ? (ud * dw - uw) / den : 0
  t = Math.max(0, Math.min(1, t))
  const p = a.add(u.uniformScale(t))
  const s = Math.max(0, p.sub(o).dot(d))
  const q = o.add(d.uniformScale(s))
  return { t, dist: p.distance(q) }
}

/**
 * SunArcUI — the sun's path outside the pinned window and the sun handle.
 *
 * Arc: for the computed day (today, Dec 21 or Jun 21), the sun direction is sampled at 200 even
 * steps from sunrise to sunset (the NOAA times the Lens shows) and each direction is drawn at
 * `radiusCm` from the window center, so the arc is the real sky path seen through that window.
 * The part in front of the window wall is a solid 1.2 cm line (only that light can come in);
 * the part where the sun is up but behind the wall is a faint dashed line, so the whole day
 * reads. Whole hours are 3 cm dots (solar noon a little larger); the two visible ends carry a
 * small clock ("13:09", "Sunset 16:24"). On glasses the arc is drawn over the real wall, so its
 * material ignores depth.
 *
 * Handle: a 6 cm sun with a 12 cm halo on the arc at the current time. Grab it (24 cm grab
 * sphere) or anywhere on the line (10 cm thick grab capsules) and drag: the time becomes the
 * arc point nearest to the pinch ray (it cannot leave the real path; the line's end at sunset is
 * the sunset itself). Whole minutes, with a 0.35 min dead band so a still hand does not flicker
 * the clock. Hover: halo 0.45 and 1.25x (120 ms); held: 0.6. If the current time is not on the
 * solid line (night, or the sun behind the wall) the handle waits, dimmed, at the nearest end,
 * still grabbable.
 * Readout: the clock 12 cm above the handle (cap ~5 cm); within 20 min of sunset/sunrise an
 * event line ("Sunset 16:24") fades in above it (out again past 21 min).
 * "Drag the sun" shows 12 cm below the handle after a pin, until the first drag or 5 s.
 *
 * Visibility: GazeDisclosure calls setShown(). In: arc 220 ms, handle +80 ms, clock +140 ms;
 * out: all 160 ms. While the sun is held, and for 1 s after, the arc and handle stay whatever the
 * gaze. After a pin the arc comes 150 ms later. Season change: the arc morphs to the new day in
 * 500 ms ease-in-out (dots hidden, then 120 ms in); if the number of solid parts differs it
 * crossfades instead. Reduce motion: all at once.
 *
 * Test API (global.sunArc): getArcPoints, getArcTimes, getHandleWorld, isHandleVisible,
 * isHandleOnArc, getHandleOpacity, getHalo, getArcOpacity, isArcShown, getHandleInteractable,
 * getLineInteractables, pressSeason, getHandleText, getClockText, getEventText, setShown,
 * dragHandleToward, isMorphing, isDragHintShown, getEndLabels, getDashedPointCount,
 * getHandleClockOffset, isHeld.
 */
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { SunpatchMain } from "./SunpatchMain"
import { WindowGeometry } from "./WindowPin"
import { easeIn, easeInOut, easeOut, Fader, MotionMs, motionNow, sec } from "./SunpatchMotion"

const MS_MIN = 60000
const N_SAMPLES = 200
const POOL = 32
const ARC_COLOR = new vec3(1, 0.93, 0.72)

interface ArcSample {
  utcMs: number
  pos: vec3
  front: boolean
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
  @hint("Clock readout above the handle.")
  handleLabel: Text

  @input
  @allowUndefined
  @hint("Event line above the clock (\"Sunset 16:24\").")
  handleEvent: Text

  @input
  @allowUndefined
  @hint("Onboarding hint \"Drag the sun\" below the handle.")
  dragHint: Text

  @input
  @allowUndefined
  @hint("Small clock at the start of the visible arc.")
  arcStartLabel: Text

  @input
  @allowUndefined
  @hint("Small clock at the end of the visible arc.")
  arcEndLabel: Text

  @input
  @hint("Distance of the arc from the window center (cm). Keep the handle within the 5 m pinch-ray reach.")
  radiusCm: number = 120

  @input
  handleDiameterCm: number = 6

  @input
  haloDiameterCm: number = 12

  @input
  @hint("Invisible grab sphere around the handle (cm).")
  grabDiameterCm: number = 24

  @input
  lineWidthCm: number = 1.2

  @input
  @hint("Thickness of the invisible grab capsules along the line (cm).")
  lineGrabCm: number = 10

  @input
  dotCm: number = 3

  @input
  @hint("Clock text scale (48 pt x 7 = about 5.3 cm cap height).")
  clockScale: number = 7

  @input
  @hint("Clock height above the handle (cm).")
  clockOffsetCm: number = 12

  private arcObj: SceneObject
  private arcMat: Material
  private arcMb: MeshBuilder
  private ghostObj: SceneObject
  private ghostMat: Material
  private ghostMb: MeshBuilder
  private dashObj: SceneObject
  private dashMat: Material
  private dashMb: MeshBuilder
  private dotObj: SceneObject
  private dotMat: Material
  private dotMb: MeshBuilder
  private handleObj: SceneObject
  private handleMat: Material
  private haloMat: Material
  private haloObj: SceneObject
  private interactable: Interactable | null = null
  private lineGrabs: { so: SceneObject, it: Interactable, shape: CapsuleShape }[] = []

  private samples: ArcSample[] = []
  private drawPos: vec3[] = []
  private fromPos: vec3[] = []
  private morphT0: number = -1
  private segments: ArcSample[][] = []
  private arcKey: string = ""
  private winName: string = ""
  private shown: boolean = true
  private arcFade = new Fader(0)
  private handleFade = new Fader(0)
  private clockFade = new Fader(0)
  private dotsFade = new Fader(0)
  private ghostFade = new Fader(0)
  private eventFade = new Fader(0)
  private haloLevel = new Fader(0.22)
  private haloScale = new Fader(1)
  private hintFade = new Fader(0)
  private hintShownMs: number = 0
  private hintDone: boolean = true
  private pinRevealAt: number = -1
  private handleOnArc: boolean = false
  private handlePos: vec3 = vec3.zero()
  private dragging: boolean = false
  private dragEndAt: number = -100
  private hovers: { [k: string]: boolean } = {}
  private clockText: string = ""
  private eventText: string = ""
  private eventKind: string = ""
  private lastMin: number = NaN
  private clockBase: vec4 = new vec4(1, 1, 1, 1)
  private clockBg: vec4 = new vec4(0.35, 0.42, 0.55, 0.7)

  onAwake(): void {
    if (!this.main || !this.overlayMaterial || !this.cameraObject) {
      print("SunArcUI: main, overlayMaterial and cameraObject inputs are required.")
      return
    }
    ;(global as any).sunArc = this

    const mk = (name: string, order: number): [SceneObject, Material, MeshBuilder] => {
      const so = global.scene.createSceneObject(name)
      const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      const mat = this.overlayMaterial.clone()
      mat.mainPass.baseColor = new vec4(ARC_COLOR.x, ARC_COLOR.y, ARC_COLOR.z, 0)
      rmv.mainMaterial = mat
      rmv.setRenderOrder(order)
      const mb = newBuilder()
      so.enabled = false
      ;(so as any).__rmv = rmv
      return [so, mat, mb]
    }
    ;[this.arcObj, this.arcMat, this.arcMb] = mk("SunArc", 30)
    ;[this.ghostObj, this.ghostMat, this.ghostMb] = mk("SunArcOld", 29)
    ;[this.dashObj, this.dashMat, this.dashMb] = mk("SunArcBehindWall", 28)
    ;[this.dotObj, this.dotMat, this.dotMb] = mk("SunArcHours", 30)

    this.handleObj = global.scene.createSceneObject("SunHandle")
    const hv = this.handleObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    hv.mesh = buildSphere(this.handleDiameterCm / 2, 16, 12)
    this.handleMat = this.overlayMaterial.clone()
    this.handleMat.mainPass.baseColor = new vec4(1, 0.82, 0.3, 0)
    hv.mainMaterial = this.handleMat
    hv.setRenderOrder(32)
    this.haloObj = global.scene.createSceneObject("SunHandleHalo")
    this.haloObj.setParent(this.handleObj)
    const halo = this.haloObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    halo.mesh = buildSphere(this.haloDiameterCm / 2, 16, 12)
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

    // Grab capsules along the line (a fixed pool, moved when the arc changes).
    for (let i = 0; i < POOL; i++) {
      const so = global.scene.createSceneObject("SunArcGrab" + i)
      const c = so.createComponent("Physics.ColliderComponent") as ColliderComponent
      const cs = Shape.createCapsuleShape()
      cs.axis = Axis.Y
      cs.radius = this.lineGrabCm / 2
      cs.length = 10
      c.shape = cs
      c.fitVisual = false
      const it = so.createComponent(Interactable.getTypeName()) as Interactable
      so.enabled = false
      this.lineGrabs.push({ so, it, shape: cs })
    }

    if (this.handleLabel) {
      this.handleLabel.getSceneObject().enabled = false
      this.handleLabel.getSceneObject().getTransform().setLocalScale(vec3.one().uniformScale(this.clockScale))
      this.clockBase = this.handleLabel.textFill.color
      const bg = this.handleLabel.backgroundSettings.fill.color
      this.clockBg = new vec4(bg.x, bg.y, bg.z, 0.7)
    }
    for (const t of [this.handleEvent, this.dragHint, this.arcStartLabel, this.arcEndLabel]) if (t) t.getSceneObject().enabled = false

    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("LateUpdateEvent").bind(() => this.onLateUpdate())
  }

  private onStart(): void {
    const wire = (it: Interactable, key: string): void => {
      it.enableInstantDrag = true
      it.onHoverEnter.add(() => { this.hovers[key] = true })
      it.onHoverExit.add(() => { delete this.hovers[key] })
      it.onDragStart.add((e) => { this.setDragging(true); this.dragTo(e.interactor.startPoint, e.interactor.direction) })
      it.onDragUpdate.add((e) => this.dragTo(e.interactor.startPoint, e.interactor.direction))
      it.onDragEnd.add(() => this.setDragging(false))
    }
    if (this.interactable) wire(this.interactable, "handle")
    this.lineGrabs.forEach((g, i) => wire(g.it, "line" + i))
  }

  // ── Test API ──────────────────────────────────────────────────────

  /** Solid arc points (world, the day's final shape), all parts joined in time order. */
  getArcPoints(): vec3[] {
    const out: vec3[] = []
    for (const s of this.segments) for (const p of s) out.push(p.pos)
    return out
  }

  /** UTC ms of each solid arc point, same order as getArcPoints. */
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

  /** The handle is on the solid line (false: waiting at the nearest end). */
  isHandleOnArc(): boolean {
    return this.handleOnArc
  }

  getHandleOpacity(): number {
    return this.handleMat.mainPass.baseColor.w
  }

  /** Halo opacity and scale now. */
  getHalo(): { alpha: number, scale: number } {
    return { alpha: this.haloMat.mainPass.baseColor.w, scale: this.haloObj.getTransform().getLocalScale().x }
  }

  getArcOpacity(): number {
    return this.arcFade.value
  }

  /** The arc is on screen (has points, gaze wants it or the sun is held, not fully faded). */
  isArcShown(): boolean {
    return this.arcObj.enabled && this.arcFade.value > 0.001
  }

  getHandleInteractable(): Interactable | null {
    return this.interactable
  }

  /** Interactables of the grab capsules that are on the line now. */
  getLineInteractables(): Interactable[] {
    return this.lineGrabs.filter((g) => g.so.enabled).map((g) => g.it)
  }

  /** Same as choosing the next season (Today -> Dec 21 -> Jun 21). Returns the new season. */
  pressSeason(): string {
    return this.main.cycleSeason()
  }

  /** Readout: event line (if any) above the clock. */
  getHandleText(): string {
    return this.eventText ? this.eventText + "\n" + this.clockText : this.clockText
  }

  getClockText(): string {
    return this.clockText
  }

  getEventText(): string {
    return this.eventText
  }

  /** Called by GazeDisclosure: show the arc and handle (looking at the window) or not. */
  setShown(on: boolean): void {
    this.shown = on
  }

  /** Moves the time to the arc point nearest to a ray (what a drag does each frame). */
  dragHandleToward(origin: vec3, dir: vec3): void {
    this.dragTo(origin, dir)
  }

  isMorphing(): boolean {
    return this.morphT0 >= 0
  }

  isDragHintShown(): boolean {
    return !!this.dragHint && this.dragHint.getSceneObject().enabled && this.hintFade.value > 0.001
  }

  /** The two small end clocks (texts). */
  getEndLabels(): string[] {
    return [this.arcStartLabel ? this.arcStartLabel.text : "", this.arcEndLabel ? this.arcEndLabel.text : ""]
  }

  /** Number of samples on the dashed (behind the wall) part. */
  getDashedPointCount(): number {
    return this.samples.filter((s) => !s.front).length
  }

  /** Vertical distance from the handle to the clock readout (cm). */
  getHandleClockOffset(): number {
    return this.handleLabel ? this.handleLabel.getSceneObject().getTransform().getWorldPosition().y - this.handlePos.y : 0
  }

  /** The sun is held (or was let go less than 1 s ago). */
  isHeld(): boolean {
    return this.dragging || (getTime() - this.dragEndAt) * 1000 < MotionMs.dragHold
  }

  // ── Internals ─────────────────────────────────────────────────────

  private setDragging(on: boolean): void {
    if (this.dragging && !on) this.dragEndAt = getTime()
    this.dragging = on
    if (on) this.hintDone = true
    this.main.setDragging(on)
  }

  private targetShown(): boolean {
    const held = this.isHeld()
    return (this.shown || held) && this.segments.length > 0 && !!this.main.getPinnedWindow()
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
    // The line's ends at sunrise / sunset are those moments exactly.
    if (!isNaN(day.sunsetMs) && Math.abs(bestT - day.sunsetMs) < 30000) bestT = day.sunsetMs
    else if (!isNaN(day.sunriseMs) && Math.abs(bestT - day.sunriseMs) < 30000) bestT = day.sunriseMs
    else {
      // Whole minutes with a 0.35 min dead band around the current minute.
      const raw = (bestT - day.midnightUtcMs) / MS_MIN
      const cur = isNaN(this.lastMin) ? Math.round(raw) : this.lastMin
      const next = Math.abs(raw - cur) > 0.65 ? Math.round(raw) : cur
      this.lastMin = next
      if (Math.abs(this.main.getClockMinutes() - next) < 1e-6) return
      this.main.setClockMinutes(next)
      return
    }
    this.lastMin = NaN
    this.main.setClockMinutes((bestT - day.midnightUtcMs) / MS_MIN)
  }

  /** Samples the whole day (sunrise..sunset) for a window. */
  private sampleDay(win: WindowGeometry): ArcSample[] {
    const day = this.main.getDayInfo()
    if (isNaN(day.sunriseMs) || isNaN(day.sunsetMs)) return []
    const out = win.intoRoom.uniformScale(-1)
    const res: ArcSample[] = []
    for (let i = 0; i < N_SAMPLES; i++) {
      const t = day.sunriseMs + (day.sunsetMs - day.sunriseMs) * (i / (N_SAMPLES - 1))
      const s = this.main.towardSunAt(t)
      res.push({ utcMs: t, pos: win.center.add(s.dir.uniformScale(this.radiusCm)), front: s.dir.dot(out) > 0.03 })
    }
    return res
  }

  private splitSegments(samples: ArcSample[]): ArcSample[][] {
    const segs: ArcSample[][] = []
    let cur: ArcSample[] = []
    for (const s of samples) {
      if (s.front) cur.push(s)
      else if (cur.length > 0) { if (cur.length > 1) segs.push(cur); cur = [] }
    }
    if (cur.length > 1) segs.push(cur)
    return segs
  }

  private rebuild(win: WindowGeometry, morph: boolean): void {
    const next = this.sampleDay(win)
    const nextSegs = this.splitSegments(next)
    const canMorph = morph && this.samples.length === next.length && next.length > 0 && nextSegs.length === this.segments.length
      && !this.main.getReduceMotion()
    if (morph && !canMorph && this.segments.length > 0 && !this.main.getReduceMotion()) {
      // Crossfade: the old arc (as drawn) fades out, the new one fades in a little later.
      this.buildLine(this.ghostMb, this.ghostObj, this.drawPos, this.samples, true)
      this.ghostFade.jump(this.arcFade.value)
      this.ghostFade.start(0, MotionMs.arcCrossOut, easeIn)
      this.arcFade.jump(0)
      this.arcFade.start(this.targetShown() ? 1 : 0, MotionMs.arcCrossIn, easeOut, MotionMs.arcCrossGap)
    }
    this.fromPos = this.drawPos.length === next.length ? this.drawPos.slice() : []
    this.samples = next
    this.segments = nextSegs
    if (canMorph) {
      this.morphT0 = motionNow()
      this.dotsFade.jump(0)
    } else {
      this.morphT0 = -1
      this.drawPos = next.map((s) => s.pos)
      this.dotsFade.jump(0)
      this.dotsFade.start(1, MotionMs.dotsIn, easeOut)
    }
    this.placeGrabs()
    this.updateEndLabels()
    this.buildAll()
  }

  private buildAll(): void {
    this.buildLine(this.arcMb, this.arcObj, this.drawPos, this.samples, true)
    this.buildLine(this.dashMb, this.dashObj, this.drawPos, this.samples, false)
    this.buildDots()
  }

  /** Solid (front) or dashed (behind the wall) line from positions. */
  private buildLine(mb: MeshBuilder, so: SceneObject, pos: vec3[], samples: ArcSample[], front: boolean): void {
    const verts: number[] = []
    const idx: number[] = []
    if (front) {
      for (let i = 0; i + 1 < samples.length; i++) {
        if (samples[i].front && samples[i + 1].front) addStrip(verts, idx, pos[i], pos[i + 1], this.lineWidthCm / 2)
      }
    } else {
      // Dashes: 5 cm on, 4 cm off along the behind-the-wall parts.
      let run = 0
      for (let i = 0; i + 1 < samples.length; i++) {
        if (samples[i].front || samples[i + 1].front) { run = 0; continue }
        const a = pos[i]
        const b = pos[i + 1]
        const len = a.distance(b)
        let s = 0
        while (s < len) {
          const phase = run % 9
          const step = Math.min(len - s, phase < 5 ? 5 - phase : 9 - phase)
          if (phase < 5) addStrip(verts, idx, a.add(b.sub(a).uniformScale(s / len)), a.add(b.sub(a).uniformScale((s + step) / len)), this.lineWidthCm / 2)
          s += step
          run += step
        }
      }
    }
    const rmv = (so as any).__rmv as RenderMeshVisual
    if (idx.length === 0) { rmv.enabled = false; return }
    refill(mb, verts, idx)
    if (!rmv.mesh) rmv.mesh = mb.getMesh()
    rmv.enabled = true
  }

  private buildDots(): void {
    const verts: number[] = []
    const idx: number[] = []
    const day = this.main.getDayInfo()
    const cam = this.cameraObject.getTransform().getWorldPosition()
    let noonDone = false
    for (let i = 0; i + 1 < this.samples.length; i++) {
      const a = this.samples[i]
      const b = this.samples[i + 1]
      if (!a.front || !b.front) continue
      const h0 = Math.floor((a.utcMs - day.midnightUtcMs) / 3600000)
      const h1 = Math.floor((b.utcMs - day.midnightUtcMs) / 3600000)
      if (h1 > h0) {
        const tt = (day.midnightUtcMs + h1 * 3600000 - a.utcMs) / Math.max(1, b.utcMs - a.utcMs)
        addDot(verts, idx, this.drawPos[i].add(this.drawPos[i + 1].sub(this.drawPos[i]).uniformScale(tt)), this.dotCm / 2, cam)
      }
      if (!noonDone && !isNaN(day.noonMs) && a.utcMs <= day.noonMs && b.utcMs > day.noonMs) {
        noonDone = true
        const tt = (day.noonMs - a.utcMs) / Math.max(1, b.utcMs - a.utcMs)
        addDot(verts, idx, this.drawPos[i].add(this.drawPos[i + 1].sub(this.drawPos[i]).uniformScale(tt)), this.dotCm * 0.75, cam)
      }
    }
    const rmv = (this.dotObj as any).__rmv as RenderMeshVisual
    if (idx.length === 0) { rmv.enabled = false; return }
    refill(this.dotMb, verts, idx)
    if (!rmv.mesh) rmv.mesh = this.dotMb.getMesh()
    rmv.enabled = true
  }

  /** Grab capsules spread evenly along the solid line. */
  private placeGrabs(): void {
    const pts: vec3[][] = this.segments.map((s) => s.map((p) => p.pos))
    let total = 0
    for (const s of pts) for (let i = 0; i + 1 < s.length; i++) total += s[i].distance(s[i + 1])
    const step = Math.max(12, total / POOL)
    let k = 0
    for (const s of pts) {
      let acc = 0
      let start = s[0]
      for (let i = 0; i + 1 < s.length && k < POOL; i++) {
        acc += s[i].distance(s[i + 1])
        const last = i + 2 === s.length
        if (acc >= step || last) {
          const end = s[i + 1]
          const g = this.lineGrabs[k++]
          const mid = start.add(end).uniformScale(0.5)
          const dir = end.sub(start)
          const len = dir.length
          const t = g.so.getTransform()
          t.setWorldPosition(mid)
          t.setWorldRotation(len > 1e-3 ? quat.rotationFromTo(vec3.up(), dir.normalize()) : quat.quatIdentity())
          g.shape.length = Math.max(0.1, len)
          ;(g.so as any).__on = true
          start = end
          acc = 0
        }
      }
    }
    for (let i = k; i < POOL; i++) (this.lineGrabs[i].so as any).__on = false
  }

  private updateEndLabels(): void {
    const day = this.main.getDayInfo()
    const set = (t: Text | null, s: ArcSample | null, isEnd: boolean): void => {
      if (!t) return
      if (!s) { t.text = ""; return }
      const atEvent = isEnd ? Math.abs(s.utcMs - day.sunsetMs) < 60000 : Math.abs(s.utcMs - day.sunriseMs) < 60000
      const c = this.main.clockOf(s.utcMs)
      t.text = atEvent ? (isEnd ? "Sunset " : "Sunrise ") + c : c
    }
    const first = this.segments.length > 0 ? this.segments[0][0] : null
    const lastSeg = this.segments.length > 0 ? this.segments[this.segments.length - 1] : null
    set(this.arcStartLabel, first, false)
    set(this.arcEndLabel, lastSeg ? lastSeg[lastSeg.length - 1] : null, true)
  }

  /** Index-space position on the drawn arc for an instant, if it is on the solid line. */
  private posAt(utcMs: number): vec3 | null {
    for (let i = 0; i + 1 < this.samples.length; i++) {
      const a = this.samples[i]
      const b = this.samples[i + 1]
      if (utcMs >= a.utcMs && utcMs <= b.utcMs) {
        if (!a.front || !b.front) return null
        const t = (utcMs - a.utcMs) / Math.max(1, b.utcMs - a.utcMs)
        return this.drawPos[i].add(this.drawPos[i + 1].sub(this.drawPos[i]).uniformScale(t))
      }
    }
    return null
  }

  /** The solid-line end nearest in time (where the handle waits). */
  private nearestEnd(utcMs: number): vec3 | null {
    let best: vec3 | null = null
    let bestD = Number.MAX_VALUE
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i]
      if (!s.front) continue
      const isEnd = i === 0 || i === this.samples.length - 1 || !this.samples[i - 1].front || !this.samples[i + 1].front
      if (!isEnd) continue
      const d = Math.abs(s.utcMs - utcMs) % (24 * 3600000)
      const dd = Math.min(d, 24 * 3600000 - d)
      if (dd < bestD) { bestD = dd; best = this.drawPos[i] }
    }
    return best
  }

  private onLateUpdate(): void {
    if (!this.main) return
    const now = motionNow()
    const pinned = this.main.getPinnedWindow()
    if (!pinned) {
      for (const so of [this.arcObj, this.ghostObj, this.dashObj, this.dotObj, this.handleObj]) so.enabled = false
      for (const t of [this.handleLabel, this.handleEvent, this.dragHint, this.arcStartLabel, this.arcEndLabel]) if (t) t.getSceneObject().enabled = false
      for (const g of this.lineGrabs) g.so.enabled = false
      this.arcKey = ""
      this.winName = ""
      return
    }
    const win = pinned.getGeometry()
    const day = this.main.getDayInfo()
    const key = win.name + "|" + day.key
    if (key !== this.arcKey) {
      const newWindow = win.name !== this.winName
      this.arcKey = key
      this.winName = win.name
      if (newWindow) {
        // After a pin: the arc comes 150 ms after the light starts; the hint waits for the handle.
        this.arcFade.jump(0)
        this.handleFade.jump(0)
        this.clockFade.jump(0)
        this.pinRevealAt = now + sec(150)
        this.hintDone = false
        this.hintShownMs = 0
        this.drawPos = []
      }
      this.lastMin = NaN
      this.rebuild(win, !newWindow)
    }

    // Season morph.
    if (this.morphT0 >= 0) {
      const d = sec(MotionMs.seasonMorph)
      const k = d <= 0 ? 1 : Math.min(1, (now - this.morphT0) / d)
      const e = easeInOut(k)
      this.drawPos = this.samples.map((s, i) => this.fromPos.length === this.samples.length ? this.fromPos[i].add(s.pos.sub(this.fromPos[i]).uniformScale(e)) : s.pos)
      if (k >= 1) {
        this.morphT0 = -1
        this.dotsFade.start(1, MotionMs.dotsIn, easeOut)
      }
      this.buildAll()
    }

    // Fades (gaze, with the hold while the sun is held).
    const want = this.targetShown() && now >= this.pinRevealAt ? 1 : 0
    this.arcFade.set(want, MotionMs.gazeIn, MotionMs.gazeOut)
    this.handleFade.set(want, MotionMs.gazeIn, MotionMs.gazeOut, MotionMs.arcHandleStagger)
    this.clockFade.set(want, MotionMs.gazeIn, MotionMs.gazeOut, MotionMs.arcClockStagger)
    const a = this.arcFade.step()
    const ha = this.handleFade.step()
    const ca = this.clockFade.step()
    const da = this.dotsFade.step()
    const ga = this.ghostFade.step()
    this.arcMat.mainPass.baseColor = new vec4(ARC_COLOR.x, ARC_COLOR.y, ARC_COLOR.z, 0.7 * a)
    this.arcObj.enabled = this.segments.length > 0 && a > 0.001
    this.dashMat.mainPass.baseColor = new vec4(ARC_COLOR.x, ARC_COLOR.y, ARC_COLOR.z, 0.15 * a)
    this.dashObj.enabled = this.samples.length > 0 && a > 0.001
    this.dotMat.mainPass.baseColor = new vec4(ARC_COLOR.x, ARC_COLOR.y, ARC_COLOR.z, 0.85 * a * da)
    this.dotObj.enabled = a * da > 0.001
    this.ghostMat.mainPass.baseColor = new vec4(ARC_COLOR.x, ARC_COLOR.y, ARC_COLOR.z, 0.7 * ga)
    this.ghostObj.enabled = ga > 0.001
    const grabsOn = this.arcObj.enabled && a > 0.5
    for (const g of this.lineGrabs) g.so.enabled = grabsOn && !!(g.so as any).__on
    this.placeEndLabel(this.arcStartLabel, true, a * da)
    this.placeEndLabel(this.arcEndLabel, false, a * da)

    // Handle: on the line at the current time, or waiting (dimmed) at the nearest end.
    const utc = this.main.getUtcMs()
    const p = this.posAt(utc)
    this.handleOnArc = !!p
    const park = p ? null : this.nearestEnd(utc)
    const hp = p || park
    if (hp) this.handlePos = hp
    const dim = p ? 1 : 0.45
    this.handleObj.enabled = !!hp && ha > 0.001
    const hovered = Object.keys(this.hovers).length > 0
    if (this.dragging) { this.haloLevel.set(0.6, MotionMs.grabIn, MotionMs.release); this.haloScale.set(1.25, MotionMs.grabIn, MotionMs.release) }
    else if (hovered) { this.haloLevel.set(0.45, MotionMs.hoverIn, MotionMs.hoverOut); this.haloScale.set(1.25, MotionMs.hoverIn, MotionMs.hoverOut) }
    else { this.haloLevel.set(0.22, MotionMs.hoverIn, MotionMs.release); this.haloScale.set(1, MotionMs.hoverIn, MotionMs.release) }
    const hl = this.haloLevel.step()
    const hs = this.haloScale.step()
    this.handleMat.mainPass.baseColor = new vec4(1, 0.82, 0.3, ha * dim)
    this.haloMat.mainPass.baseColor = new vec4(1, 0.85, 0.45, hl * ha * dim)
    this.haloObj.getTransform().setLocalScale(vec3.one().uniformScale(hs))
    if (this.handleObj.enabled) this.handleObj.getTransform().setWorldPosition(this.handlePos)

    this.updateReadout(day, utc, ca * (p ? 1 : 0.8))
    this.updateDragHint(ha)
  }

  private updateReadout(day: { sunriseMs: number, sunsetMs: number }, utc: number, alpha: number): void {
    const t = this.main.getSunTimes()
    this.clockText = this.main.getLocalClock()
    // Event line within 20 min of sunset / sunrise (leaves past 21 min).
    const toSet = (day.sunsetMs - utc) / MS_MIN
    const fromRise = (utc - day.sunriseMs) / MS_MIN
    const lim = (k: string): number => (this.eventKind === k ? 21 : 20)
    let kind = ""
    if (!this.main.isSunUp()) {
      // Night: say which event the clock is past (the handle waits at that end).
      const d2 = this.main.getDayInfo()
      kind = !isNaN(d2.noonMs) && utc > d2.noonMs ? "set" : "rise"
    } else if (!isNaN(day.sunsetMs) && toSet >= 0 && toSet < lim("set")) kind = "set"
    else if (!isNaN(day.sunriseMs) && fromRise >= 0 && fromRise < lim("rise")) kind = "rise"
    if (kind !== this.eventKind) {
      this.eventKind = kind
      this.eventFade.jump(0)
      if (kind) this.eventFade.start(1, MotionMs.eventLineIn, easeOut)
    }
    this.eventText = kind === "set" ? "Sunset " + t.sunset : kind === "rise" ? "Sunrise " + t.sunrise : ""
    const cam = this.cameraObject.getTransform().getWorldPosition()
    const face = (so: SceneObject, pos: vec3): void => {
      const tr = so.getTransform()
      tr.setWorldPosition(pos)
      const d = cam.sub(pos)
      tr.setWorldRotation(quat.angleAxis(Math.atan2(d.x, d.z), vec3.up()))
    }
    const on = this.handleObj.enabled && alpha > 0.001
    if (this.handleLabel) {
      const so = this.handleLabel.getSceneObject()
      so.enabled = on
      if (on) {
        this.handleLabel.text = this.clockText
        const b = this.clockBase
        this.handleLabel.textFill.color = new vec4(b.x, b.y, b.z, b.w * alpha)
        const bg = this.clockBg
        this.handleLabel.backgroundSettings.fill.color = new vec4(bg.x, bg.y, bg.z, bg.w * alpha)
        face(so, this.handlePos.add(new vec3(0, this.clockOffsetCm, 0)))
      }
    }
    if (this.handleEvent) {
      const so = this.handleEvent.getSceneObject()
      const ea = alpha * this.eventFade.step()
      so.enabled = on && !!this.eventText && ea > 0.001
      if (so.enabled) {
        this.handleEvent.text = this.eventText
        const c = this.handleEvent.textFill.color
        this.handleEvent.textFill.color = new vec4(c.x, c.y, c.z, ea)
        face(so, this.handlePos.add(new vec3(0, this.clockOffsetCm + 7.5, 0)))
      }
    }
  }

  private updateDragHint(handleAlpha: number): void {
    if (!this.dragHint) return
    const visibleHandle = this.handleObj.enabled && handleAlpha > 0.5
    if (visibleHandle && !this.hintDone) {
      this.hintShownMs += Math.min(0.1, getDeltaTime()) * 1000
      if (this.hintShownMs >= 5000) this.hintDone = true
    }
    this.hintFade.set(visibleHandle && !this.hintDone ? 1 : 0, MotionMs.hintIn, MotionMs.hintOut)
    const a = this.hintFade.step()
    const so = this.dragHint.getSceneObject()
    so.enabled = a > 0.001 && this.handleObj.enabled
    if (!so.enabled) return
    const c = this.dragHint.textFill.color
    this.dragHint.textFill.color = new vec4(c.x, c.y, c.z, a)
    const bgc = this.dragHint.backgroundSettings.fill.color
    this.dragHint.backgroundSettings.fill.color = new vec4(bgc.x, bgc.y, bgc.z, 0.7 * a)
    const pos = this.handlePos.add(new vec3(0, -12, 0))
    const tr = so.getTransform()
    tr.setWorldPosition(pos)
    const d = this.cameraObject.getTransform().getWorldPosition().sub(pos)
    tr.setWorldRotation(quat.angleAxis(Math.atan2(d.x, d.z), vec3.up()))
  }

  private placeEndLabel(t: Text | null, start: boolean, alpha: number): void {
    if (!t) return
    const so = t.getSceneObject()
    if (this.segments.length === 0 || !t.text || alpha <= 0.001) { so.enabled = false; return }
    // Find the drawn position of that end.
    let idx = -1
    if (start) { for (let i = 0; i < this.samples.length; i++) if (this.samples[i].front) { idx = i; break } }
    else { for (let i = this.samples.length - 1; i >= 0; i--) if (this.samples[i].front) { idx = i; break } }
    if (idx < 0 || idx >= this.drawPos.length) { so.enabled = false; return }
    so.enabled = true
    const pos = this.drawPos[idx].add(new vec3(0, -7, 0))
    const c = t.textFill.color
    t.textFill.color = new vec4(c.x, c.y, c.z, alpha)
    const bgc = t.backgroundSettings.fill.color
    t.backgroundSettings.fill.color = new vec4(bgc.x, bgc.y, bgc.z, 0.6 * alpha)
    const tr = so.getTransform()
    tr.setWorldPosition(pos)
    const d = this.cameraObject.getTransform().getWorldPosition().sub(pos)
    tr.setWorldRotation(quat.angleAxis(Math.atan2(d.x, d.z), vec3.up()))
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

function refill(mb: MeshBuilder, verts: number[], idx: number[]): void {
  const nv = mb.getVerticesCount()
  if (nv > 0) mb.eraseVertices(0, nv)
  const ni = mb.getIndicesCount()
  if (ni > 0) mb.eraseIndices(0, ni)
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  if (mb.isValid()) mb.updateMesh()
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

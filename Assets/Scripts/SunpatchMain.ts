/**
 * SunpatchMain — state of the Lens and the test API.
 *
 * State: the place (preview: London, said on screen), the time (the real current time by
 * default, or a fixed instant), the season (Today / Dec 21 / Jun 21, same clock time), the room's
 * north alignment, and the pinned window. Every frame the sun position is computed (NOAA,
 * SolarPosition.ts), turned into a scene direction (SunFrame.ts), and the patch is projected from
 * the pinned window to the floor (PatchProjector.ts). The sun counts as up between the NOAA
 * sunrise and sunset times (the times the Lens shows), so the patch goes off at the shown sunset.
 *
 * Label: 25 cm above the drawn patch (it moves with the patch), turned to face the eye (yaw and
 * pitch), or in front of the window when there is no patch ("Sun has set", "No direct sun").
 * It is shown only when the gaze asks for it (GazeDisclosure calls setLabelShown): 220 ms in,
 * 160 ms out. After a pin it comes 200 ms after the patch starts, rising 1 cm. When its kind
 * changes (lit -> "Sun has set" etc.) it crossfades (120 ms out, 200 ms in) instead of jumping
 * across the room; a changing clock alone does not fade.
 *
 * Times are shown in the place's civil time (preview: UK time, GMT/BST).
 *
 * Start time: the real current time. If the sun is down (or low, under 6 deg, or its light would
 * land outside the room for the window you face), the Lens starts at 15:10 today (London date)
 * instead, and the preview note says so for the first 6 s ("Sun is down now, showing 15:10").
 *
 * Onboarding: before the first pin, "Pinch a window" floats 25 cm above the window you face
 * (the window outlines breathe, WindowPin); it fades out on the pin.
 *
 * Test API (also published as global.sunpatch): pinWindow, getPinnedWindowName, setTime,
 * setUtc, setDate, useNow, setSeason, cycleSeason, getSeason, getSunAltAz, getTowardSun,
 * getPatchState, getPatchCorners, getPatchPolygon, isPatchVisible, getPatchAlpha, getLabel,
 * isLabelVisible, getWindowCorners, getPatchPlaneY, getUtcMs, getLocalClock, getSunTimes,
 * getNorthFrame, useDemoDefault, setReduceMotion, getReduceMotion, setLabelShown,
 * isLabelAvailable, getLabelPlace, getLabelOpacity, setClockMinutes, getClockMinutes, getDayInfo,
 * towardSunAt, isSunUp, wasFallbackStart, getPreviewNoteText, isPinchHintShown, getLabelWorld,
 * setDragging, isDragging, getLastPatchCause, replayStart, getDateTag, unpin, getWindowOutline.
 */
import { formatClock, solarPosition, sunTimes, SunPosition, ukOffsetMinutes } from "./SolarPosition"
import { NorthFrame, towardSun, yawFacingAzimuth } from "./SunFrame"
import { WindowPin } from "./WindowPin"
import { PatchCause, PatchProjector, PatchState } from "./PatchProjector"
import { easeIn, easeOut, Fader, MotionCm, MotionMs, motionNow, sec, setReduceMotion as setMotionReduce, setTweenDriver } from "./SunpatchMotion"

export type Season = "today" | "dec21" | "jun21"

const MS_MIN = 60000
const MS_DAY = 86400000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const NOTE = "Preview · London · north assumed"
const HONEST_MS = 6000

@component
export class SunpatchMain extends BaseScriptComponent {
  @ui.group_start("References")
  @input
  @hint("Projects the window onto the floor.")
  projector: PatchProjector

  @input
  @hint("Text for the patch / window label.")
  label: Text

  @input
  @hint("The device camera (labels turn toward it).")
  cameraObject: SceneObject

  @input
  @allowUndefined
  @hint("Floor marker whose local -Z is turned to point north.")
  northMarker: SceneObject

  @input
  @allowUndefined
  @hint("Standing preview note next to the north marker (it turns toward the eye).")
  previewNote: Text

  @input
  @allowUndefined
  @hint("Onboarding hint shown above the window you face until the first pin.")
  pinchHint: Text
  @ui.group_end

  @ui.group_start("Place (preview stand-in)")
  @input
  @hint("Latitude, degrees north. Preview: London. The clock stays UK time (GMT/BST) whatever the place.")
  latitudeDeg: number = 51.5074

  @input
  @hint("Longitude, degrees east. Preview: London. The clock stays UK time (GMT/BST) whatever the place.")
  longitudeDeg: number = -0.1278

  @input
  @hint("Compass azimuth of world -Z (the way the user faces at start). Preview constant.")
  minusZAzimuthDeg: number = 200

  @input
  @hint("+1, or -1 if the heading source turns the other way (preview sign-flip constant).")
  headingSign: number = 1
  @ui.group_end

  @input
  @hint("Window pinned at start (empty = none until the user pinches one).")
  startWindow: string = ""

  @input
  @hint("If the sun is down or low now at the place, start at this clock time today (HH, MM).")
  demoHour: number = 15

  @input
  demoMinute: number = 10

  @input
  @hint("Calmer: no glides or fades, everything switches at once.")
  reduceMotion: boolean = false

  @input
  @hint("Optional fixed start instant (ISO, e.g. 2026-11-06T15:10:00Z) for demos; empty = start rule.")
  startUtc: string = ""

  @input
  @hint("Season at start: today, dec21 or jun21.")
  startSeason: string = "today"

  @input
  @hint("Label height above the patch (cm).")
  labelHeightCm: number = 25

  @input
  @hint("Label scale (48 pt x 6 = about 4.5 cm cap height).")
  labelScale: number = 6

  private pinned: WindowPin | null = null
  private fixedUtcMs: number | null = null
  private season: Season = "today"
  private sun: SunPosition | null = null
  private toSun: vec3 = new vec3(0, 1, 0)
  private sunUp: boolean = false
  private utcMs: number = 0
  private lastKey: string = ""
  private lastCause: PatchCause = "tick"
  private labelText: string = ""
  private shownText: string = ""
  private labelClass: string = ""
  private shownClass: string = ""
  private labelVisible: boolean = false
  private labelShown: boolean = true
  private labelFade = new Fader(0)
  private labelGate = new Fader(1)
  private labelRise = new Fader(1)
  private labelBase: vec4 = new vec4(1, 1, 1, 1)
  private labelBg: vec4 = new vec4(0.35, 0.42, 0.55, 0.7)
  private labelRevealUntil: number = -1
  private dragging: boolean = false
  private fallback: boolean = false
  private fallbackWhy: string = ""
  private startedAt: number = 0
  private noteText: string = ""
  private hintFade = new Fader(0)
  private hintBase: vec4 = new vec4(1, 1, 1, 1)
  private hintBg: vec4 = new vec4(0.35, 0.42, 0.55, 0.7)

  onAwake(): void {
    if (!this.projector || !this.label || !this.cameraObject) {
      print("SunpatchMain: projector, label and cameraObject inputs are required.")
      return
    }
    ;(global as any).sunpatch = this
    setTweenDriver(this)
    setMotionReduce(this.reduceMotion)
    this.label.getSceneObject().enabled = false
    this.labelBase = this.label.textFill.color
    const bg = this.label.backgroundSettings.fill.color
    this.labelBg = new vec4(bg.x, bg.y, bg.z, 0.7)
    this.label.getSceneObject().getTransform().setLocalScale(vec3.one().uniformScale(this.labelScale))
    if (this.pinchHint) {
      this.hintBase = this.pinchHint.textFill.color
      const hb = this.pinchHint.backgroundSettings.fill.color
      this.hintBg = new vec4(hb.x, hb.y, hb.z, 0.7)
      this.pinchHint.getSceneObject().enabled = false
    }
    WindowPin.onPinned((w) => this.onWindowPinned(w))
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.refresh(false, "tick"))
  }

  private onStart(): void {
    this.startedAt = motionNow()
    this.placeNorthMarker()
    this.useDemoDefault()
    if (this.startUtc) this.setUtc(this.startUtc)
    if (this.startSeason === "dec21" || this.startSeason === "jun21") this.setSeason(this.startSeason)
    this.placePinchHint()
    if (this.startWindow) {
      // Let the first frames draw before the reveal plays.
      const ev = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
      ev.bind(() => this.pinWindow(this.startWindow))
      ev.reset(this.reduceMotion ? 0 : MotionMs.autoPinDelay / 1000)
    }
    this.refresh(true, "time")
  }

  // ── Test API ──────────────────────────────────────────────────────

  /** Pins a window by scene object name (same path as a pinch). Returns false if not found. */
  pinWindow(name: string): boolean {
    const w = WindowPin.byName(name)
    if (!w) return false
    w.pin()
    return true
  }

  /** Test API: back to "nothing pinned" (onboarding). */
  unpin(): void {
    WindowPin.unpinAll()
  }

  /** Outline opacity of a window by name (onboarding breath / pinned mark). */
  getWindowOutline(name: string): number {
    const w = WindowPin.byName(name)
    return w ? w.getOutlineOpacity() : -1
  }

  getPinnedWindowName(): string {
    return this.pinned ? this.pinned.getSceneObject().name : ""
  }

  /** Fixes the clock (place's civil time) on the current date. */
  setTime(hours: number, minutes: number): void {
    this.setClock(hours, minutes, "time")
  }

  /** Fixes the date (place's civil date) at the current clock time; the season goes back to Today. */
  setDate(year: number, month: number, day: number): void {
    const base = this.baseUtcMs()
    const off = this.offsetMin(base)
    const clockMs = ((base + off * MS_MIN) % MS_DAY + MS_DAY) % MS_DAY
    const ms = this.localToUtc(Date.UTC(year, month - 1, day) + clockMs)
    if (!isFinite(ms)) { print("SunpatchMain: bad date " + year + "-" + month + "-" + day); return }
    this.fixedUtcMs = ms
    this.season = "today"
    this.refresh(true, "time")
  }

  /** Fixes the instant (UTC ms or an ISO string). An invalid time is refused (the clock stays). */
  setUtc(t: number | string): boolean {
    const ms = typeof t === "string" ? Date.parse(t) : t
    if (typeof ms !== "number" || !isFinite(ms)) {
      print("SunpatchMain: bad time \"" + t + "\" (use ISO, e.g. 2026-11-06T15:10:00Z); kept " + this.getLocalClock())
      return false
    }
    this.fixedUtcMs = ms
    this.refresh(true, "time")
    return true
  }

  /** Back to the real current time. */
  useNow(): void {
    this.fixedUtcMs = null
    this.refresh(true, "time")
  }

  /**
   * The start rule: real current time, but if the sun is down, low (under 6 deg) or its light
   * through the window you face would land outside the room, 15:10 today (place's date).
   * Season back to Today. Returns true if the 15:10 fallback was used.
   */
  useDemoDefault(): boolean {
    this.season = "today"
    this.fixedUtcMs = null
    const now = Date.now()
    const s = solarPosition(this.latitudeDeg, this.longitudeDeg, now)
    const win = this.pinned || this.facedWindow()
    const dir = towardSun(s.azimuthDeg, s.altitudeDeg, this.getNorthFrame())
    let why = ""
    if (s.altitudeDeg <= 0) why = "down"
    else if (s.altitudeDeg <= this.projector.fadeBelowDeg) why = "low"
    else if (win && !this.projector.wouldLight(win.getGeometry(), dir, s.altitudeDeg)) why = "outside"
    this.fallback = why !== ""
    this.fallbackWhy = why
    if (!this.fallback) {
      this.refresh(true, "time")
      return false
    }
    this.setTime(this.demoHour, this.demoMinute)
    return true
  }

  /** Whether the start rule fell back to 15:10, and why ("down", "low", "outside" or ""). */
  wasFallbackStart(): { used: boolean, why: string } {
    return { used: this.fallback, why: this.fallbackWhy }
  }

  /** Calmer motion: glides and fades become instant. */
  setReduceMotion(on: boolean): void {
    this.reduceMotion = on
    setMotionReduce(on)
    if (on) {
      this.labelFade.jump(this.labelTarget())
      this.labelGate.jump(1)
      this.labelRise.jump(1)
      this.applyLabelText()
      this.refresh(true, this.lastCause)
    }
  }

  getReduceMotion(): boolean {
    return this.reduceMotion
  }

  /** Called by GazeDisclosure: whether the user is looking where the label belongs. */
  setLabelShown(on: boolean): void {
    this.labelShown = on
  }

  /** The label has something to say (independent of gaze). */
  isLabelAvailable(): boolean {
    return this.labelVisible
  }

  /** Where the label sits: "floor" (above the patch), "window", or "" (none). */
  getLabelPlace(): string {
    if (!this.labelVisible) return ""
    return this.classOf() === "lit" ? "floor" : "window"
  }

  /** Current label opacity, 0..1. */
  getLabelOpacity(): number {
    return this.labelFade.value * this.labelGate.value
  }

  /** World position of the label (where it is drawn now). */
  getLabelWorld(): vec3 {
    return this.label.getSceneObject().getTransform().getWorldPosition()
  }

  /** Sets the clock (minutes after local midnight, fractional ok) on the current date. */
  setClockMinutes(min: number): void {
    const h = Math.floor(min / 60)
    this.setClock(h, min - h * 60, this.dragging ? "drag" : "time")
  }

  /** Set by SunArcUI while the sun is held (the patch follows on its spring; rays stay). */
  setDragging(on: boolean): void {
    this.dragging = on
    this.projector.setDragging(on)
  }

  isDragging(): boolean {
    return this.dragging
  }

  /** Local clock of the computed instant, in minutes after midnight. */
  getClockMinutes(): number {
    const off = this.offsetMin(this.utcMs)
    const local = ((this.utcMs + off * MS_MIN) % MS_DAY + MS_DAY) % MS_DAY
    return local / MS_MIN
  }

  /**
   * The computed day: sunrise / sunset / solar noon (UTC ms, NaN if none), local midnight (UTC ms)
   * and a key that changes when the day or season changes.
   */
  getDayInfo(): { sunriseMs: number, sunsetMs: number, noonMs: number, midnightUtcMs: number, key: string } {
    const t = sunTimes(this.latitudeDeg, this.longitudeDeg, this.localDayUtcAnchor())
    const off = this.offsetMin(this.utcMs)
    const localDay = Math.floor((this.utcMs + off * MS_MIN) / MS_DAY) * MS_DAY
    return { sunriseMs: t.sunriseMs, sunsetMs: t.sunsetMs, noonMs: t.solarNoonMs,
      midnightUtcMs: this.localToUtc(localDay), key: this.season + "|" + localDay }
  }

  /** Unit vector toward the sun at a UTC instant, with its altitude. */
  towardSunAt(utcMs: number): { dir: vec3, altitude: number } {
    const s = solarPosition(this.latitudeDeg, this.longitudeDeg, utcMs)
    return { dir: towardSun(s.azimuthDeg, s.altitudeDeg, this.getNorthFrame()), altitude: s.altitudeDeg }
  }

  /** Clock "HH:MM" (place's civil time) of a UTC instant. */
  clockOf(utcMs: number): string {
    return formatClock(utcMs, this.offsetMin(utcMs))
  }

  /** The window currently pinned (null if none). */
  getPinnedWindow(): WindowPin | null {
    return this.pinned
  }

  setSeason(s: Season): void {
    if (s !== "today" && s !== "dec21" && s !== "jun21") return
    const changed = s !== this.season
    this.season = s
    this.refresh(true, changed ? "season" : "time")
  }

  /** Today -> Dec 21 -> Jun 21 -> Today. Returns the new season. */
  cycleSeason(): Season {
    this.setSeason(this.season === "today" ? "dec21" : this.season === "dec21" ? "jun21" : "today")
    return this.season
  }

  getSeason(): Season {
    return this.season
  }

  /** Why the patch was last recomputed (pin, season, time, drag, tick). */
  getLastPatchCause(): PatchCause {
    return this.lastCause
  }

  getSunAltAz(): { altitude: number, azimuth: number, geometricAltitude: number } {
    const s = this.sun
    return s ? { altitude: s.altitudeDeg, azimuth: s.azimuthDeg, geometricAltitude: s.geometricAltitudeDeg }
      : { altitude: NaN, azimuth: NaN, geometricAltitude: NaN }
  }

  /** The sun is between the NOAA sunrise and sunset of the computed day. */
  isSunUp(): boolean {
    return this.sunUp
  }

  getTowardSun(): vec3 {
    return this.toSun
  }

  getPatchState(): PatchState {
    return this.projector.getLast().state
  }

  getPatchCorners(): vec3[] {
    return this.projector.getLast().corners.slice()
  }

  getPatchPolygon(): vec3[] {
    return this.projector.getLast().polygon.slice()
  }

  isPatchVisible(): boolean {
    return this.projector.isVisible()
  }

  getPatchAlpha(): number {
    return this.projector.getAlpha()
  }

  /** Largest distance (cm) between the drawn patch and where it is going (0 when settled). */
  getPatchGlideError(): number {
    return this.projector.getGlideError()
  }

  /** Opacity the patch is going toward. */
  getPatchTargetAlpha(): number {
    return this.projector.getTargetAlpha()
  }

  /** What the label says (updated at once; the drawn text follows after a crossfade). */
  getLabel(): string {
    return this.labelText
  }

  /** The label is on screen: it has something to say and the gaze is where it belongs. */
  isLabelVisible(): boolean {
    return this.labelVisible && this.labelShown
  }

  getWindowCorners(): vec3[] {
    return this.pinned ? this.pinned.getGeometry().corners : []
  }

  getPatchPlaneY(): number {
    return this.projector.getPatchPlaneY()
  }

  /** The instant the sun is computed for (season applied). */
  getUtcMs(): number {
    return this.utcMs
  }

  /** "HH:MM" in the place's civil time for the computed instant. */
  getLocalClock(): string {
    return formatClock(this.utcMs, this.offsetMin(this.utcMs))
  }

  getSunTimes(): { sunrise: string, sunset: string, noon: string } {
    const t = sunTimes(this.latitudeDeg, this.longitudeDeg, this.localDayUtcAnchor())
    const f = (ms: number) => isNaN(ms) ? "--:--" : formatClock(ms, this.offsetMin(ms))
    return { sunrise: f(t.sunriseMs), sunset: f(t.sunsetMs), noon: f(t.solarNoonMs) }
  }

  getNorthFrame(): NorthFrame {
    return { minusZAzimuthDeg: this.minusZAzimuthDeg, headingSign: this.headingSign }
  }

  /** "Today", or the date ("Nov 5", "Dec 21") of the computed day. */
  getDateTag(): string {
    return this.dateTag()
  }

  /** Test API: runs the start rule again and restarts the 6 s note, as at Lens start. */
  replayStart(): boolean {
    this.startedAt = motionNow()
    const used = this.useDemoDefault()
    this.updateNote()
    return used
  }

  /** What the standing preview note says now. */
  getPreviewNoteText(): string {
    return this.noteText
  }

  /** The "Pinch a window" hint is on screen. */
  isPinchHintShown(): boolean {
    return !!this.pinchHint && this.pinchHint.getSceneObject().enabled && this.hintFade.value > 0.001
  }

  // ── Internals ─────────────────────────────────────────────────────

  private onWindowPinned(w: WindowPin | null): void {
    const fresh = !!w && w !== this.pinned
    this.pinned = w
    if (fresh) {
      // Label comes after the patch has started (stagger), rising 1 cm.
      this.labelFade.jump(0)
      this.labelRise.jump(0)
      this.labelRise.start(1, MotionMs.labelIn, easeOut, MotionMs.labelDelay)
      this.labelRevealUntil = motionNow() + sec(MotionMs.labelDelay)
    }
    this.refresh(true, w ? "pin" : "time")
  }

  private setClock(hours: number, minutes: number, cause: PatchCause): void {
    if (!isFinite(hours) || !isFinite(minutes)) { print("SunpatchMain: bad clock " + hours + ":" + minutes); return }
    const base = this.baseUtcMs()
    const off = this.offsetMin(base)
    const localDay = Math.floor((base + off * MS_MIN) / MS_DAY) * MS_DAY
    this.fixedUtcMs = this.localToUtc(localDay + (hours * 60 + minutes) * MS_MIN)
    this.refresh(true, cause)
  }

  /** The window the user faces at start (its inside normal points most toward the camera). */
  private facedWindow(): WindowPin | null {
    const cam = this.cameraObject.getTransform()
    const fwd = cam.getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
    let best: WindowPin | null = null
    let bestDot = 0
    for (const w of WindowPin.all()) {
      const d = w.getGeometry().intoRoom.dot(fwd)
      if (d < bestDot) { bestDot = d; best = w }
    }
    return best
  }

  private offsetMin(utcMs: number): number {
    return ukOffsetMinutes(utcMs)
  }

  /** Local wall-clock ms (as if UTC) -> UTC ms, using the offset in force at that time. */
  private localToUtc(localMs: number): number {
    const guess = localMs - this.offsetMin(localMs) * MS_MIN
    return localMs - this.offsetMin(guess) * MS_MIN
  }

  private baseUtcMs(): number {
    return this.fixedUtcMs !== null ? this.fixedUtcMs : Date.now()
  }

  /** The instant to compute: the base instant, moved to Dec 21 / Jun 21 at the same clock time. */
  private effectiveUtcMs(): number {
    const base = this.baseUtcMs()
    if (this.season === "today") return base
    const local = new Date(base + this.offsetMin(base) * MS_MIN)
    const clockMs = ((local.getTime() % MS_DAY) + MS_DAY) % MS_DAY
    const month0 = this.season === "dec21" ? 11 : 5
    return this.localToUtc(Date.UTC(local.getUTCFullYear(), month0, 21) + clockMs)
  }

  /** UTC ms at local noon of the computed day (for sunrise/sunset of that civil date). */
  private localDayUtcAnchor(): number {
    const off = this.offsetMin(this.utcMs)
    const localDay = Math.floor((this.utcMs + off * MS_MIN) / MS_DAY) * MS_DAY
    return localDay + 12 * 3600000 - off * MS_MIN
  }

  private dateTag(): string {
    if (this.season === "dec21") return "Dec 21"
    if (this.season === "jun21") return "Jun 21"
    const now = Date.now()
    const a = new Date(this.utcMs + this.offsetMin(this.utcMs) * MS_MIN)
    const b = new Date(now + this.offsetMin(now) * MS_MIN)
    if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
        && a.getUTCDate() === b.getUTCDate()) return "Today"
    return MONTHS[a.getUTCMonth()] + " " + a.getUTCDate()
  }

  private refresh(force: boolean, cause: PatchCause): void {
    if (!this.projector) return
    this.utcMs = this.effectiveUtcMs()
    const key = (this.pinned ? this.pinned.getSceneObject().name : "-") + "|" + Math.floor(this.utcMs / 10000)
    if (force || key !== this.lastKey) {
      this.lastKey = key
      this.lastCause = cause
      this.sun = solarPosition(this.latitudeDeg, this.longitudeDeg, this.utcMs)
      this.toSun = towardSun(this.sun.azimuthDeg, this.sun.altitudeDeg, this.getNorthFrame())
      const day = this.getDayInfo()
      this.sunUp = isNaN(day.sunriseMs) || isNaN(day.sunsetMs)
        ? this.sun.altitudeDeg > -0.833
        : this.utcMs >= day.sunriseMs && this.utcMs < day.sunsetMs
      const geom = this.pinned ? this.pinned.getGeometry() : null
      this.projector.project(geom, this.toSun, this.sun.altitudeDeg, this.sunUp, cause)
      this.updateLabelText()
    }
    this.placeLabel()
    this.updateNote()
    this.updatePinchHint()
  }

  private classOf(): string {
    const r = this.projector.getLast()
    if (r.state === "lit") return r.polygon.length >= 3 ? "lit" : "beyond"
    return r.state
  }

  private updateLabelText(): void {
    const r = this.projector.getLast()
    const clock = this.getLocalClock() + " · " + this.dateTag()
    const cls = this.classOf()
    if (r.state === "none") {
      this.labelText = ""
    } else if (r.state === "set") {
      const t = this.getSunTimes()
      const day = this.getDayInfo()
      const afterNoon = !isNaN(day.noonMs) ? this.utcMs > day.noonMs : this.getLocalClock() > t.noon
      this.labelText = (afterNoon ? "Sun has set\nSunset " + t.sunset : "Sun not up yet\nSunrise " + t.sunrise) + "\n" + clock
    } else if (r.state === "noDirect") {
      this.labelText = "No direct sun\n" + clock
    } else if (cls === "beyond") {
      this.labelText = "Sun lands beyond this room\n" + clock
    } else {
      this.labelText = clock
    }
    this.labelClass = cls
    const showing = this.label.getSceneObject().enabled && this.getLabelOpacity() > 0.001
    if (this.shownClass !== cls && showing && this.shownClass !== "") {
      // Kind changed while on screen: fade out, swap, fade in (no slide across the room).
      this.labelGate.start(0, MotionMs.labelSwapOut, easeIn)
    } else if (this.labelGate.target === 1) {
      this.applyLabelText()
    }
  }

  private applyLabelText(): void {
    this.shownText = this.labelText
    this.shownClass = this.labelClass
    this.label.text = this.shownText
  }

  private labelTarget(): number {
    return this.labelVisible && this.labelShown ? 1 : 0
  }

  /** Label above the drawn patch, or in front of the window; turned toward the eye. */
  private placeLabel(): void {
    const so = this.label.getSceneObject()
    this.labelVisible = this.projector.getLast().state !== "none" && this.labelText.length > 0
    if (motionNow() >= this.labelRevealUntil) this.labelFade.set(this.labelTarget(), MotionMs.gazeIn, MotionMs.gazeOut)
    this.labelFade.step()
    this.labelRise.step()
    if (this.labelGate.target === 0 && this.labelGate.step() <= 0) {
      this.applyLabelText()
      this.labelGate.start(1, MotionMs.labelSwapIn, easeOut)
    }
    this.labelGate.step()
    const a = this.getLabelOpacity()
    const b = this.labelBase
    this.label.textFill.color = new vec4(b.x, b.y, b.z, b.w * a)
    const bg = this.labelBg
    this.label.backgroundSettings.fill.color = new vec4(bg.x, bg.y, bg.z, bg.w * a)
    so.enabled = this.labelVisible && a > 0.001
    if (!so.enabled || !this.pinned) return
    let pos: vec3
    if (this.shownClass === "lit") {
      pos = this.projector.getDrawnCenter().add(new vec3(0, this.labelHeightCm - (1 - this.labelRise.value) * MotionCm.labelRise, 0))
    } else {
      const g = this.pinned.getGeometry()
      pos = g.center.add(g.intoRoom.uniformScale(15))
    }
    const t = so.getTransform()
    t.setWorldPosition(pos)
    t.setWorldRotation(this.faceEye(pos, this.shownClass === "lit"))
  }

  /** Rotation that turns a Text's +Z toward the camera (yaw, plus pitch when asked). */
  private faceEye(pos: vec3, pitch: boolean): quat {
    const cam = this.cameraObject.getTransform().getWorldPosition()
    const d = cam.sub(pos)
    const yawQ = quat.angleAxis(Math.atan2(d.x, d.z), vec3.up())
    if (!pitch) return yawQ
    const p = Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z))
    return yawQ.multiply(quat.angleAxis(-p, vec3.right()))
  }

  /** Standing preview note: "Preview · London · north assumed" (+ the 15:10 fallback for 6 s). */
  private updateNote(): void {
    if (!this.previewNote) return
    let text = NOTE
    if (this.fallback && (motionNow() - this.startedAt) * 1000 < HONEST_MS) {
      const demo = pad2(this.demoHour) + ":" + pad2(this.demoMinute)
      text += this.fallbackWhy === "down" ? "\nSun is down now, showing " + demo
        : this.fallbackWhy === "low" ? "\nSun is low now, showing " + demo
        : "\nSun lands outside this room now, showing " + demo
    }
    if (text !== this.noteText) {
      this.noteText = text
      this.previewNote.text = text
    }
    const t = this.previewNote.getSceneObject().getTransform()
    t.setWorldRotation(this.faceEye(t.getWorldPosition(), false))
  }

  /** Places "Pinch a window" 25 cm above the window the user faces. */
  private placePinchHint(): void {
    if (!this.pinchHint) return
    const w = this.facedWindow()
    if (!w) return
    const g = w.getGeometry()
    const pos = g.center.add(g.up.uniformScale(g.heightCm / 2 + 25)).add(g.intoRoom.uniformScale(6))
    const t = this.pinchHint.getSceneObject().getTransform()
    t.setWorldPosition(pos)
    t.setWorldRotation(this.faceEye(pos, false))
  }

  private updatePinchHint(): void {
    if (!this.pinchHint) return
    this.hintFade.set(this.pinned ? 0 : 1, MotionMs.hintIn, MotionMs.hintOut)
    const a = this.hintFade.step()
    const b = this.hintBase
    this.pinchHint.textFill.color = new vec4(b.x, b.y, b.z, b.w * a)
    const bg = this.hintBg
    this.pinchHint.backgroundSettings.fill.color = new vec4(bg.x, bg.y, bg.z, bg.w * a)
    this.pinchHint.getSceneObject().enabled = a > 0.001
  }

  private placeNorthMarker(): void {
    if (!this.northMarker) return
    const yaw = yawFacingAzimuth(0, this.getNorthFrame())
    this.northMarker.getTransform().setWorldRotation(quat.angleAxis(yaw, vec3.up()))
  }
}

function pad2(n: number): string {
  const v = Math.floor(n)
  return (v < 10 ? "0" : "") + v
}

/**
 * SunpatchMain — state of the Lens and the test API.
 *
 * State: the place (preview: London, said on screen), the time (the real current time by
 * default, or a fixed instant), the season (Today / Dec 21 / Jun 21, same clock time), the room's
 * north alignment, and the pinned window. Every frame the sun position is computed (NOAA,
 * SolarPosition.ts), turned into a scene direction (SunFrame.ts), and the patch is projected from
 * the pinned window to the floor (PatchProjector.ts). The label sits 10 cm above the patch, or at
 * the window when there is no patch ("Sun has set", "No direct sun").
 *
 * Times are shown in the place's civil time (preview: UK time, GMT/BST).
 *
 * Test API (also published as global.sunpatch): pinWindow, getPinnedWindowName, setTime,
 * setUtc, setDate, useNow, setSeason, cycleSeason, getSeason, getSunAltAz, getTowardSun,
 * getPatchState, getPatchCorners, getPatchPolygon, isPatchVisible, getPatchAlpha, getLabel,
 * isLabelVisible, getWindowCorners, getPatchPlaneY, getUtcMs, getLocalClock, getSunTimes,
 * getNorthFrame.
 */
import { formatClock, solarPosition, sunTimes, SunPosition, ukOffsetMinutes } from "./SolarPosition"
import { NorthFrame, towardSun, yawFacingAzimuth } from "./SunFrame"
import { WindowPin } from "./WindowPin"
import { PatchProjector, PatchState } from "./PatchProjector"

export type Season = "today" | "dec21" | "jun21"

const MS_MIN = 60000
const MS_DAY = 86400000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

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
  @ui.group_end

  @ui.group_start("Place (preview stand-in)")
  @input
  @hint("Latitude, degrees north. Preview: London.")
  latitudeDeg: number = 51.5074

  @input
  @hint("Longitude, degrees east. Preview: London.")
  longitudeDeg: number = -0.1278

  @input
  @hint("Compass azimuth of world -Z (the way the user faces at start). Preview constant.")
  minusZAzimuthDeg: number = 165

  @input
  @hint("+1, or -1 if the heading source turns the other way (preview sign-flip constant).")
  headingSign: number = 1
  @ui.group_end

  @input
  @hint("Window pinned at start (empty = none until the user pinches one).")
  startWindow: string = ""

  private pinned: WindowPin | null = null
  private fixedUtcMs: number | null = null
  private season: Season = "today"
  private sun: SunPosition | null = null
  private toSun: vec3 = new vec3(0, 1, 0)
  private utcMs: number = 0
  private lastKey: string = ""
  private labelText: string = ""
  private labelVisible: boolean = false

  onAwake(): void {
    if (!this.projector || !this.label || !this.cameraObject) {
      print("SunpatchMain: projector, label and cameraObject inputs are required.")
      return
    }
    ;(global as any).sunpatch = this
    this.label.getSceneObject().enabled = false
    WindowPin.onPinned((w) => this.onWindowPinned(w))
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.refresh(false))
  }

  private onStart(): void {
    this.placeNorthMarker()
    if (this.startWindow) this.pinWindow(this.startWindow)
    this.refresh(true)
  }

  // ── Test API ──────────────────────────────────────────────────────

  /** Pins a window by scene object name (same path as a pinch). Returns false if not found. */
  pinWindow(name: string): boolean {
    const w = WindowPin.byName(name)
    if (!w) return false
    w.pin()
    return true
  }

  getPinnedWindowName(): string {
    return this.pinned ? this.pinned.getSceneObject().name : ""
  }

  /** Fixes the clock (place's civil time) on the current date. */
  setTime(hours: number, minutes: number): void {
    const base = this.baseUtcMs()
    const off = this.offsetMin(base)
    const localDay = Math.floor((base + off * MS_MIN) / MS_DAY) * MS_DAY
    this.fixedUtcMs = this.localToUtc(localDay + (hours * 60 + minutes) * MS_MIN)
    this.refresh(true)
  }

  /** Fixes the date (place's civil date) at the current clock time; the season goes back to Today. */
  setDate(year: number, month: number, day: number): void {
    const base = this.baseUtcMs()
    const off = this.offsetMin(base)
    const clockMs = ((base + off * MS_MIN) % MS_DAY + MS_DAY) % MS_DAY
    this.fixedUtcMs = this.localToUtc(Date.UTC(year, month - 1, day) + clockMs)
    this.season = "today"
    this.refresh(true)
  }

  /** Fixes the instant (UTC ms or an ISO string). */
  setUtc(t: number | string): void {
    this.fixedUtcMs = typeof t === "string" ? Date.parse(t) : t
    this.refresh(true)
  }

  /** Back to the real current time. */
  useNow(): void {
    this.fixedUtcMs = null
    this.refresh(true)
  }

  setSeason(s: Season): void {
    this.season = s
    this.refresh(true)
  }

  /** Today -> Dec 21 -> Jun 21 -> Today. Returns the new season. */
  cycleSeason(): Season {
    this.season = this.season === "today" ? "dec21" : this.season === "dec21" ? "jun21" : "today"
    this.refresh(true)
    return this.season
  }

  getSeason(): Season {
    return this.season
  }

  getSunAltAz(): { altitude: number, azimuth: number, geometricAltitude: number } {
    const s = this.sun
    return s ? { altitude: s.altitudeDeg, azimuth: s.azimuthDeg, geometricAltitude: s.geometricAltitudeDeg }
      : { altitude: NaN, azimuth: NaN, geometricAltitude: NaN }
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

  getLabel(): string {
    return this.labelText
  }

  isLabelVisible(): boolean {
    return this.labelVisible
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

  // ── Internals ─────────────────────────────────────────────────────

  private onWindowPinned(w: WindowPin): void {
    this.pinned = w
    this.refresh(true)
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
    const clockMs = local.getTime() % MS_DAY
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
        && a.getUTCDate() === b.getUTCDate()) return "today"
    return MONTHS[a.getUTCMonth()] + " " + a.getUTCDate()
  }

  private refresh(force: boolean): void {
    if (!this.projector) return
    this.utcMs = this.effectiveUtcMs()
    const key = (this.pinned ? this.pinned.getSceneObject().name : "-") + "|" + Math.floor(this.utcMs / 10000)
    if (force || key !== this.lastKey) {
      this.lastKey = key
      this.sun = solarPosition(this.latitudeDeg, this.longitudeDeg, this.utcMs)
      this.toSun = towardSun(this.sun.azimuthDeg, this.sun.altitudeDeg, this.getNorthFrame())
      const geom = this.pinned ? this.pinned.getGeometry() : null
      this.projector.project(geom, this.toSun, this.sun.altitudeDeg)
      this.updateLabelText()
    }
    this.placeLabel()
  }

  private updateLabelText(): void {
    const r = this.projector.getLast()
    const clock = this.getLocalClock() + " · " + this.dateTag()
    if (r.state === "none") {
      this.labelText = ""
    } else if (r.state === "set") {
      const t = this.getSunTimes()
      const afterNoon = this.getLocalClock() > t.noon
      this.labelText = afterNoon ? "Sun has set\nSunset " + t.sunset : "Sun not up yet\nSunrise " + t.sunrise
    } else if (r.state === "noDirect") {
      this.labelText = "No direct sun\n" + clock
    } else if (r.polygon.length < 3) {
      this.labelText = "Sun lands beyond this room\n" + clock
    } else {
      this.labelText = clock
    }
    this.label.text = this.labelText
  }

  /** Label 10 cm above the patch, or in front of the window; turned toward the camera (yaw only). */
  private placeLabel(): void {
    const r = this.projector.getLast()
    const so = this.label.getSceneObject()
    this.labelVisible = r.state !== "none" && this.labelText.length > 0
    so.enabled = this.labelVisible
    if (!this.labelVisible || !this.pinned) return
    let pos: vec3
    if (r.state === "lit" && r.polygon.length >= 3) {
      pos = r.center.add(new vec3(0, 10, 0))
    } else {
      const g = this.pinned.getGeometry()
      pos = g.center.add(g.intoRoom.uniformScale(15))
    }
    const t = so.getTransform()
    t.setWorldPosition(pos)
    const cam = this.cameraObject.getTransform().getWorldPosition()
    const d = cam.sub(pos)
    const yaw = Math.atan2(d.x, d.z)
    t.setWorldRotation(quat.angleAxis(yaw, vec3.up()))
  }

  private placeNorthMarker(): void {
    if (!this.northMarker) return
    const yaw = yawFacingAzimuth(0, this.getNorthFrame())
    this.northMarker.getTransform().setWorldRotation(quat.angleAxis(yaw, vec3.up()))
  }
}

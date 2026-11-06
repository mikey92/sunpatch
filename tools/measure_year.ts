/**
 * measure_year.ts — what the Lens would show at this window, over a whole year.
 *
 * Uses the Lens's own sun code (Assets/Scripts/SolarPosition.ts) and the same geometry as
 * PatchProjector: the window's four corners pushed along the sunlight to the floor (and to the
 * sofa seat's top), clipped to the room. Same room, window, sofa and north (window wall faces 200°)
 * as the preview scene. Run: node tools/measure_year.ts
 *
 * Checks itself against the LEAF scenarios first (C4: Dec 21 noon centroid 345.2 cm into the
 * room, Jun 21 noon 38.3 cm), then prints the year.
 */
import { solarPosition, ukOffsetMinutes } from "../Assets/Scripts/SolarPosition.ts"

type V = [number, number, number]
const DEG = Math.PI / 180
const LONDON = { lat: 51.5074, lon: -0.1278 }
const MINUS_Z_AZ = 200
const WIN: V[] = [[-60, -110, -350], [60, -110, -350], [60, -10, -350], [-60, -10, -350]]
const FLOOR_Y = -159
const ROOM = [-250, 250, -350, 200]
const SEAT = { y: -114.5, rect: [10, 170, -90, -10] }

function towardSun(az: number, alt: number): V {
  const a = (az - MINUS_Z_AZ) * DEG
  const c = Math.cos(alt * DEG)
  return [Math.sin(a) * c, Math.sin(alt * DEG), -Math.cos(a) * c]
}

/** Sutherland–Hodgman clip against an x/z rectangle (same as the Lens's clipToRect). */
function clip(pts: V[], r: number[]): V[] {
  const edges: [number, number, boolean][] = [[0, r[0], true], [0, r[1], false], [2, r[2], true], [2, r[3], false]]
  let out = pts
  for (const [ax, lim, keepGreater] of edges) {
    const inp = out; out = []
    const inside = (p: V) => keepGreater ? p[ax] >= lim : p[ax] <= lim
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length]
      const ia = inside(a), ib = inside(b)
      if (ia) out.push(a)
      if (ia !== ib) {
        const t = (lim - a[ax]) / (b[ax] - a[ax])
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
      }
    }
  }
  return out
}

function area(p: V[]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[2] - b[0] * a[2] }
  return Math.abs(s) / 2
}

function centroidZ(p: V[]): number { return p.reduce((s, q) => s + q[2], 0) / p.length }

/** Light on the floor and on the seat at a UTC instant, or null when there is no direct sun. */
function light(utcMs: number, lat = LONDON.lat, lon = LONDON.lon) {
  const s = solarPosition(lat, lon, utcMs)
  if (s.altitudeDeg <= 0) return null
  const ts = towardSun(s.azimuthDeg, s.altitudeDeg)
  if (-ts[2] <= 1e-4) return null // sun behind the window wall
  const L: V = [-ts[0], -ts[1], -ts[2]]
  const onPlane = (y: number) => WIN.map((c) => { const k = (y - c[1]) / L[1]; return [c[0] + L[0] * k, y, c[2] + L[2] * k] as V })
  const floor = clip(onPlane(FLOOR_Y), ROOM)
  const seat = clip(onPlane(SEAT.y), SEAT.rect)
  return { floor, seat, alt: s.altitudeDeg }
}

/** UTC ms for a UK clock time on a date (the Lens keeps UK time). */
function ukClock(y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m, d, hh, mm)
  return guess - ukOffsetMinutes(guess - 60 * 60000) * 60000
}

// 1. Self-check against LEAF C4.
const dec = light(ukClock(2026, 11, 21, 12, 0))!
const jun = light(ukClock(2026, 5, 21, 12, 0))!
const decIn = centroidZ(dec.floor) + 350, junIn = centroidZ(jun.floor) + 350
console.log(`check vs LEAF C4: Dec 21 noon centroid ${decIn.toFixed(1)} cm (LEAF 345.2), Jun 21 noon ${junIn.toFixed(1)} cm (LEAF 38.3)`)
if (Math.abs(decIn - 345.2) > 1 || Math.abs(junIn - 38.3) > 1) { console.log("MISMATCH with the Lens"); process.exit(1) }

// 2. The year at this window: the 21st of each month, every minute of the UK day.
const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
console.log("\nmonth | direct sun on the floor | on the sofa seat | deepest reach into the room")
for (let m = 0; m < 12; m++) {
  let floorMin = 0, seatMin = 0, seatFrom = -1, seatTo = -1, floorFrom = -1, floorTo = -1, reach = 0
  for (let t = 5 * 60; t <= 21 * 60; t++) {
    const l = light(ukClock(2026, m, 21, Math.floor(t / 60), t % 60))
    if (!l) continue
    if (area(l.floor) > 100) { floorMin++; if (floorFrom < 0) floorFrom = t; floorTo = t; reach = Math.max(reach, Math.max(...l.floor.map((p) => p[2])) + 350) }
    if (area(l.seat) > 100) { seatMin++; if (seatFrom < 0) seatFrom = t; seatTo = t }
  }
  const seat = seatMin ? `${fmt(seatFrom)}–${fmt(seatTo)} (${seatMin} min)` : "none"
  const fl = floorMin ? `${fmt(floorFrom)}–${fmt(floorTo)}` : "none"
  console.log(`${names[m]} 21 | ${fl} | ${seat} | ${(reach / 100).toFixed(1)} m`)
}

// 3. The same room elsewhere: how far the Dec 21 and Jun 21 light reaches at local solar noon.
console.log("\nsame window, other cities: centroid of the light at local solar noon, metres into the room")
const cities: [string, number, number][] = [["London", 51.51, -0.13], ["Seoul", 37.57, 126.98], ["San Diego", 32.72, -117.16], ["Oslo", 59.91, 10.75]]
for (const [name, lat, lon] of cities) {
  const at = (m: number) => {
    let best = -1, bestMs = 0
    for (let t = 0; t < 24 * 60; t += 2) { const ms = Date.UTC(2026, m, 21) + t * 60000; const a = solarPosition(lat, lon, ms).altitudeDeg; if (a > best) { best = a; bestMs = ms } }
    const l = light(bestMs, lat, lon)
    return l && l.floor.length >= 3 ? `${((centroidZ(l.floor) + 350) / 100).toFixed(2)} m (sun ${best.toFixed(0)}°)` : "no direct sun on the floor"
  }
  console.log(`${name.padEnd(10)} Dec 21: ${at(11)} | Jun 21: ${at(5)}`)
}

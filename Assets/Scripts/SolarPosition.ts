/**
 * SolarPosition — NOAA solar position algorithm (pure functions, no Lens API).
 *
 * Follows the NOAA Solar Calculator spreadsheet (Meeus-based):
 * https://gml.noaa.gov/grad/solcalc/calcdetails.html
 *
 * Angles in degrees. Azimuth is measured clockwise from true north (0 = N, 90 = E, 180 = S).
 * Altitude is the apparent altitude above the horizon, corrected for atmospheric refraction
 * as in the spreadsheet. Times are UTC milliseconds since the Unix epoch.
 */

export interface SunPosition {
  /** Apparent altitude above the horizon (refraction corrected), degrees. */
  altitudeDeg: number
  /** Geometric altitude (no refraction), degrees. */
  geometricAltitudeDeg: number
  /** Azimuth clockwise from true north, degrees in [0, 360). */
  azimuthDeg: number
  /** Solar declination, degrees. */
  declinationDeg: number
  /** Equation of time, minutes. */
  equationOfTimeMin: number
}

export interface SunTimes {
  /** Sunrise / sunset / solar noon in UTC ms. NaN for sunrise/sunset on polar day or night. */
  sunriseMs: number
  sunsetMs: number
  solarNoonMs: number
  /** True if the sun never sets (polar day) or never rises (polar night) on that date. */
  polarDay: boolean
  polarNight: boolean
}

const DEG = Math.PI / 180
const MS_PER_DAY = 86400000

function rad(d: number): number { return d * DEG }
function deg(r: number): number { return r / DEG }

/** Julian day for a UTC instant. */
export function julianDay(utcMs: number): number {
  return utcMs / MS_PER_DAY + 2440587.5
}

interface SolarCore { declinationDeg: number, equationOfTimeMin: number }

/** Declination and equation of time for a Julian century (NOAA spreadsheet columns G..V). */
function solarCore(T: number): SolarCore {
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T)
    + Math.sin(rad(3 * M)) * 0.000289
  const trueLong = L0 + C
  const omega = 125.04 - 1934.136 * T
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega))
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(rad(omega))
  const declinationDeg = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(appLong))))
  const y = Math.tan(rad(eps / 2)) * Math.tan(rad(eps / 2))
  const eqTime = 4 * deg(
    y * Math.sin(2 * rad(L0))
    - 2 * e * Math.sin(rad(M))
    + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0))
    - 0.5 * y * y * Math.sin(4 * rad(L0))
    - 1.25 * e * e * Math.sin(2 * rad(M)))
  return { declinationDeg, equationOfTimeMin: eqTime }
}

/** NOAA atmospheric refraction correction (degrees) for a geometric elevation (degrees). */
export function refractionDeg(elevationDeg: number): number {
  const h = elevationDeg
  if (h > 85) return 0
  const te = Math.tan(rad(h))
  let arcsec: number
  if (h > 5) arcsec = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / Math.pow(te, 5)
  else if (h > -0.575) arcsec = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)))
  else arcsec = -20.772 / te
  return arcsec / 3600
}

/** Sun position for a place (latitude north +, longitude east +) at a UTC instant. */
export function solarPosition(latDeg: number, lonDeg: number, utcMs: number): SunPosition {
  const T = (julianDay(utcMs) - 2451545) / 36525
  const core = solarCore(T)
  const dayMs = ((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY
  const minutesUtc = dayMs / 60000
  const trueSolarMin = ((minutesUtc + core.equationOfTimeMin + 4 * lonDeg) % 1440 + 1440) % 1440
  const hourAngle = trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180
  const lat = rad(latDeg)
  const dec = rad(core.declinationDeg)
  const cosZen = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(rad(hourAngle))
  const zenith = deg(Math.acos(Math.max(-1, Math.min(1, cosZen))))
  const geometric = 90 - zenith
  const az = deg(Math.atan2(Math.sin(rad(hourAngle)),
    Math.cos(rad(hourAngle)) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat))) + 180
  return {
    altitudeDeg: geometric + refractionDeg(geometric),
    geometricAltitudeDeg: geometric,
    azimuthDeg: ((az % 360) + 360) % 360,
    declinationDeg: core.declinationDeg,
    equationOfTimeMin: core.equationOfTimeMin,
  }
}

/**
 * Sunrise, sunset and solar noon (UTC ms) for the UTC calendar day containing dayUtcMs.
 * Uses the standard 90.833 deg zenith (refraction + solar disc). Refined by one iteration
 * at the event time, as the NOAA calculator does.
 */
export function sunTimes(latDeg: number, lonDeg: number, dayUtcMs: number): SunTimes {
  const day0 = Math.floor(dayUtcMs / MS_PER_DAY) * MS_PER_DAY
  const noonAt = (guessMs: number): number => {
    const core = solarCore((julianDay(guessMs) - 2451545) / 36525)
    return day0 + (720 - 4 * lonDeg - core.equationOfTimeMin) * 60000
  }
  const solarNoonMs = noonAt(noonAt(day0 + MS_PER_DAY / 2))
  const eventAt = (guessMs: number, rising: boolean): number => {
    const core = solarCore((julianDay(guessMs) - 2451545) / 36525)
    const lat = rad(latDeg)
    const dec = rad(core.declinationDeg)
    const cosH = Math.cos(rad(90.833)) / (Math.cos(lat) * Math.cos(dec)) - Math.tan(lat) * Math.tan(dec)
    if (cosH > 1) return Number.POSITIVE_INFINITY // never rises
    if (cosH < -1) return Number.NEGATIVE_INFINITY // never sets
    const haDeg = deg(Math.acos(cosH))
    const noonMin = 720 - 4 * lonDeg - core.equationOfTimeMin
    return day0 + (noonMin + (rising ? -4 : 4) * haDeg) * 60000
  }
  const r0 = eventAt(solarNoonMs, true)
  const s0 = eventAt(solarNoonMs, false)
  const polarNight = r0 === Number.POSITIVE_INFINITY
  const polarDay = r0 === Number.NEGATIVE_INFINITY
  if (polarDay || polarNight) {
    return { sunriseMs: NaN, sunsetMs: NaN, solarNoonMs, polarDay, polarNight }
  }
  return {
    sunriseMs: eventAt(r0, true),
    sunsetMs: eventAt(s0, false),
    solarNoonMs,
    polarDay: false,
    polarNight: false,
  }
}

/** Last Sunday of a month (UTC date), as day-of-month. */
function lastSunday(year: number, month0: number): number {
  const last = new Date(Date.UTC(year, month0 + 1, 0))
  return last.getUTCDate() - last.getUTCDay()
}

/**
 * UK civil time offset from UTC in minutes for a UTC instant: 60 during British Summer Time
 * (last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC), otherwise 0.
 */
export function ukOffsetMinutes(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear()
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1)
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1)
  return utcMs >= start && utcMs < end ? 60 : 0
}

/** "HH:MM" for a UTC instant shown with a fixed offset (minutes). */
export function formatClock(utcMs: number, offsetMin: number): string {
  const d = new Date(utcMs + offsetMin * 60000)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m
}

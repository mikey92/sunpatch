/**
 * SunFrame — turns a compass azimuth/altitude into a direction in scene (world) space.
 *
 * Scene frame: +Y is up, centimeters. The room's north alignment is one number,
 * `minusZAzimuthDeg`: the compass azimuth (clockwise from north) of the world -Z axis.
 * With identity rotation the camera looks down -Z, so this is "which way the user faces at start".
 *
 * On glasses this number comes from the device heading at start. The preview has no compass,
 * so it is a constant; the "N" floor marker shows where the Lens thinks north is.
 * `headingSign` (+1 or -1) is the preview sign-flip constant from the design: if the heading
 * source turns the other way, flip it and the marker and the patch turn with it.
 */

export interface NorthFrame {
  /** Compass azimuth of world -Z, degrees. */
  minusZAzimuthDeg: number
  /** +1 normally; -1 if the heading source turns the other way. */
  headingSign: number
}

const DEG = Math.PI / 180

/** Horizontal unit vector in world space for a compass azimuth. */
export function horizontalOfAzimuth(azimuthDeg: number, frame: NorthFrame): vec3 {
  const a = frame.headingSign * (azimuthDeg - frame.minusZAzimuthDeg) * DEG
  return new vec3(Math.sin(a), 0, -Math.cos(a))
}

/** Compass azimuth (degrees in [0, 360)) of a world direction (its horizontal part). */
export function azimuthOfWorldDir(dir: vec3, frame: NorthFrame): number {
  const a = Math.atan2(dir.x, -dir.z) / DEG
  const az = frame.minusZAzimuthDeg + a / frame.headingSign
  return ((az % 360) + 360) % 360
}

/** Unit vector pointing from the scene toward the sun. */
export function towardSun(azimuthDeg: number, altitudeDeg: number, frame: NorthFrame): vec3 {
  const h = horizontalOfAzimuth(azimuthDeg, frame)
  const c = Math.cos(altitudeDeg * DEG)
  return new vec3(h.x * c, Math.sin(altitudeDeg * DEG), h.z * c)
}

/** Unit vector of the sunlight's travel (from the sun into the room): -towardSun. */
export function lightDirection(azimuthDeg: number, altitudeDeg: number, frame: NorthFrame): vec3 {
  return towardSun(azimuthDeg, altitudeDeg, frame).uniformScale(-1)
}

/** Yaw (radians, about +Y) that turns world -Z to face the given compass azimuth. */
export function yawFacingAzimuth(azimuthDeg: number, frame: NorthFrame): number {
  const h = horizontalOfAzimuth(azimuthDeg, frame)
  // quat.angleAxis(yaw, up) maps -Z (0,0,-1) to (-sin yaw, 0, -cos yaw).
  return Math.atan2(-h.x, -h.z)
}

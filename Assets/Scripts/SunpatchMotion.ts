/**
 * SunpatchMotion — the one place for Sunpatch's motion (same shape as BeltPath's motion file).
 *
 * Owns: the reduce-motion switch, every motion duration, the easing curves, a small time-based
 * tween runner, a retargetable fader (for gaze-driven fades), a critically damped spring step (the
 * patch following the hand) and the press feedback for the season control. With reduce motion on,
 * every duration is 0, so each tween / fade jumps to its end value in the same frame and the spring
 * snaps to its target. Filters that only remove jitter (gaze dwell, hysteresis, the minute
 * dead band, the arrow's lazy follow) are not motion and stay on with reduce motion.
 *
 * Rules: arriving things ease out, leaving things ease in, things that move to a new place
 * (the season change) ease in-out; only the patch following the hand uses a spring, and it never
 * overshoots (critically damped). Nothing loops except the onboarding outline before the first
 * pin, nothing moves toward the face, no full-screen motion.
 *
 * Must not: own state or decide what shows — callers start tweens, this file only runs them.
 */

let reduce = false

/** Turns reduce motion on/off at runtime (SunpatchMain's @input and test API). */
export function setReduceMotion(on: boolean): void { reduce = on }
export function isReduceMotion(): boolean { return reduce }

/** Every motion duration, in ms. */
export const MotionMs = {
  // 1. Pin: rays -> patch grows from the window side -> label; arc and control after.
  glowIn: 120,
  glowOut: 180,
  pinchDown: 80,
  glowGone: 200,
  rayIn: 150,
  patchDelay: 80,
  patchGrow: 400,
  patchFadeIn: 250,
  labelDelay: 200,
  labelIn: 200,
  controlDelay: 350,
  autoPinDelay: 300,
  /** Rays stay this long after a change (or a drag), then leave (a hold, not an animation). */
  raysHold: 2000,
  rayOut: 200,
  // 2. Drag.
  hoverIn: 120,
  hoverOut: 160,
  grabIn: 100,
  release: 200,
  /** The handle stays this long after the hand lets go (a hold). */
  dragHold: 1000,
  eventLineIn: 150,
  // 3. Season change.
  seasonMorph: 500,
  dotsIn: 120,
  patchCrossOut: 200,
  patchCrossIn: 250,
  arcCrossOut: 150,
  arcCrossGap: 60,
  arcCrossIn: 250,
  press: 120,
  // 4. Sunset / no direct sun.
  setOut: 350,
  relit: 250,
  labelSwapOut: 120,
  labelSwapIn: 200,
  // 5. Gaze.
  gazeIn: 220,
  gazeOut: 160,
  arcHandleStagger: 80,
  arcClockStagger: 140,
  // 6. Off-view arrow.
  arrowIn: 200,
  arrowOut: 150,
  chimeQuiet: 600,
  // Onboarding.
  hintIn: 250,
  hintOut: 250,
  breathePeriod: 1200,
} as const

/** Filters (not motion): kept with reduce motion. */
export const FilterMs = {
  dwellIn: 120,
  dwellOut: 250,
  /** The arrow appears only after the gaze has been elsewhere this long. */
  arrowDwell: 1500,
  /** Lazy follow of the arrow (time constant). */
  arrowFollow: 200,
} as const

/** Distances (cm). */
export const MotionCm = {
  labelRise: 1,
  arrowSlide: 1.5,
} as const

/** Press feedback scale. */
export const PRESS_SCALE = 0.96

/** Patch spring: natural frequency (rad/s), critically damped (98 % settled ~240 ms after the hand stops). */
export const SPRING_OMEGA = 24

let clockOverride: number | null = null

/** Capture only: freeze the motion clock at `t` seconds (null = real time). */
export function debugSetMotionClock(t: number | null): void { clockOverride = t }

/** The motion clock (seconds). */
export function motionNow(): number { return clockOverride === null ? getTime() : clockOverride }

/** Duration in seconds, 0 when reduce motion is on. */
export function sec(ms: number): number { return reduce ? 0 : ms / 1000 }

export type Ease = (t: number) => number
export const linear: Ease = (t) => t
/** Things arriving: 1-(1-t)^3. */
export const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)
/** Things leaving: t^3. */
export const easeIn: Ease = (t) => t * t * t
/** Things moving to a new place. */
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Smooth 0..1 ramp between e0 and e1 (a data ramp, not motion). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-6, e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** First-order follow factor for a frame (filter; time constant tauMs). */
export function followK(dt: number, tauMs: number): number {
  return 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-3, tauMs / 1000))
}

export type TweenOptions = {
  durMs: number
  delayMs?: number
  ease?: Ease
  from?: number
  to?: number
  /** Called with the eased value, once at start (with `from`) and every frame after. */
  onUpdate: (v: number) => void
  onDone?: () => void
}

const active: Tween[] = []
let driver: BaseScriptComponent | null = null

/** Runs every tween from one always-enabled component (SunpatchMain). */
export function setTweenDriver(owner: BaseScriptComponent): void {
  if (driver) return
  driver = owner
  owner.createEvent("UpdateEvent").bind(() => {
    for (const t of active.slice()) t.step()
  })
}

/** One running animation. cancel() stops where it is; finish() jumps to the end. */
export class Tween {
  private ev: SceneEvent | null = null
  private t0: number
  private done = false

  constructor(private owner: BaseScriptComponent, private o: TweenOptions) {
    this.t0 = motionNow() + sec(o.delayMs || 0)
  }

  /** @internal */
  start(): void {
    this.o.onUpdate(this.o.from === undefined ? 0 : this.o.from)
    if (sec(this.o.durMs) <= 0 && sec(this.o.delayMs || 0) <= 0) {
      this.finish()
      return
    }
    active.push(this)
    if (driver) return
    this.ev = this.owner.createEvent("UpdateEvent")
    this.ev.bind(() => this.step())
  }

  isActive(): boolean { return !this.done }

  cancel(): void {
    if (this.done) return
    this.done = true
    this.cleanup()
  }

  finish(): void {
    if (this.done) return
    this.done = true
    this.cleanup()
    this.o.onUpdate(this.o.to === undefined ? 1 : this.o.to)
    if (this.o.onDone) this.o.onDone()
  }

  /** @internal */
  step(): void {
    if (this.done) return
    const d = sec(this.o.durMs)
    const now = motionNow()
    if (now < this.t0) return
    const k = d <= 0 ? 1 : Math.min(1, (now - this.t0) / d)
    if (k >= 1) { this.finish(); return }
    const e = (this.o.ease || linear)(k)
    const from = this.o.from === undefined ? 0 : this.o.from
    const to = this.o.to === undefined ? 1 : this.o.to
    this.o.onUpdate(from + (to - from) * e)
  }

  private cleanup(): void {
    const i = active.indexOf(this)
    if (i >= 0) active.splice(i, 1)
    if (this.ev) {
      this.owner.removeEvent(this.ev)
      this.ev = null
    }
  }
}

/** Starts a tween from `from` (default 0) to `to` (default 1). */
export function tween(owner: BaseScriptComponent, o: TweenOptions): Tween {
  const t = new Tween(owner, o)
  t.start()
  return t
}

/** Number of tweens still running (0 = settled). */
export function activeTweenCount(): number { return active.length }

/**
 * A value that fades toward a target over a fixed time: in (rising) with ease-out, out (falling)
 * with ease-in, optional delay. Retargeting starts a new fade from where it is. The owner calls
 * step() once a frame. Durations go through sec(), so with reduce motion it jumps.
 */
export class Fader {
  value: number
  private from: number
  private to: number
  private t0: number = 0
  private dur: number = 0
  private ease: Ease = linear

  constructor(v: number = 0) {
    this.value = v
    this.from = v
    this.to = v
  }

  get target(): number { return this.to }

  /** Fades to `target`: inMs/easeOut when rising, outMs/easeIn when falling. */
  set(target: number, inMs: number, outMs: number, delayMs: number = 0): void {
    if (target === this.to) return
    const up = target > this.value
    this.start(target, up ? inMs : outMs, up ? easeOut : easeIn, up ? delayMs : 0)
  }

  /** Fades to `target` over `ms` with a given curve. */
  start(target: number, ms: number, ease: Ease, delayMs: number = 0): void {
    this.from = this.value
    this.to = target
    this.dur = sec(ms)
    this.ease = ease
    this.t0 = motionNow() + sec(delayMs)
    if (this.dur <= 0 && sec(delayMs) <= 0) this.value = target
  }

  jump(v: number): void {
    this.value = v
    this.from = v
    this.to = v
    this.dur = 0
  }

  step(): number {
    if (this.value === this.to) return this.value
    const now = motionNow()
    if (now < this.t0) return this.value
    const k = this.dur <= 0 ? 1 : Math.min(1, (now - this.t0) / this.dur)
    this.value = k >= 1 ? this.to : this.from + (this.to - this.from) * this.ease(k)
    return this.value
  }

  isSettled(): boolean { return this.value === this.to }
}

/**
 * One frame of a critically damped spring (zeta = 1), stable for any dt:
 * f = 1 + 2 dt w; x' = (f x + dt v + dt^2 w^2 target) / (f + dt^2 w^2); v' = (v + dt w^2 (target - x)) / (f + dt^2 w^2).
 * With reduce motion it snaps (x = target, v = 0).
 */
export function springStep(x: vec3, v: vec3, target: vec3, dt: number, omega: number = SPRING_OMEGA): { x: vec3, v: vec3 } {
  if (reduce || dt <= 0) return reduce ? { x: target, v: vec3.zero() } : { x, v }
  const w2 = omega * omega
  const f = 1 + 2 * dt * omega
  const den = f + dt * dt * w2
  const nx = x.uniformScale(f).add(v.uniformScale(dt)).add(target.uniformScale(dt * dt * w2)).uniformScale(1 / den)
  const nv = v.add(target.sub(x).uniformScale(dt * w2)).uniformScale(1 / den)
  return { x: nx, v: nv }
}

/**
 * Press feedback: `target` scales to 0.96 on pinch-down and back on release (ease-out 120 ms).
 * Returns down/up functions for the caller's trigger events and a reset for hide paths.
 */
export function pressFeedback(owner: BaseScriptComponent, target: SceneObject): { down: () => void, up: () => void, reset: () => void } {
  const tr = target.getTransform()
  const base = tr.getLocalScale()
  let cur = 1
  let tw: Tween | null = null
  const reset = (): void => {
    if (tw) { tw.cancel(); tw = null }
    cur = 1
    tr.setLocalScale(base)
  }
  const go = (to: number): void => {
    if (!target.isEnabledInHierarchy) { reset(); return }
    if (tw) tw.cancel()
    tw = tween(owner, {
      durMs: MotionMs.press, ease: easeOut, from: cur, to,
      onUpdate: (v) => { cur = v; tr.setLocalScale(base.uniformScale(v)) },
    })
  }
  return { down: () => go(PRESS_SCALE), up: () => go(1), reset }
}

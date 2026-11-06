/**
 * WindowPin — one pinchable window. Pinch it and it reports its rectangle.
 *
 * Put this on an empty SceneObject at the center of the window opening, unit scale, rotated so
 * that its local +Z points INTO the room (toward the viewer). The script adds an invisible box
 * collider of widthCm x heightCm and a SIK Interactable, so a pinch (a mouse click in the
 * preview) on the window pins it. On glasses the pinch on the real window would give the same
 * rectangle; in the preview this collider stands in for the real window.
 *
 * Look (needs the highlight material and box mesh):
 *   - Before any window is pinned, every window's outline (a 2 cm line, not a fill) breathes
 *     between 0.15 and 0.35 opacity every 1.2 s, so a first-time user sees what to pinch (steady
 *     0.3 with reduce motion). It fades out in 250 ms when a window is pinned.
 *   - The pinned window keeps a steady 0.35 outline, so it is clear which one is pinned.
 *   - Aimed at: a faint warm fill fades in (120 ms) and out (180 ms); pinch-down lifts it x1.3
 *     (80 ms); on the pin it fades away (200 ms ease-in) as the light "moves" to the floor.
 *
 * The pinned window stops being a pinch target (its collider is switched off) so that the sun
 * handle, seen through that window, can be grabbed; the other windows stay pinchable.
 */
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { easeIn, easeOut, Fader, isReduceMotion, MotionMs, motionNow } from "./SunpatchMotion"

export interface WindowGeometry {
  name: string
  /** World center of the opening. */
  center: vec3
  /** Unit normal pointing into the room. */
  intoRoom: vec3
  /** Unit vectors along the window's width (right, seen from inside) and height (up). */
  right: vec3
  up: vec3
  widthCm: number
  heightCm: number
  /** World corners: bottom-left, bottom-right, top-right, top-left (seen from inside). */
  corners: vec3[]
}

type PinListener = (w: WindowPin | null) => void

const OUTLINE_COLOR = new vec3(1, 0.9, 0.66)

@component
export class WindowPin extends BaseScriptComponent {
  @input
  @hint("Window opening width (cm).")
  widthCm: number = 120

  @input
  @hint("Window opening height (cm).")
  heightCm: number = 100

  @input
  @allowUndefined
  @hint("Optional: unit box mesh for the aimed-at glow.")
  boxMesh: RenderMesh

  @input
  @allowUndefined
  @hint("Optional: translucent material for the aimed-at glow and the outline.")
  highlightMaterial: Material

  @input
  @hint("Outline line width (cm), drawn over the frame.")
  outlineWidthCm: number = 2

  private static listeners: PinListener[] = []
  private static registry: WindowPin[] = []
  private static current: WindowPin | null = null

  private interactable: Interactable | null = null
  private collider: ColliderComponent | null = null
  private glow: SceneObject | null = null
  private glowMat: Material | null = null
  private glowBase: vec4 = new vec4(1, 0.86, 0.55, 0.18)
  private glowFade = new Fader(0)
  private glowBoost = new Fader(1)
  private outlineMat: Material | null = null
  private outlineObj: SceneObject | null = null
  private onboard = new Fader(1)
  private mark = new Fader(0)

  /** Every WindowPin in the scene, in creation order. */
  static all(): WindowPin[] {
    return WindowPin.registry.slice()
  }

  /** Called with the window whenever any window is pinched (null if the pinned one is destroyed). */
  static onPinned(fn: PinListener): void {
    WindowPin.listeners.push(fn)
  }

  static byName(name: string): WindowPin | null {
    for (const w of WindowPin.registry) if (w.getSceneObject().name === name) return w
    return null
  }

  onAwake(): void {
    WindowPin.registry.push(this)
    this.collider = this.sceneObject.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(this.widthCm, this.heightCm, 4)
    this.collider.shape = shape
    this.collider.fitVisual = false
    this.interactable = this.sceneObject.createComponent(Interactable.getTypeName()) as Interactable

    if (this.boxMesh && this.highlightMaterial) {
      this.glow = global.scene.createSceneObject(this.sceneObject.name + "Glow")
      this.glow.setParent(this.sceneObject)
      this.glow.getTransform().setLocalPosition(new vec3(0, 0, 1))
      this.glow.getTransform().setLocalScale(new vec3(this.widthCm, this.heightCm, 0.5))
      const rmv = this.glow.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.boxMesh
      this.glowMat = this.highlightMaterial.clone()
      this.glowBase = this.glowMat.mainPass.baseColor
      rmv.mainMaterial = this.glowMat
      this.glow.enabled = false
    }
    if (this.highlightMaterial) {
      this.outlineObj = global.scene.createSceneObject(this.sceneObject.name + "Outline")
      this.outlineObj.setParent(this.sceneObject)
      this.outlineObj.getTransform().setLocalPosition(new vec3(0, 0, 1.5))
      const rmv = this.outlineObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = buildOutline(this.widthCm / 2 + 2, this.heightCm / 2 + 2, this.outlineWidthCm)
      this.outlineMat = this.highlightMaterial.clone()
      rmv.mainMaterial = this.outlineMat
      rmv.setRenderOrder(5)
    }

    this.createEvent("OnStartEvent").bind(() => {
      if (!this.interactable) return
      this.interactable.onTriggerStart.add(() => this.glowBoost.start(1.3, MotionMs.pinchDown, easeOut))
      this.interactable.onTriggerEnd.add(() => { this.glowBoost.start(1, MotionMs.pinchDown, easeOut); this.pin() })
      this.interactable.onHoverEnter.add(() => this.glowFade.set(1, MotionMs.glowIn, MotionMs.glowOut))
      this.interactable.onHoverExit.add(() => this.glowFade.set(0, MotionMs.glowIn, MotionMs.glowOut))
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    this.createEvent("OnDestroyEvent").bind(() => {
      WindowPin.registry = WindowPin.registry.filter((w) => w !== this)
      if (WindowPin.current === this) {
        WindowPin.current = null
        for (const fn of WindowPin.listeners) fn(null)
      }
    })
  }

  /** Pins this window (same path as a real pinch). */
  pin(): void {
    WindowPin.current = this
    for (const w of WindowPin.registry) w.setTargetable(w !== this)
    this.glowFade.start(0, MotionMs.glowGone, easeIn)
    for (const fn of WindowPin.listeners) fn(this)
  }

  /** Test API: no window pinned (as at Lens start); every window is pinchable again. */
  static unpinAll(): void {
    WindowPin.current = null
    for (const w of WindowPin.registry) w.setTargetable(true)
    for (const fn of WindowPin.listeners) fn(null)
  }

  /** The pinned window, or null. */
  static pinned(): WindowPin | null {
    return WindowPin.current
  }

  /** Current outline opacity (test API). */
  getOutlineOpacity(): number {
    return this.outlineMat ? this.outlineMat.mainPass.baseColor.w : 0
  }

  private setTargetable(on: boolean): void {
    if (this.collider) this.collider.enabled = on
    if (this.interactable) this.interactable.enabled = on
    if (!on) this.glowFade.jump(0)
  }

  private onUpdate(): void {
    const anyPinned = WindowPin.current !== null
    this.onboard.set(anyPinned ? 0 : 1, MotionMs.hintIn, MotionMs.hintOut)
    this.mark.set(WindowPin.current === this ? 1 : 0, MotionMs.hintIn, MotionMs.hintOut)
    const ob = this.onboard.step()
    const mk = this.mark.step()
    if (this.outlineMat && this.outlineObj) {
      // Onboarding breath: 0.15 <-> 0.35, period 1.2 s (steady 0.3 with reduce motion).
      const phase = (motionNow() * 1000 / MotionMs.breathePeriod) * Math.PI * 2
      const breath = isReduceMotion() ? 0.3 : 0.25 - 0.1 * Math.cos(phase)
      const a = Math.max(ob * breath, mk * 0.35)
      this.outlineMat.mainPass.baseColor = new vec4(OUTLINE_COLOR.x, OUTLINE_COLOR.y, OUTLINE_COLOR.z, a)
      this.outlineObj.enabled = a > 0.001
    }
    if (this.glow && this.glowMat) {
      const g = this.glowFade.step() * this.glowBoost.step()
      const b = this.glowBase
      this.glowMat.mainPass.baseColor = new vec4(b.x, b.y, b.z, Math.min(1, b.w * g))
      this.glow.enabled = g > 0.001
    }
  }

  getGeometry(): WindowGeometry {
    const t = this.sceneObject.getTransform()
    const center = t.getWorldPosition()
    const rot = t.getWorldRotation()
    const intoRoom = rot.multiplyVec3(new vec3(0, 0, 1)).normalize()
    const right = rot.multiplyVec3(new vec3(1, 0, 0)).normalize()
    const up = rot.multiplyVec3(new vec3(0, 1, 0)).normalize()
    const hw = right.uniformScale(this.widthCm / 2)
    const hh = up.uniformScale(this.heightCm / 2)
    return {
      name: this.sceneObject.name,
      center,
      intoRoom,
      right,
      up,
      widthCm: this.widthCm,
      heightCm: this.heightCm,
      corners: [
        center.sub(hw).sub(hh),
        center.add(hw).sub(hh),
        center.add(hw).add(hh),
        center.sub(hw).add(hh),
      ],
    }
  }
}

/** A rectangular outline (4 bars of width w) centred on the rectangle of half size hx, hy (local x/y). */
function buildOutline(hx: number, hy: number, w: number): RenderMesh {
  const mb = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "normal", components: 3, normalized: true },
    { name: "texture0", components: 2 },
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  const verts: number[] = []
  const idx: number[] = []
  const o = hx + w / 2
  const i = hx - w / 2
  const oy = hy + w / 2
  const iy = hy - w / 2
  const quad = (x0: number, y0: number, x1: number, y1: number): void => {
    const b = verts.length / 8
    verts.push(x0, y0, 0, 0, 0, 1, 0, 0, x1, y0, 0, 0, 0, 1, 1, 0, x1, y1, 0, 0, 0, 1, 1, 1, x0, y1, 0, 0, 0, 1, 0, 1)
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  quad(-o, iy, o, oy)
  quad(-o, -oy, o, -iy)
  quad(-o, -iy, -i, iy)
  quad(i, -iy, o, iy)
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  mb.updateMesh()
  return mb.getMesh()
}

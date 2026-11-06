/**
 * WindowPin — one pinchable window. Pinch it and it reports its rectangle.
 *
 * Put this on an empty SceneObject at the center of the window opening, unit scale, rotated so
 * that its local +Z points INTO the room (toward the viewer). The script adds an invisible box
 * collider of widthCm x heightCm and a SIK Interactable, so a pinch (a mouse click in the
 * preview) on the window pins it. On glasses the pinch on the real window would give the same
 * rectangle; in the preview this collider stands in for the real window.
 *
 * While aimed at, a faint warm outline glow shows on the window (if a highlight material and
 * box mesh are given), so the target highlights when aimed at.
 */
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"

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

type PinListener = (w: WindowPin) => void

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
  @hint("Optional: translucent material for the aimed-at glow.")
  highlightMaterial: Material

  private static listeners: PinListener[] = []
  private static registry: WindowPin[] = []

  private interactable: Interactable | null = null
  private collider: ColliderComponent | null = null
  private glow: SceneObject | null = null

  /** Every WindowPin in the scene, in creation order. */
  static all(): WindowPin[] {
    return WindowPin.registry.slice()
  }

  /** Called with the window whenever any window is pinched. */
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
      rmv.mainMaterial = this.highlightMaterial
      this.glow.enabled = false
    }

    this.createEvent("OnStartEvent").bind(() => {
      if (!this.interactable) return
      this.interactable.onTriggerEnd.add(() => this.pin())
      this.interactable.onHoverEnter.add(() => { if (this.glow) this.glow.enabled = true })
      this.interactable.onHoverExit.add(() => { if (this.glow) this.glow.enabled = false })
    })
    this.createEvent("OnDestroyEvent").bind(() => {
      WindowPin.registry = WindowPin.registry.filter((w) => w !== this)
    })
  }

  /** Pins this window (same path as a real pinch). */
  pin(): void {
    for (const fn of WindowPin.listeners) fn(this)
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

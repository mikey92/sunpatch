/**
 * SeasonControl — the three-part day control next to the pinned window: Today | Dec 21 | Jun 21.
 *
 * It shows the state and lets you choose it (no "what will this button do?"): the chosen part is a
 * pale gold plate, the others a light blue-gray plate (no dark plates: the display is additive).
 * Each part is 16 x 10 cm with 2 cm between parts (52 x 10 cm in all), centred at the window's
 * centre height, 20 cm to the right of the window edge, facing into the room. Text cap height
 * about 4.5 cm (shrinks to fit the part if a font is wider).
 *
 * Feedback: hover brightens the plate (+0.15, 120 ms in / 160 ms out), pinch-down scales the part
 * to 0.96 and back (120 ms ease-out), and a short soft tick plays on a choice. The control appears
 * 350 ms after a pin (a delay only, no entrance animation); with reduce motion at once.
 *
 * Each part is a SIK Interactable with a box collider (the scene object holds a child Text).
 *
 * Test API (global.seasonControl): getParts, pressPart, getPartInteractable, isShown, getSize.
 */
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { SunpatchMain, Season } from "./SunpatchMain"
import { WindowGeometry } from "./WindowPin"
import { Fader, MotionMs, motionNow, pressFeedback, sec } from "./SunpatchMotion"

const SEASONS: Season[] = ["today", "dec21", "jun21"]
const LABELS = ["Today", "Dec 21", "Jun 21"]
const PLATE = new vec4(0.55, 0.6, 0.7, 0.6)
const CHOSEN = new vec4(1.0, 0.86, 0.55, 0.8)
const TEXT_ON_PLATE = new vec4(1, 1, 1, 1)
const TEXT_ON_CHOSEN = new vec4(0.2, 0.17, 0.1, 1)

interface Part {
  so: SceneObject
  text: Text | null
  mat: Material
  hover: Fader
  press: { down: () => void, up: () => void, reset: () => void }
  interactable: Interactable
}

@component
export class SeasonControl extends BaseScriptComponent {
  @input
  main: SunpatchMain

  @input
  @hint("Unlit material that ignores depth (drawn over the wall, as on glasses).")
  overlayMaterial: Material

  @input
  @hint("The three parts in order: Today, Dec 21, Jun 21 (each holds a child Text).")
  parts: SceneObject[]

  @input
  partWidthCm: number = 16

  @input
  partHeightCm: number = 10

  @input
  partGapCm: number = 2

  @input
  @hint("Gap between the window's right edge and the control (cm).")
  windowGapCm: number = 20

  @input
  @hint("Text scale (48 pt x 6 = about 4.5 cm cap height).")
  textScale: number = 6

  @input
  @allowUndefined
  @hint("Short soft tick played when a part is chosen.")
  tick: AudioTrackAsset

  private items: Part[] = []
  private audio: AudioComponent | null = null
  private placedFor: string = ""
  private pinnedSince: number = -1
  private shown: boolean = false

  onAwake(): void {
    if (!this.main || !this.overlayMaterial || !this.parts || this.parts.length !== 3) {
      print("SeasonControl: main, overlayMaterial and three parts are required.")
      return
    }
    ;(global as any).seasonControl = this
    const plate = buildRoundedRect(this.partWidthCm, this.partHeightCm, 2.2)
    for (let i = 0; i < 3; i++) {
      const so = this.parts[i]
      const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = plate
      const mat = this.overlayMaterial.clone()
      mat.mainPass.baseColor = PLATE
      rmv.mainMaterial = mat
      rmv.setRenderOrder(33)
      const col = so.createComponent("Physics.ColliderComponent") as ColliderComponent
      const shape = Shape.createBoxShape()
      shape.size = new vec3(this.partWidthCm, this.partHeightCm, 2)
      col.shape = shape
      col.fitVisual = false
      const it = so.createComponent(Interactable.getTypeName()) as Interactable
      let text: Text | null = null
      if (so.getChildrenCount() > 0) {
        const tso = so.getChild(0)
        text = tso.getComponent("Component.Text") as Text
        tso.getTransform().setLocalPosition(new vec3(0, 0, 0.4))
        tso.getTransform().setLocalScale(vec3.one().uniformScale(this.textScale))
        if (text) {
          text.text = LABELS[i]
          text.setRenderOrder(34)
          text.depthTest = false
          text.backgroundSettings.enabled = false
          const hw = (this.partWidthCm - 2.4) / 2 / this.textScale
          const hh = (this.partHeightCm - 2) / 2 / this.textScale
          text.layoutRect = Rect.create(-hw, hw, -hh, hh)
          text.horizontalOverflow = HorizontalOverflow.Shrink
        }
      }
      this.items.push({ so, text, mat, hover: new Fader(0), press: pressFeedback(this, so), interactable: it })
    }
    if (this.tick) {
      this.audio = this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent
      this.audio.audioTrack = this.tick
      this.audio.volume = 0.4
    }
    this.sceneObject.enabled = true
    for (const p of this.items) p.so.enabled = false
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("LateUpdateEvent").bind(() => this.onLateUpdate())
  }

  private onStart(): void {
    this.items.forEach((p, i) => {
      p.interactable.onHoverEnter.add(() => p.hover.set(1, MotionMs.hoverIn, MotionMs.hoverOut))
      p.interactable.onHoverExit.add(() => { p.hover.set(0, MotionMs.hoverIn, MotionMs.hoverOut); p.press.up() })
      p.interactable.onTriggerStart.add(() => p.press.down())
      p.interactable.onTriggerEnd.add(() => { p.press.up(); this.choose(SEASONS[i]) })
    })
  }

  // ── Test API ──────────────────────────────────────────────────────

  /** The three parts: season, text, chosen, world centre, size (cm). */
  getParts(): { season: Season, text: string, chosen: boolean, center: vec3, widthCm: number, heightCm: number, name: string }[] {
    const cur = this.main.getSeason()
    return this.items.map((p, i) => ({
      season: SEASONS[i],
      text: p.text ? p.text.text : "",
      chosen: SEASONS[i] === cur,
      center: p.so.getTransform().getWorldPosition(),
      widthCm: this.partWidthCm * p.so.getTransform().getWorldScale().x,
      heightCm: this.partHeightCm * p.so.getTransform().getWorldScale().y,
      name: p.so.name,
    }))
  }

  /** Same as pinching a part. */
  pressPart(s: Season): void {
    this.choose(s)
  }

  getPartInteractable(s: Season): Interactable | null {
    const i = SEASONS.indexOf(s)
    return i >= 0 ? this.items[i].interactable : null
  }

  isShown(): boolean {
    return this.shown
  }

  /** Whole control size (cm). */
  getSize(): vec2 {
    return new vec2(3 * this.partWidthCm + 2 * this.partGapCm, this.partHeightCm)
  }

  // ── Internals ─────────────────────────────────────────────────────

  private choose(s: Season): void {
    if (this.main.getSeason() !== s) {
      this.main.setSeason(s)
      if (this.audio) this.audio.play(1)
    }
  }

  private place(win: WindowGeometry, rot: quat): void {
    const total = 3 * this.partWidthCm + 2 * this.partGapCm
    const c = win.center
      .add(win.right.uniformScale(win.widthCm / 2 + this.windowGapCm + total / 2))
      .add(win.intoRoom.uniformScale(4))
    const t = this.sceneObject.getTransform()
    t.setWorldPosition(c)
    t.setWorldRotation(rot)
    t.setWorldScale(vec3.one())
    const step = this.partWidthCm + this.partGapCm
    this.items.forEach((p, i) => p.so.getTransform().setLocalPosition(new vec3((i - 1) * step, 0, 0)))
  }

  private onLateUpdate(): void {
    if (!this.main || this.items.length !== 3) return
    const pinned = this.main.getPinnedWindow()
    if (!pinned) {
      this.placedFor = ""
      this.pinnedSince = -1
      this.setPartsEnabled(false)
      return
    }
    const name = pinned.getSceneObject().name
    if (name !== this.placedFor) {
      this.placedFor = name
      this.pinnedSince = motionNow()
      this.place(pinned.getGeometry(), pinned.getSceneObject().getTransform().getWorldRotation())
      this.setPartsEnabled(false)
    }
    // Appears after the patch and label have started (a delay only).
    if (!this.shown && motionNow() - this.pinnedSince >= sec(MotionMs.controlDelay)) this.setPartsEnabled(true)
    if (!this.shown) return
    const cur = this.main.getSeason()
    this.items.forEach((p, i) => {
      const chosen = SEASONS[i] === cur
      const base = chosen ? CHOSEN : PLATE
      const h = 0.15 * p.hover.step()
      p.mat.mainPass.baseColor = new vec4(Math.min(1, base.x + h), Math.min(1, base.y + h), Math.min(1, base.z + h), base.w)
      if (p.text) p.text.textFill.color = chosen ? TEXT_ON_CHOSEN : TEXT_ON_PLATE
    })
  }

  private setPartsEnabled(on: boolean): void {
    this.shown = on
    for (const p of this.items) {
      if (!on) { p.press.reset(); p.hover.jump(0) }
      p.so.enabled = on
    }
  }
}

/** Rounded rectangle in the local x/y plane (normal +Z), centred at the origin. */
function buildRoundedRect(w: number, h: number, r: number): RenderMesh {
  const mb = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "normal", components: 3, normalized: true },
    { name: "texture0", components: 2 },
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  const verts: number[] = [0, 0, 0, 0, 0, 1, 0.5, 0.5]
  const hx = w / 2 - r
  const hy = h / 2 - r
  const corners = [[hx, hy, 0], [-hx, hy, 90], [-hx, -hy, 180], [hx, -hy, 270]]
  const seg = 6
  for (const c of corners) {
    for (let k = 0; k <= seg; k++) {
      const a = (c[2] + (90 * k) / seg) * Math.PI / 180
      const x = c[0] + r * Math.cos(a)
      const y = c[1] + r * Math.sin(a)
      verts.push(x, y, 0, 0, 0, 1, x / w + 0.5, y / h + 0.5)
    }
  }
  const n = verts.length / 8 - 1
  const idx: number[] = []
  for (let i = 1; i <= n; i++) idx.push(0, i, i === n ? 1 : i + 1)
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  mb.updateMesh()
  return mb.getMesh()
}

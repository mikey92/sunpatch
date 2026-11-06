/**
 * Criterion 12 — no claims the Lens cannot back up. Every text it shows is facts only: clock
 * times, dates, sunrise/sunset times and plain states ("Sun has set", "No direct sun"). No
 * judgement words ("safe", "good", "best", ...) and no other numbers (no scores, percentages or
 * hours of sun).
 * Sweep: the three windows x Today / Dec 21 / Jun 21 x every hour of 2026-11-06 (London). For each
 * state the patch label and the handle readout are checked; every few states all Text components
 * under the Lens's own objects (room, Lens UI, season button, preview note) are checked too.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { nextFrame } from "Leaf.lspkg/Utils/common/Utils"
import { check, log, lookAt, restoreLive, sp, waitForLensUp } from "./SunpatchLeafHelpers"

const FORBIDDEN = ["safe", "unsafe", "good", "bad", "best", "worst", "better", "great", "ideal", "perfect", "excellent",
  "poor", "healthy", "recommend", "recommended", "should", "guarantee", "guaranteed", "optimal", "enough", "plenty",
  "bright", "warm", "cosy", "cozy", "score", "rating"]
const MONTHS = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"

/** Returns a reason the text is not allowed, or "" if it is fine. */
function problem(text: string): string {
  const lower = text.toLowerCase()
  for (const w of FORBIDDEN) {
    if (new RegExp("(^|[^a-z])" + w + "([^a-z]|$)").test(lower)) return "judgement word \"" + w + "\""
  }
  if (text.indexOf("%") >= 0) return "percentage"
  const rest = text.replace(/\b\d{1,2}:\d{2}\b/g, "").replace(new RegExp("\\b" + MONTHS + " \\d{1,2}\\b", "g"), "")
  if (/\d/.test(rest)) return "a number that is not a clock time or a date"
  return ""
}

function lensTexts(): string[] {
  const out: string[] = []
  const walk = (o: SceneObject): void => {
    if (!o.isEnabledInHierarchy) return
    const t = o.getComponent("Component.Text") as Text
    if (t && t.text) out.push(t.text)
    for (let i = 0; i < o.getChildrenCount(); i++) walk(o.getChild(i))
  }
  for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
    const r = global.scene.getRootObject(i)
    if (r.name === "SunpatchRoom" || r.name === "Sunpatch") walk(r)
  }
  return out
}

@component
export class SunpatchC12NoClaimsScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const arc = (global as any).sunArc
    const seen: { [k: string]: boolean } = {}
    let checked = 0
    let bad = ""
    const seasons = ["today", "dec21", "jun21"]
    for (const win of ["WindowSouth", "WindowEast", "WindowNorth"]) {
      check(api.pinWindow(win), win + " pinned")
      await lookAt("window", 250)
      api.setUtc("2026-11-06T12:00:00Z")
      for (const season of seasons) {
        api.setSeason(season)
        for (let h = 0; h < 24; h++) {
          api.setTime(h, 30)
          await nextFrame()
          const texts = [api.getLabel(), arc.getHandleText(), arc.getSeasonText()]
          if (h % 6 === 0) for (const t of lensTexts()) texts.push(t)
          for (const t of texts) {
            if (!t) continue
            checked++
            seen[t.replace("\n", " / ")] = true
            const p = problem(t)
            if (p && !bad) bad = "\"" + t.replace("\n", " / ") + "\" (" + win + ", " + season + ", " + h + ":30): " + p
          }
        }
      }
    }
    const kinds = Object.keys(seen)
    log(checked + " texts checked, " + kinds.length + " distinct, e.g. " + kinds.slice(0, 12).join(" | "))
    check(bad === "", "no judgement words or unexplained numbers" + (bad ? ": " + bad : ""))
    // The checker itself rejects what it should.
    check(problem("Best spot · 4.5 h of sun") !== "" && problem("Safe for plants") !== "" && problem("70% sun") !== "",
      "the checker rejects a judgement, an hours-of-sun number and a percentage")
    check(problem("15:10 · Nov 6") === "" && problem("Sun has set\nSunset 16:24") === "", "the checker accepts clock times and dates")
    restoreLive()
    api.pinWindow("WindowSouth")
    log("C12 done")
  }
}

/**
 * Criterion 16 — stand where the chair would go and look down: the 12-month ring on the floor.
 *  a. Looking straight ahead, nothing shows. The spot is where the gaze meets the floor within
 *     90 cm of the head: looking down at your feet gives a spot, looking across the room does not.
 *  b. A spot inside the Dec 21 noon light gets sun in December (the ring's Dec is lit) and the
 *     line names the months and hours ("Sun here: Oct–Feb / 11:40–14:20").
 *  c. A spot inside the Jun 21 noon light gets sun in June.
 *  d. The floor under the sofa never gets direct sun ("No direct sun here").
 *  e. Shown (override = standing there looking down): the ring and the same line appear.
 */
import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario"
import { sleep } from "Leaf.lspkg/Utils/common/Utils"
import { check, fmt, log, pinchWindow, restoreLive, sp, waitFor, waitForLensUp } from "./SunpatchLeafHelpers"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

@component
export class SunpatchC16StandHereScenario extends Scenario {
  async run(): Promise<void> {
    await waitForLensUp()
    const api = sp()
    const spot = (global as any).spotSun
    check(!!spot, "global.spotSun exists")
    api.setReduceMotion(true)
    await pinchWindow("WindowSouth")
    spot.clearSpotOverride()

    // a. Looking ahead: nothing at the feet.
    await sleep(500)
    check(!spot.isShown(), "looking straight ahead: no ring at the feet")
    const fy: number = api.getPatchPlaneY()
    const head = new vec3(40, fy + 160, -120)
    const down = spot.spotFromGaze(head, new vec3(0, -160, -30))
    log("looking down from " + fmt(head) + ": spot " + (down ? fmt(down) : "none"))
    check(!!down && Math.abs(down.x - 40) < 0.01 && Math.abs(down.z + 150) < 0.01 && Math.abs(down.y - fy) < 0.01, "looking down near your feet gives the floor spot there (10 cm grid)")
    check(spot.spotFromGaze(head, new vec3(0, -160, -300)) === null, "looking across the room at the floor gives no spot")
    check(spot.spotFromGaze(head, new vec3(0, 0, -1)) === null, "looking ahead gives no spot")

    const top: number[] = api.projector.furnitureTopRect()
    const underSofa = (x: number, z: number) => x > top[1] - 15 && x < top[2] + 15 && z > top[3] - 15 && z < top[4] + 15
    // A floor point inside the noon light that is clear of the sofa (the light falling on the sofa
    // does not reach the floor below it).
    const centerAt = async (season: string): Promise<vec3> => {
      api.setSeason(season)
      api.setUtc("2026-11-06T12:00:00Z")
      await sleep(200)
      const r = api.projector.getLast()
      const c: vec3 = r.center
      const cands: vec3[] = [c]
      for (const v of r.corners) cands.push(v.uniformScale(0.7).add(c.uniformScale(0.3)))
      const pick = cands.find((q: vec3) => !underSofa(q.x, q.z)) || c
      log(season + " noon light centre " + fmt(c) + ", spot clear of the sofa " + fmt(pick))
      return pick
    }
    const show = (r: any) => MONTHS.filter((_m: string, i: number) => r.months[i]).join(" ")

    // b. Inside the Dec 21 noon light.
    const dec = await centerAt("dec21")
    const rd = spot.computeAt(dec.x, dec.z)
    log("Dec spot months: " + show(rd) + " | " + rd.label.replace("\n", " / "))
    check(rd.months[11], "the Dec 21 noon light's spot gets sun in December")
    const range = rd.label.split("\n")[0].replace("Sun here: ", "")
    check(rd.label.indexOf("Sun here: ") === 0 && rd.label.split("\n").length === 2 && /^[A-Z][a-z]{2}/.test(range), "its line names the months and the hours (" + rd.label.replace("\n", " / ") + ")")

    // c. Inside the Jun 21 noon light.
    const jun = await centerAt("jun21")
    const rj = spot.computeAt(jun.x, jun.z)
    log("Jun spot months: " + show(rj) + " | " + rj.label.replace("\n", " / "))
    check(rj.months[5], "the Jun 21 noon light's spot gets sun in June")

    // d. Under the sofa.
    const ux = (top[1] + top[2]) / 2, uz = (top[3] + top[4]) / 2
    const ru = spot.computeAt(ux, uz)
    log("under the sofa (" + ux.toFixed(0) + ", " + uz.toFixed(0) + "): " + ru.label.replace("\n", " / "))
    check(ru.months.every((m: boolean) => !m) && ru.label === "No direct sun here", "the floor under the sofa never gets direct sun")

    // e. Standing at the Dec spot, looking down: ring and line shown.
    spot.setSpotOverride(dec.x, dec.z)
    await waitFor(() => spot.isShown(), 2000, "ring shown at the Dec spot")
    const r = spot.getResult()
    check(r && Math.abs(r.spot.x - dec.x) < 0.01 && Math.abs(r.spot.z - dec.z) < 0.01, "ring is at the spot " + fmt(dec))
    check(spot.getLabelText() === r.label, "the line shown is the spot's line")
    await waitFor(() => !api.isLabelVisible(), 2000, "the patch's own line steps aside while the ring shows")
    spot.clearSpotOverride()
    await waitFor(() => !spot.isShown(), 2000, "ring hidden again")
    restoreLive()
    log("C16 done")
  }
}

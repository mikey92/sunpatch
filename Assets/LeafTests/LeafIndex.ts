import { scenariosIndex } from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import { ScenarioMetadata } from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import { SunpatchC1JuneNoonScenario } from "./SunpatchC1JuneNoonScenario"
import { SunpatchC2DecemberNoonScenario } from "./SunpatchC2DecemberNoonScenario"
import { SunpatchC3SunSetScenario } from "./SunpatchC3SunSetScenario"
import { SunpatchC4SeasonReachScenario } from "./SunpatchC4SeasonReachScenario"
import { SunpatchC5PatchGeometryScenario } from "./SunpatchC5PatchGeometryScenario"
import { SunpatchC6NorthWindowScenario } from "./SunpatchC6NorthWindowScenario"
import { SunpatchPoseScenario } from "./SunpatchPoseScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    { id: "sunpatch-c1-june-noon", typename: SunpatchC1JuneNoonScenario.getTypeName() },
    { id: "sunpatch-c2-december-noon", typename: SunpatchC2DecemberNoonScenario.getTypeName() },
    { id: "sunpatch-c3-sun-set", typename: SunpatchC3SunSetScenario.getTypeName() },
    { id: "sunpatch-c4-season-reach", typename: SunpatchC4SeasonReachScenario.getTypeName() },
    { id: "sunpatch-c5-patch-geometry", typename: SunpatchC5PatchGeometryScenario.getTypeName() },
    { id: "sunpatch-c6-north-window", typename: SunpatchC6NorthWindowScenario.getTypeName() },
    {
      id: "sunpatch-pose",
      typename: SunpatchPoseScenario.getTypeName(),
      parameters: { window: "WindowSouth", utc: "2026-11-05T15:10:00Z", season: "today" },
    },
  ]
}

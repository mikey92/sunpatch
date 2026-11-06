import { scenariosIndex } from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import { ScenarioMetadata } from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import { SunpatchC1JuneNoonScenario } from "./SunpatchC1JuneNoonScenario"
import { SunpatchC2DecemberNoonScenario } from "./SunpatchC2DecemberNoonScenario"
import { SunpatchC3SunSetScenario } from "./SunpatchC3SunSetScenario"
import { SunpatchC4SeasonReachScenario } from "./SunpatchC4SeasonReachScenario"
import { SunpatchC5PatchGeometryScenario } from "./SunpatchC5PatchGeometryScenario"
import { SunpatchC6NorthWindowScenario } from "./SunpatchC6NorthWindowScenario"
import { SunpatchC7HandleDragScenario } from "./SunpatchC7HandleDragScenario"
import { SunpatchC8SeasonButtonRepinScenario } from "./SunpatchC8SeasonButtonRepinScenario"
import { SunpatchC9OffViewArrowScenario } from "./SunpatchC9OffViewArrowScenario"
import { SunpatchC10GazeSwitchScenario } from "./SunpatchC10GazeSwitchScenario"
import { SunpatchC11ReduceMotionScenario } from "./SunpatchC11ReduceMotionScenario"
import { SunpatchC12NoClaimsScenario } from "./SunpatchC12NoClaimsScenario"
import { SunpatchC13HandleReachScenario } from "./SunpatchC13HandleReachScenario"
import { SunpatchC14FirstMinuteScenario } from "./SunpatchC14FirstMinuteScenario"
import { SunpatchC15FurnitureLightScenario } from "./SunpatchC15FurnitureLightScenario"
import { SunpatchC16StandHereScenario } from "./SunpatchC16StandHereScenario"
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
    { id: "sunpatch-c7-handle-drag", typename: SunpatchC7HandleDragScenario.getTypeName() },
    { id: "sunpatch-c8-season-button-repin", typename: SunpatchC8SeasonButtonRepinScenario.getTypeName() },
    { id: "sunpatch-c9-off-view-arrow", typename: SunpatchC9OffViewArrowScenario.getTypeName() },
    { id: "sunpatch-c10-gaze-switch", typename: SunpatchC10GazeSwitchScenario.getTypeName() },
    { id: "sunpatch-c11-reduce-motion", typename: SunpatchC11ReduceMotionScenario.getTypeName() },
    { id: "sunpatch-c12-no-claims", typename: SunpatchC12NoClaimsScenario.getTypeName() },
    { id: "sunpatch-c13-handle-reach", typename: SunpatchC13HandleReachScenario.getTypeName() },
    { id: "sunpatch-c14-first-minute", typename: SunpatchC14FirstMinuteScenario.getTypeName() },
    { id: "sunpatch-c15-furniture-light", typename: SunpatchC15FurnitureLightScenario.getTypeName() },
    { id: "sunpatch-c16-stand-here", typename: SunpatchC16StandHereScenario.getTypeName() },
    {
      id: "sunpatch-pose",
      typename: SunpatchPoseScenario.getTypeName(),
      parameters: { window: "WindowSouth", utc: "2026-11-05T15:10:00Z", season: "today", hand: "none", handMs: "20000" },
    },
  ]
}

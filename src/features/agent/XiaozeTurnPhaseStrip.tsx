import type { XiaozeTurnPhase } from "./xiaozeTurnStateTypes";
import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";
import { XiaozeTurnTimeline } from "./XiaozeTurnTimeline";

type XiaozeTurnPhaseStripProps = {
  steps: XiaozeRunStepSnapshot[];
  phase?: XiaozeTurnPhase;
  isActive: boolean;
};

function phaseLabel(phase: XiaozeTurnPhase | undefined, isActive: boolean) {
  if (!isActive) {
    return "";
  }
  switch (phase) {
    case "thinking":
      return "理解问题…";
    case "tool":
      return "正在执行工具…";
    case "composing":
      return "生成回答…";
    default:
      return "";
  }
}

export function XiaozeTurnPhaseStrip({ steps, phase, isActive }: XiaozeTurnPhaseStripProps) {
  const activeLabel = phaseLabel(phase, isActive);

  return (
    <div className="xiaoze-turn-phase-strip" data-active={isActive ? "true" : "false"}>
      {activeLabel ? <p className="xiaoze-turn-phase-strip__status">{activeLabel}</p> : null}
      <XiaozeTurnTimeline steps={steps} className="xiaoze-turn-phase-strip__steps" />
    </div>
  );
}

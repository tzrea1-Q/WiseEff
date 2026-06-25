import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";

type XiaozeTurnTimelineProps = {
  steps: XiaozeRunStepSnapshot[];
  className?: string;
};

function stepStatusLabel(status: XiaozeRunStepSnapshot["status"]) {
  switch (status) {
    case "running":
      return "进行中";
    case "succeeded":
      return "完成";
    case "failed":
      return "失败";
    case "forbidden":
      return "无权限";
    default:
      return status;
  }
}

export function XiaozeTurnTimeline({ steps, className }: XiaozeTurnTimelineProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <ol className={["xiaoze-turn-timeline", className].filter(Boolean).join(" ")}>
      {steps.map((step) => (
        <li key={step.id} className={`xiaoze-turn-timeline__item is-${step.status}`}>
          <span className="xiaoze-turn-timeline__label">{step.label}</span>
          <span className="xiaoze-turn-timeline__status">{stepStatusLabel(step.status)}</span>
          {step.summary ? <span className="xiaoze-turn-timeline__summary">{step.summary}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function readRunStepsFromMetadata(metadata: Record<string, unknown> | undefined): XiaozeRunStepSnapshot[] {
  const raw = metadata?.runSteps;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is XiaozeRunStepSnapshot => {
    return (
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as XiaozeRunStepSnapshot).id === "string" &&
      typeof (entry as XiaozeRunStepSnapshot).label === "string"
    );
  });
}

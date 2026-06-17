import { Check } from "lucide-react";

import type { SubmissionWorkflowStageDetail } from "@/domain/parameters/submissionWorkflowTrail";
import { SUBMISSION_TIMELINE_STEPS } from "@/parameterSubmissionTimeline";

function formatWorkflowDisplayText(text: string) {
  return text
    .replaceAll("Committer", "MDE")
    .replaceAll("User", "开发人员");
}

type SubmissionWorkflowTimelineProps = {
  activeIndex: number;
  workflowStages: SubmissionWorkflowStageDetail[];
  className?: string;
};

function renderExecutorLine(stage: SubmissionWorkflowStageDetail) {
  if (stage.state === "skipped") {
    return <span className="submission-workflow-executor submission-workflow-executor--skipped">低风险跳过</span>;
  }

  if (stage.executorName) {
    return (
      <span className="submission-workflow-executor">
        {stage.executorLabel}：{stage.executorName}
      </span>
    );
  }

  if (stage.state === "active") {
    return <span className="submission-workflow-executor submission-workflow-executor--pending">待处理</span>;
  }

  if (stage.state === "completed") {
    return <span className="submission-workflow-executor submission-workflow-executor--missing">执行人未记录</span>;
  }

  return <span className="submission-workflow-executor submission-workflow-executor--pending">—</span>;
}

export function SubmissionWorkflowTimeline({
  activeIndex,
  workflowStages,
  className
}: SubmissionWorkflowTimelineProps) {
  return (
    <div className={["submission-workflow-panel", className].filter(Boolean).join(" ")}>
      <div className="timeline submission-timeline">
        {SUBMISSION_TIMELINE_STEPS.map((step, index) => (
          <div className={index <= activeIndex ? "done" : ""} key={step}>
            <span>{index < activeIndex ? <Check size={14} /> : index + 1}</span>
            <small>{formatWorkflowDisplayText(step)}</small>
          </div>
        ))}
      </div>

      {workflowStages.length > 0 ? (
        <div className="submission-workflow-executors" aria-label="流程执行人">
          {workflowStages.map((stage) => (
            <article
              className={[
                "submission-workflow-executor-card",
                stage.state === "active" ? "is-active" : "",
                stage.state === "completed" ? "is-completed" : "",
                stage.state === "pending" ? "is-pending" : "",
                stage.state === "skipped" ? "is-skipped" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={stage.key}
            >
              <strong>{formatWorkflowDisplayText(stage.label)}</strong>
              <p className="submission-workflow-assignee">指定：{stage.assigneeName}</p>
              <p className="submission-workflow-executor-line">{renderExecutorLine(stage)}</p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

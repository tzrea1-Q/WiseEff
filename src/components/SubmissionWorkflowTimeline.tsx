import type { SubmissionWorkflowStageDetail } from "@/domain/parameters/submissionWorkflowTrail";
import type { ParameterSubmissionRound } from "@/domain/parameters/types";
import { isActiveSubmissionRound } from "@/domain/parameters/submissionRound";

function formatWorkflowDisplayText(text: string) {
  return String(text ?? "")
    .replaceAll("Committer", "MDE")
    .replaceAll("User", "开发人员");
}

type SubmissionWorkflowTimelineProps = {
  status: ParameterSubmissionRound["status"];
  workflowStages: SubmissionWorkflowStageDetail[];
  className?: string;
};

function renderExecutorLine(stage: SubmissionWorkflowStageDetail, terminal: boolean) {
  if (stage.state === "skipped") {
    return <span className="submission-workflow-executor submission-workflow-executor--skipped">已跳过</span>;
  }

  if (stage.executorName && (!terminal || stage.executorLabel === "执行人")) {
    return (
      <span className="submission-workflow-executor">
        {stage.executorLabel}：{stage.executorName}
      </span>
    );
  }

  if (stage.state === "active" && !terminal) {
    return <span className="submission-workflow-executor submission-workflow-executor--pending">待处理</span>;
  }

  if (stage.state === "completed") {
    return <span className="submission-workflow-executor submission-workflow-executor--missing">执行人未记录</span>;
  }

  return <span className="submission-workflow-executor submission-workflow-executor--pending">{terminal ? "执行结果未记录" : "尚未处理"}</span>;
}

export function SubmissionWorkflowTimeline({
  status,
  workflowStages,
  className
}: SubmissionWorkflowTimelineProps) {
  const terminal = !isActiveSubmissionRound(status);
  return (
    <details className={["review-workflow-records", className].filter(Boolean).join(" ")}>
      <summary>处理记录</summary>
      {workflowStages.length > 0 ? (
        <ol aria-label="流程执行人">
          {workflowStages.map((stage) => (
            <li key={stage.key} data-state={terminal && stage.state === "active" ? "ended" : stage.state}>
              <strong>{formatWorkflowDisplayText(stage.label)}</strong>
              {stage.assigneeName && stage.assigneeName !== "未指派" ? <span>{terminal ? "当时指派" : "指定"}：{stage.assigneeName}</span> : null}
              {renderExecutorLine(stage, terminal)}
            </li>
          ))}
        </ol>
      ) : <p>未记录流程执行人。</p>}
    </details>
  );
}

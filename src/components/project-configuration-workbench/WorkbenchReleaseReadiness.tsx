import type { DtsReleaseReadiness, DtsReleaseReadinessIssue } from "@/application/ports/DtsStructuredRepository";
import {
  releaseReadinessAllowsCreate,
  releaseReadinessAllowsRelease
} from "@/application/project-configuration/releaseReadinessGates";
import { presentErrorMessage } from "@/infrastructure/http/presentError";
import { Button } from "@/components/ui/button";

const LEVEL_LABEL: Record<DtsReleaseReadiness["level"], string> = {
  blocked: "已阻断",
  warning: "需确认",
  ready: "检查通过",
  "in-sync": "与正式版本一致"
};

export type WorkbenchReleaseReadinessSummaryProps = {
  readiness: DtsReleaseReadiness | null;
  loading: boolean;
  error: string;
  localSessionDirty: boolean;
  onRetry: () => void;
  onOpenIssues: () => void;
  pressed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
};

/** @deprecated Prefer releaseReadinessAllowsCreate — kept as workbench alias. */
export const workbenchReadinessAllowsCreate = releaseReadinessAllowsCreate;

/** @deprecated Prefer releaseReadinessAllowsRelease — kept as workbench alias. */
export const workbenchReadinessAllowsRelease = releaseReadinessAllowsRelease;

export function WorkbenchReleaseReadinessSummary({
  readiness,
  loading,
  error,
  localSessionDirty,
  onOpenIssues,
  pressed,
  disabled,
  readOnly = false
}: WorkbenchReleaseReadinessSummaryProps) {
  const unavailable = Boolean(error || !readiness?.available);
  const status = readOnly ? "只读" : localSessionDirty ? "有未提交变更" : loading ? "检查中…"
    : unavailable ? "检查不可用" : LEVEL_LABEL[readiness!.level];

  return (
    <div
      className={`configuration-workbench__readiness is-${readOnly ? "readonly" : unavailable ? "unavailable" : readiness!.level}`}
      role="status"
      aria-label="配置版本状态"
      data-level={readiness?.level}
      data-can-create={String(!readOnly && !loading && !error && workbenchReadinessAllowsCreate(readiness, localSessionDirty))}
      data-can-release={String(!readOnly && !loading && !error && workbenchReadinessAllowsRelease(readiness, localSessionDirty))}
    >
      <Button variant="outline" size="sm" type="button" aria-pressed={pressed} disabled={disabled}
        onClick={onOpenIssues} title={error ? presentErrorMessage(error, "版本检查不可用。") : undefined}>
        配置版本<span aria-hidden="true">·</span><span>{status}</span>
      </Button>
    </div>
  );
}

export type WorkbenchReleaseReadinessIssuesProps = {
  readiness: DtsReleaseReadiness | null;
  acknowledgedWarningIds: ReadonlySet<string>;
  onAcknowledgeWarning: (issueId: string) => void;
  onSelectIssue: (issue: DtsReleaseReadinessIssue) => void;
  onRetry: () => void;
};

export function WorkbenchReleaseReadinessIssues({
  readiness,
  acknowledgedWarningIds,
  onAcknowledgeWarning,
  onSelectIssue,
  onRetry
}: WorkbenchReleaseReadinessIssuesProps) {
  if (!readiness) {
    return (
      <div className="configuration-workbench__readiness-issues" role="region" aria-label="版本检查问题">
        <p>尚未取得版本检查结果。</p>
        <button className="button subtle" type="button" onClick={onRetry}>
          重新检查
        </button>
      </div>
    );
  }

  if (!readiness.available) {
    return (
      <div className="configuration-workbench__readiness-issues" role="region" aria-label="版本检查问题">
        <p role="alert">{presentErrorMessage(readiness.unavailableReason, "版本检查不可用。")}</p>
        <button className="button subtle" type="button" onClick={onRetry}>
          重新检查
        </button>
      </div>
    );
  }

  const issues = [...readiness.blockers, ...readiness.warnings];
  if (issues.length === 0) {
    return (
      <div className="configuration-workbench__readiness-issues" role="region" aria-label="版本检查问题">
        <p>版本检查通过。</p>
      </div>
    );
  }

  return (
    <div className="configuration-workbench__readiness-issues" role="region" aria-label="版本检查问题">
      <strong>版本检查问题</strong>
      <ul className="configuration-workbench__readiness-issue-list">
        {issues.map((issue) => {
          const acknowledged = acknowledgedWarningIds.has(issue.id) || Boolean(issue.acknowledged);
          const actionable = Boolean(issue.target?.fileId || issue.remediation.kind === "complete-pending-change" && issue.remediation.href);
          const description = <>
            <span>{issue.severity === "blocker" ? "阻断" : "警告"}</span>
            <strong>{issue.message}</strong>
            <small>{issue.remediation.label}</small>
          </>;
          return (
            <li key={issue.id} data-severity={issue.severity} data-code={issue.code}>
              {actionable ? <button
                className="button subtle configuration-workbench__readiness-issue"
                type="button"
                onClick={() => onSelectIssue(issue)}
              >
                {description}
              </button> : <div className="configuration-workbench__readiness-issue">{description}</div>}
              {issue.acknowledgementRequired ? (
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={() => onAcknowledgeWarning(issue.id)}
                    aria-label={`确认警告 ${issue.message}`}
                  />
                  已审阅确认
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

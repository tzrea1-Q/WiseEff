import type { DtsReleaseReadiness, DtsReleaseReadinessIssue } from "@/application/ports/DtsStructuredRepository";
import {
  releaseReadinessAllowsCreate,
  releaseReadinessAllowsRelease
} from "@/application/project-configuration/releaseReadinessGates";

const LEVEL_LABEL: Record<DtsReleaseReadiness["level"], string> = {
  blocked: "已阻断",
  warning: "需确认",
  ready: "可发布",
  "in-sync": "已同步"
};

export type WorkbenchReleaseReadinessSummaryProps = {
  readiness: DtsReleaseReadiness | null;
  loading: boolean;
  error: string;
  localSessionDirty: boolean;
  onRetry: () => void;
  onOpenIssues: () => void;
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
  onRetry,
  onOpenIssues
}: WorkbenchReleaseReadinessSummaryProps) {
  if (loading) {
    return (
      <div className="configuration-workbench__readiness" role="status" aria-label="发布就绪">
        发布就绪：加载中…
      </div>
    );
  }

  if (error || !readiness || !readiness.available) {
    return (
      <div className="configuration-workbench__readiness is-unavailable" role="status" aria-label="发布就绪">
        <button className="button subtle configuration-workbench__readiness-summary" type="button" onClick={onOpenIssues}>
          <strong>不可用</strong>
          <span>{error || readiness?.unavailableReason || "门禁结果不可用，不能假定可发布。"}</span>
        </button>
        <button className="button subtle" type="button" onClick={onRetry}>
          重试就绪评估
        </button>
      </div>
    );
  }

  const blockerCount = readiness.blockers.length;
  const warningCount = readiness.warnings.length;

  return (
    <div
      className={`configuration-workbench__readiness is-${readiness.level}`}
      role="status"
      aria-label="发布就绪"
      data-level={readiness.level}
      data-can-create={String(workbenchReadinessAllowsCreate(readiness, localSessionDirty))}
      data-can-release={String(workbenchReadinessAllowsRelease(readiness, localSessionDirty))}
    >
      <button className="button subtle configuration-workbench__readiness-summary" type="button" onClick={onOpenIssues}>
        <strong>{LEVEL_LABEL[readiness.level]}</strong>
        <span>
          {blockerCount} 阻断 · {warningCount} 警告
        </span>
        {localSessionDirty ? <span className="configuration-workbench__local-session">本机会话未保存</span> : null}
      </button>
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
      <div className="configuration-workbench__readiness-issues" role="region" aria-label="发布就绪问题">
        <p>尚未加载发布就绪结果。</p>
        <button className="button subtle" type="button" onClick={onRetry}>
          重试就绪评估
        </button>
      </div>
    );
  }

  if (!readiness.available) {
    return (
      <div className="configuration-workbench__readiness-issues" role="region" aria-label="发布就绪问题">
        <p role="alert">{readiness.unavailableReason ?? "发布就绪不可用。"}</p>
        <button className="button subtle" type="button" onClick={onRetry}>
          重试就绪评估
        </button>
      </div>
    );
  }

  const issues = [...readiness.blockers, ...readiness.warnings];
  if (issues.length === 0) {
    return (
      <div className="configuration-workbench__readiness-issues" role="region" aria-label="发布就绪问题">
        <p>当前没有阻断项或需确认警告。创建/发布仍以服务端门禁令牌为准。</p>
      </div>
    );
  }

  return (
    <div className="configuration-workbench__readiness-issues" role="region" aria-label="发布就绪问题">
      <strong>发布就绪问题</strong>
      <ul className="configuration-workbench__readiness-issue-list">
        {issues.map((issue) => {
          const acknowledged = acknowledgedWarningIds.has(issue.id) || Boolean(issue.acknowledged);
          return (
            <li key={issue.id} data-severity={issue.severity} data-code={issue.code}>
              <button
                className="button subtle configuration-workbench__readiness-issue"
                type="button"
                onClick={() => onSelectIssue(issue)}
              >
                <span>{issue.severity === "blocker" ? "阻断" : "警告"}</span>
                <strong>{issue.message}</strong>
                <small>{issue.remediation.label}</small>
              </button>
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

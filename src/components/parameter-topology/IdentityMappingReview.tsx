import { useMemo } from "react";
import type {
  IdentityMappingCandidate,
  IdentityMappingEvidence,
  IdentityMappingTask,
  IdentityMappingTaskKind,
  IdentityMappingTaskStatus
} from "@/domain/parameter-topology/types";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";

export type IdentityMappingReviewProps = {
  tasks: IdentityMappingTask[];
};

function asEvidence(value: IdentityMappingTask["evidence"]): IdentityMappingEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as IdentityMappingEvidence;
}

function resolveTaskKind(task: IdentityMappingTask): IdentityMappingTaskKind {
  return task.taskKind ?? "identity-ambiguity";
}

function resolveTaskKindLabel(taskKind: IdentityMappingTaskKind): string {
  switch (taskKind) {
    case "singleton-cardinality":
      return PARAMETER_ADMIN_UI.identityMappingTaskKindSingleton;
    default:
      return PARAMETER_ADMIN_UI.identityMappingTaskKindAmbiguity;
  }
}

function resolveCandidates(task: IdentityMappingTask): IdentityMappingCandidate[] {
  const evidence = asEvidence(task.evidence);
  if (Array.isArray(evidence.candidates) && evidence.candidates.length > 0) {
    return evidence.candidates.map((candidate) => ({
      logicalNodeId: candidate.logicalNodeId,
      nodeLocator: candidate.nodeLocator,
      name: candidate.name,
      unitAddress: candidate.unitAddress
    }));
  }
  return task.candidateLogicalNodeIds.map((logicalNodeId) => ({ logicalNodeId }));
}

function resolveEvidenceLines(task: IdentityMappingTask): string[] {
  const evidence = asEvidence(task.evidence);
  if (Array.isArray(evidence.evidence)) {
    return evidence.evidence.map(String);
  }
  return task.reason ? [task.reason] : [];
}

function resolveRisk(task: IdentityMappingTask, candidateCount: number): string {
  const evidence = asEvidence(task.evidence);
  if (typeof evidence.risk === "string" && evidence.risk.trim()) {
    return evidence.risk;
  }
  if (candidateCount > 1) {
    return "高风险（匹配冲突）";
  }
  return "中风险";
}

function statusLabel(status: IdentityMappingTaskStatus): string {
  switch (status) {
    case "resolved":
      return "已对应";
    case "dismissed":
      return "已驳回";
    case "new_identity":
      return "确认为新身份";
    default:
      return status;
  }
}

export function IdentityMappingReview({ tasks }: IdentityMappingReviewProps) {
  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open"), [tasks]);
  const historyTasks = useMemo(
    () => tasks.filter((task) => task.status !== "open"),
    [tasks]
  );

  if (openTasks.length === 0 && historyTasks.length === 0) {
    return null;
  }

  return (
    <section className="identity-mapping-review" aria-label={PARAMETER_ADMIN_UI.identityMappingReview}>
      {openTasks.length > 0 ? (
        <>
          <h3>{PARAMETER_ADMIN_UI.identityMappingReview}</h3>
          <ul className="identity-mapping-review__list">
            {openTasks.map((task) => {
              const taskKind = resolveTaskKind(task);
              const isSingleton = taskKind === "singleton-cardinality";
              const candidates = resolveCandidates(task);
              const evidenceLines = resolveEvidenceLines(task);
              const risk = resolveRisk(task, candidates.length);
              const evidence = asEvidence(task.evidence);
              return (
                <li key={task.id} className="identity-mapping-review__item">
                  <header>
                    <strong>{evidence.previousNodeLocator ?? task.previousLogicalNodeId ?? task.id}</strong>
                    <span className={`identity-mapping-review__task-kind identity-mapping-review__task-kind--${taskKind}`}>
                      {resolveTaskKindLabel(taskKind)}
                    </span>
                    <span className="risk-badge high">{risk}</span>
                  </header>

                  {evidenceLines.length > 0 ? (
                    <div>
                      <h4>证据</h4>
                      <ul aria-label="对应依据">
                        {evidenceLines.map((line, index) => (
                          <li key={`${index}:${line}`}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div>
                    <h4>{PARAMETER_ADMIN_UI.identityMappingCandidates}</h4>
                    <ul aria-label="对应候选">
                      {candidates.map((candidate) => (
                        <li key={candidate.logicalNodeId}>
                          <code>{candidate.logicalNodeId}</code>
                          {candidate.nodeLocator ? ` · ${candidate.nodeLocator}` : null}
                          {candidate.name ? ` · ${candidate.name}` : null}
                          {candidate.unitAddress ? `@${candidate.unitAddress}` : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {isSingleton ? (
                    <p
                      className="identity-mapping-review__singleton-guidance form-hint"
                      role="status"
                      aria-label={PARAMETER_ADMIN_UI.identityMappingSingletonGuidanceLabel}
                    >
                      {PARAMETER_ADMIN_UI.identityMappingSingletonGuidance}
                    </p>
                  ) : null}

                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {historyTasks.length > 0 ? (
        <>
          <h3>历史决议</h3>
          <ul className="identity-mapping-review__list" aria-label="节点对应历史">
            {historyTasks.map((task) => {
              const evidence = asEvidence(task.evidence);
              const candidates = resolveCandidates(task);
              const currentLogicalNodeId = evidence.selectedLogicalNodeId?.trim() ?? "";
              const currentCandidate = candidates.find(
                (candidate) => candidate.logicalNodeId === currentLogicalNodeId
              );
              return (
                <li key={task.id} className="identity-mapping-review__item">
                  <header>
                    <strong>{evidence.previousNodeLocator ?? task.previousLogicalNodeId ?? task.id}</strong>
                    <span
                      className={`identity-mapping-review__task-kind identity-mapping-review__task-kind--${resolveTaskKind(task)}`}
                    >
                      {resolveTaskKindLabel(resolveTaskKind(task))}
                    </span>
                    <span className="risk-badge">{statusLabel(task.status)}</span>
                  </header>
                  {task.reason ? <p className="form-hint">原因：{task.reason}</p> : null}
                  {task.status === "resolved" && currentLogicalNodeId ? (
                    <p className="form-hint">
                      {PARAMETER_ADMIN_UI.currentIdentityMapping}：
                      {evidence.selectedNodeLocator ?? currentCandidate?.nodeLocator ?? currentLogicalNodeId}
                    </p>
                  ) : null}
                  {task.status === "resolved" ? (
                    <p className="form-hint">
                      {PARAMETER_ADMIN_UI.identityReResolveMigrationRequired}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

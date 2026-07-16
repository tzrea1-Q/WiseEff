import { useMemo, useState } from "react";
import type {
  IdentityMappingCandidate,
  IdentityMappingEvidence,
  IdentityMappingTask,
  ResolveMappingInput
} from "@/domain/parameter-topology/types";

export type IdentityMappingReviewProps = {
  tasks: IdentityMappingTask[];
  onResolve?: (taskId: string, input: ResolveMappingInput) => void | Promise<void>;
};

function asEvidence(value: IdentityMappingTask["evidence"]): IdentityMappingEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as IdentityMappingEvidence;
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
    return "高风险（歧义）";
  }
  return "中风险";
}

type Draft = {
  selectedLogicalNodeId: string;
  reason: string;
};

export function IdentityMappingReview({ tasks, onResolve }: IdentityMappingReviewProps) {
  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open"), [tasks]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  if (openTasks.length === 0) {
    return null;
  }

  return (
    <section className="identity-mapping-review" aria-label="映射审核">
      <h3>映射审核</h3>
      <ul className="identity-mapping-review__list">
        {openTasks.map((task) => {
          const candidates = resolveCandidates(task);
          const evidenceLines = resolveEvidenceLines(task);
          const risk = resolveRisk(task, candidates.length);
          const evidence = asEvidence(task.evidence);
          const draft = drafts[task.id] ?? { selectedLogicalNodeId: "", reason: "" };
          const canConfirm = Boolean(draft.selectedLogicalNodeId.trim() && draft.reason.trim());
          const busy = busyTaskId === task.id;

          return (
            <li key={task.id} className="identity-mapping-review__item">
              <header>
                <strong>{evidence.previousNodeLocator ?? task.previousLogicalNodeId ?? task.id}</strong>
                <span className="risk-badge high">{risk}</span>
              </header>

              {evidenceLines.length > 0 ? (
                <div>
                  <h4>证据</h4>
                  <ul aria-label="映射证据">
                    {evidenceLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <h4>候选逻辑节点</h4>
                <ul aria-label="映射候选">
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

              {onResolve ? (
                <div className="identity-mapping-review__form">
                  <label>
                    选择候选
                    <select
                      aria-label="选择映射候选"
                      value={draft.selectedLogicalNodeId}
                      disabled={busy}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [task.id]: { ...draft, selectedLogicalNodeId: event.target.value }
                        }))
                      }
                    >
                      <option value="">请选择逻辑节点…</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.logicalNodeId} value={candidate.logicalNodeId}>
                          {candidate.nodeLocator ?? candidate.logicalNodeId}
                          {candidate.name ? ` (${candidate.name})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    确认原因
                    <textarea
                      aria-label="映射确认原因"
                      value={draft.reason}
                      disabled={busy}
                      rows={2}
                      placeholder="说明为何选择该候选"
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [task.id]: { ...draft, reason: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <div className="param-admin-row-actions">
                    <button
                      type="button"
                      className="button primary"
                      disabled={!canConfirm || busy}
                      onClick={() => {
                        setBusyTaskId(task.id);
                        void Promise.resolve(
                          onResolve(task.id, {
                            decision: "resolved",
                            selectedLogicalNodeId: draft.selectedLogicalNodeId,
                            reason: draft.reason.trim()
                          })
                        ).finally(() => setBusyTaskId(null));
                      }}
                    >
                      {busy ? "提交中…" : "确认映射"}
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      disabled={!draft.reason.trim() || busy}
                      onClick={() => {
                        setBusyTaskId(task.id);
                        void Promise.resolve(
                          onResolve(task.id, {
                            decision: "dismissed",
                            reason: draft.reason.trim()
                          })
                        ).finally(() => setBusyTaskId(null));
                      }}
                    >
                      驳回
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

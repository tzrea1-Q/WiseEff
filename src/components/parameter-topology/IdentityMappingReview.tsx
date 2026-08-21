import { useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type {
  IdentityMappingCandidate,
  IdentityMappingEvidence,
  IdentityMappingTask,
  IdentityMappingTaskKind,
  IdentityMappingTaskStatus,
  ReopenMappingInput,
  ResolveMappingInput
} from "@/domain/parameter-topology/types";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";

export type IdentityMappingReviewProps = {
  tasks: IdentityMappingTask[];
  onResolve?: (taskId: string, input: ResolveMappingInput) => void | Promise<void>;
  onReopen?: (taskId: string, input: ReopenMappingInput) => void | Promise<void>;
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

type Draft = {
  selectedLogicalNodeId: string;
  reason: string;
  confirmAllCandidates: boolean;
};

const EMPTY_DRAFT: Draft = {
  selectedLogicalNodeId: "",
  reason: "",
  confirmAllCandidates: false
};

export function IdentityMappingReview({ tasks, onResolve, onReopen }: IdentityMappingReviewProps) {
  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open"), [tasks]);
  const historyTasks = useMemo(
    () => tasks.filter((task) => task.status !== "open"),
    [tasks]
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reResolveDrafts, setReResolveDrafts] = useState<Record<string, Draft>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [reopenReasons, setReopenReasons] = useState<Record<string, string>>({});

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
              const draft = drafts[task.id] ?? EMPTY_DRAFT;
              const canConfirm = Boolean(draft.selectedLogicalNodeId.trim() && draft.reason.trim());
              const canDeclareNewIdentity =
                draft.reason.trim().length > 0 &&
                (candidates.length <= 1 || draft.confirmAllCandidates);
              const busy = busyTaskId === task.id;

              const updateDraft = (patch: Partial<Draft>) => {
                setDrafts((current) => ({
                  ...current,
                  [task.id]: { ...draft, ...patch }
                }));
              };

              const submitResolve = (input: ResolveMappingInput) => {
                if (!onResolve) {
                  return;
                }
                setBusyTaskId(task.id);
                void Promise.resolve(onResolve(task.id, input)).finally(() => setBusyTaskId(null));
              };

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

                  {!isSingleton && onResolve ? (
                    <div className="identity-mapping-review__form">
                      <label>
                        {PARAMETER_ADMIN_UI.selectIdentityCandidate}
                        <select
                          aria-label={PARAMETER_ADMIN_UI.selectIdentityCandidate}
                          value={draft.selectedLogicalNodeId}
                          disabled={busy}
                          onChange={(event) => updateDraft({ selectedLogicalNodeId: event.target.value })}
                        >
                          <option value="">请选择拓扑节点…</option>
                          {candidates.map((candidate) => (
                            <option key={candidate.logicalNodeId} value={candidate.logicalNodeId}>
                              {candidate.nodeLocator ?? candidate.logicalNodeId}
                              {candidate.name ? ` (${candidate.name})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {PARAMETER_ADMIN_UI.identityConfirmReason}
                        <textarea
                          aria-label={PARAMETER_ADMIN_UI.identityConfirmReason}
                          value={draft.reason}
                          disabled={busy}
                          rows={2}
                          placeholder={PARAMETER_ADMIN_UI.identityConfirmReasonPlaceholder}
                          onChange={(event) => updateDraft({ reason: event.target.value })}
                        />
                      </label>
                      {candidates.length > 1 ? (
                        <label className="identity-mapping-review__confirm-all">
                          <input
                            type="checkbox"
                            aria-label={PARAMETER_ADMIN_UI.identityMappingConfirmAllCandidates}
                            checked={draft.confirmAllCandidates}
                            disabled={busy}
                            onChange={(event) => updateDraft({ confirmAllCandidates: event.target.checked })}
                          />
                          {PARAMETER_ADMIN_UI.identityMappingConfirmAllCandidates}
                        </label>
                      ) : null}
                      <div className="param-admin-row-actions">
                        <button
                          type="button"
                          className="button primary"
                          disabled={!canConfirm || busy}
                          onClick={() =>
                            submitResolve({
                              decision: "resolved",
                              selectedLogicalNodeId: draft.selectedLogicalNodeId,
                              reason: draft.reason.trim()
                            })
                          }
                        >
                          {busy ? "提交中…" : PARAMETER_ADMIN_UI.confirmIdentityMapping}
                        </button>
                        <button
                          type="button"
                          className="button subtle"
                          disabled={!canDeclareNewIdentity || busy}
                          onClick={() =>
                            submitResolve({
                              decision: "new-identity",
                              reason: draft.reason.trim(),
                              ...(candidates.length > 1 ? { confirmAllCandidates: true } : {})
                            })
                          }
                        >
                          {PARAMETER_ADMIN_UI.declareNewIdentity}
                        </button>
                        <button
                          type="button"
                          className="button subtle"
                          disabled={!draft.reason.trim() || busy}
                          onClick={() =>
                            submitResolve({
                              decision: "dismissed",
                              reason: draft.reason.trim()
                            })
                          }
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
        </>
      ) : null}

      {historyTasks.length > 0 ? (
        <>
          <h3>历史决议</h3>
          <ul className="identity-mapping-review__list" aria-label="节点对应历史">
            {historyTasks.map((task) => {
              const evidence = asEvidence(task.evidence);
              const busy = busyTaskId === task.id;
              const candidates = resolveCandidates(task);
              const canReopen =
                (task.status === "dismissed" || task.status === "new_identity") &&
                resolveTaskKind(task) === "identity-ambiguity";
              const reopenReason = reopenReasons[task.id] ?? "";
              const currentLogicalNodeId = evidence.selectedLogicalNodeId?.trim() ?? "";
              const currentCandidate = candidates.find(
                (candidate) => candidate.logicalNodeId === currentLogicalNodeId
              );
              const canOfferReResolve =
                task.status === "resolved" &&
                resolveTaskKind(task) === "identity-ambiguity" &&
                Boolean(task.previousLogicalNodeId && currentLogicalNodeId) &&
                candidates.some((candidate) => candidate.logicalNodeId === currentLogicalNodeId) &&
                candidates.some((candidate) => candidate.logicalNodeId !== currentLogicalNodeId);
              const reResolveDraft = reResolveDrafts[task.id] ?? {
                ...EMPTY_DRAFT,
                selectedLogicalNodeId: currentLogicalNodeId
              };
              const canSubmitReResolve =
                canOfferReResolve &&
                reResolveDraft.selectedLogicalNodeId.trim().length > 0 &&
                reResolveDraft.selectedLogicalNodeId !== currentLogicalNodeId &&
                reResolveDraft.reason.trim().length > 0;
              const reResolveDisabledReason = busy
                ? PARAMETER_ADMIN_UI.identityReResolveSubmitting
                : reResolveDraft.selectedLogicalNodeId === currentLogicalNodeId
                  ? PARAMETER_ADMIN_UI.identityReResolveSelectDifferent
                  : reResolveDraft.reason.trim().length === 0
                    ? PARAMETER_ADMIN_UI.identityReResolveReasonRequired
                    : undefined;

              const updateReResolveDraft = (patch: Partial<Draft>) => {
                setReResolveDrafts((current) => ({
                  ...current,
                  [task.id]: { ...reResolveDraft, ...patch }
                }));
              };

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
                  {canReopen && onReopen ? (
                    <div className="identity-mapping-review__form">
                      <label>
                        重开原因
                        <textarea
                          aria-label="重开原因"
                          value={reopenReason}
                          disabled={busy}
                          rows={2}
                          placeholder="说明为何重新打开该任务"
                          onChange={(event) =>
                            setReopenReasons((current) => ({
                              ...current,
                              [task.id]: event.target.value
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="button subtle"
                        disabled={!reopenReason.trim() || busy}
                        onClick={() => {
                          setBusyTaskId(task.id);
                          void Promise.resolve(
                            onReopen(task.id, { reason: reopenReason.trim() })
                          ).finally(() => setBusyTaskId(null));
                        }}
                      >
                        {busy ? "提交中…" : "重新打开"}
                      </button>
                    </div>
                  ) : canOfferReResolve && onResolve ? (
                    <div className="identity-mapping-review__form">
                      <p className="form-hint">
                        {PARAMETER_ADMIN_UI.identityReResolveGuidance}
                      </p>
                      <label>
                        {PARAMETER_ADMIN_UI.reselectIdentityCandidate}
                        <select
                          aria-label={PARAMETER_ADMIN_UI.reselectIdentityCandidate}
                          value={reResolveDraft.selectedLogicalNodeId}
                          disabled={busy}
                          onChange={(event) =>
                            updateReResolveDraft({ selectedLogicalNodeId: event.target.value })
                          }
                        >
                          {candidates.map((candidate) => (
                            <option key={candidate.logicalNodeId} value={candidate.logicalNodeId}>
                              {candidate.nodeLocator ?? candidate.logicalNodeId}
                              {candidate.logicalNodeId === currentLogicalNodeId ? "（当前）" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {PARAMETER_ADMIN_UI.identityReResolveReason}
                        <textarea
                          aria-label={PARAMETER_ADMIN_UI.identityReResolveReason}
                          value={reResolveDraft.reason}
                          disabled={busy}
                          rows={2}
                          placeholder={PARAMETER_ADMIN_UI.identityReResolveReasonPlaceholder}
                          onChange={(event) => updateReResolveDraft({ reason: event.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="button subtle"
                        disabled={!canSubmitReResolve || busy}
                        aria-busy={busy || undefined}
                        title={!canSubmitReResolve || busy ? reResolveDisabledReason : undefined}
                        onClick={() => {
                          setBusyTaskId(task.id);
                          void Promise.resolve(
                            onResolve(task.id, {
                              decision: "resolved",
                              selectedLogicalNodeId: reResolveDraft.selectedLogicalNodeId,
                              reason: reResolveDraft.reason.trim()
                            })
                          ).finally(() => setBusyTaskId(null));
                        }}
                      >
                        {busy ? (
                          <>
                            <LoaderCircle
                              className="dts-status-icon dts-status-icon--spin"
                              size={16}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            提交中…
                          </>
                        ) : (
                          PARAMETER_ADMIN_UI.confirmIdentityReResolve
                        )}
                      </button>
                    </div>
                  ) : task.status === "resolved" ? (
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

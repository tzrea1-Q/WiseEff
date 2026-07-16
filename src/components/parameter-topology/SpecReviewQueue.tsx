import { useMemo, useState } from "react";

export type SpecReviewCandidate = {
  id: string;
  label: string;
  propertyKey?: string | null;
  driverModule?: string | null;
};

export type SpecReviewTaskView = {
  id: string;
  propertyKey: string;
  driverModule: string | null;
  evidence: string[];
  candidates: SpecReviewCandidate[];
  ambiguous: boolean;
  projectCount: number;
};

export type SpecReviewApproveInput = {
  taskId: string;
  parameterSpecId: string;
  reason: string;
  confirmPropertyMismatch?: boolean;
};

export type SpecReviewQueueProps = {
  tasks: readonly SpecReviewTaskView[];
  librarySpecs?: readonly SpecReviewCandidate[];
  onApprove: (input: SpecReviewApproveInput) => void;
  onDismiss?: (input: { taskId: string; reason: string }) => void;
  onCreateSpec?: (input: { taskId: string; propertyKey: string; driverModule: string | null; reason: string }) => void;
  pendingTaskId?: string | null;
  pendingAction?: "approve" | "dismiss" | "create" | null;
};

type DraftState = {
  schemaId: string;
  reason: string;
  libraryQuery: string;
  confirmMismatch: boolean;
  createMode: boolean;
};

function selectedSpec(
  task: SpecReviewTaskView,
  librarySpecs: readonly SpecReviewCandidate[],
  schemaId: string
): SpecReviewCandidate | undefined {
  return (
    task.candidates.find((item) => item.id === schemaId) ??
    librarySpecs.find((item) => item.id === schemaId)
  );
}

export function SpecReviewQueue({
  tasks,
  librarySpecs = [],
  onApprove,
  onDismiss,
  onCreateSpec,
  pendingTaskId = null,
  pendingAction = null
}: SpecReviewQueueProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

  const openTasks = useMemo(() => tasks, [tasks]);

  return (
    <section className="spec-review-queue" aria-label="规格审核队列">
      <div className="parameters-table-heading">
        <div>
          <h2>规格审核队列</h2>
          <p>可从候选或全库搜索选择 Schema；属性键不一致时需额外确认。未匹配任务可创建草稿规格（需激活后再裁决）。</p>
        </div>
      </div>

      {openTasks.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有待审核的推理规格。</p>
        </div>
      ) : (
        <ul className="spec-review-queue__list">
          {openTasks.map((task) => {
            const draft = drafts[task.id] ?? {
              schemaId: "",
              reason: "",
              libraryQuery: "",
              confirmMismatch: false,
              createMode: false
            };
            const filteredLibrary = librarySpecs.filter((item) => {
              const query = draft.libraryQuery.trim().toLowerCase();
              if (!query) return true;
              return (
                item.label.toLowerCase().includes(query) ||
                (item.propertyKey ?? "").toLowerCase().includes(query) ||
                (item.driverModule ?? "").toLowerCase().includes(query)
              );
            });
            const options = [
              ...task.candidates,
              ...filteredLibrary.filter((item) => !task.candidates.some((candidate) => candidate.id === item.id))
            ];
            const picked = draft.schemaId ? selectedSpec(task, librarySpecs, draft.schemaId) : undefined;
            const propertyMismatch =
              Boolean(picked?.propertyKey) && picked?.propertyKey !== task.propertyKey;
            const canApprove =
              Boolean(draft.schemaId.trim() && draft.reason.trim()) &&
              (!propertyMismatch || draft.confirmMismatch);
            const isPending = pendingTaskId === task.id;

            return (
              <li key={task.id} className="spec-review-queue__item">
                <header>
                  <strong>{task.propertyKey}</strong>
                  {task.driverModule ? <span> · {task.driverModule}</span> : null}
                  {task.ambiguous ? <span className="risk-badge medium">歧义</span> : null}
                  {task.candidates.length === 0 ? (
                    <span className="risk-badge high">未匹配</span>
                  ) : null}
                  <small>{task.projectCount} 个受影响项目</small>
                </header>

                <div>
                  <h4>推理证据</h4>
                  <ul>
                    {task.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                {task.candidates.length > 0 ? (
                  <div>
                    <h4>候选 Schema</h4>
                    <ul>
                      {task.candidates.map((candidate) => (
                        <li key={candidate.id}>{candidate.label}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="spec-review-queue__form">
                  <label>
                    搜索规格库
                    <input
                      aria-label="搜索规格库"
                      value={draft.libraryQuery}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [task.id]: { ...draft, libraryQuery: event.target.value }
                        }))
                      }
                      placeholder="按属性键、驱动或规格键搜索"
                    />
                  </label>

                  <label>
                    选择 Schema
                    <select
                      aria-label="选择 Schema"
                      value={draft.schemaId}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [task.id]: {
                            ...draft,
                            schemaId: event.target.value,
                            confirmMismatch: false,
                            createMode: false
                          }
                        }))
                      }
                    >
                      <option value="">请选择 Schema…</option>
                      {options.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {picked ? (
                    <p className="spec-review-queue__picked-detail">
                      已选：{picked.label}
                      {picked.propertyKey ? ` · 属性 ${picked.propertyKey}` : ""}
                      {picked.driverModule ? ` · 驱动 ${picked.driverModule}` : ""}
                    </p>
                  ) : null}

                  {propertyMismatch ? (
                    <label className="spec-review-queue__mismatch-warning">
                      <input
                        type="checkbox"
                        checked={draft.confirmMismatch}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [task.id]: { ...draft, confirmMismatch: event.target.checked }
                          }))
                        }
                      />
                      高风险：所选规格属性键为「{picked?.propertyKey}」，与任务「{task.propertyKey}」不一致。确认后继续。
                    </label>
                  ) : null}

                  <label>
                    审核原因
                    <textarea
                      aria-label="审核原因"
                      value={draft.reason}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [task.id]: { ...draft, reason: event.target.value }
                        }))
                      }
                      rows={2}
                      placeholder="说明为何选择该 Schema"
                    />
                  </label>

                  <div className="param-admin-row-actions">
                    <button
                      type="button"
                      className="button primary"
                      disabled={!canApprove || isPending}
                      onClick={() =>
                        onApprove({
                          taskId: task.id,
                          parameterSpecId: draft.schemaId,
                          reason: draft.reason.trim(),
                          confirmPropertyMismatch: propertyMismatch ? draft.confirmMismatch : undefined
                        })
                      }
                    >
                      {isPending && pendingAction === "approve" ? "批准中…" : "批准"}
                    </button>
                    {onCreateSpec && task.candidates.length === 0 ? (
                      <button
                        type="button"
                        className="button subtle"
                        disabled={!draft.reason.trim() || isPending}
                        onClick={() =>
                          onCreateSpec({
                            taskId: task.id,
                            propertyKey: task.propertyKey,
                            driverModule: task.driverModule,
                            reason: draft.reason.trim()
                          })
                        }
                      >
                        {isPending && pendingAction === "create" ? "创建中…" : "创建草稿规格"}
                      </button>
                    ) : null}
                    {onDismiss ? (
                      <button
                        type="button"
                        className="button subtle"
                        disabled={!draft.reason.trim() || isPending}
                        onClick={() => onDismiss({ taskId: task.id, reason: draft.reason.trim() })}
                      >
                        {isPending && pendingAction === "dismiss" ? "驳回中…" : "驳回"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

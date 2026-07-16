import { useMemo, useState } from "react";

export type SpecReviewCandidate = {
  id: string;
  label: string;
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
};

export type SpecReviewQueueProps = {
  tasks: readonly SpecReviewTaskView[];
  onApprove: (input: SpecReviewApproveInput) => void;
  onDismiss?: (input: { taskId: string; reason: string }) => void;
};

type DraftState = {
  schemaId: string;
  reason: string;
};

export function SpecReviewQueue({ tasks, onApprove, onDismiss }: SpecReviewQueueProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

  const openTasks = useMemo(() => tasks, [tasks]);

  return (
    <section className="spec-review-queue" aria-label="规格审核队列">
      <div className="parameters-table-heading">
        <div>
          <h2>规格审核队列</h2>
          <p>推理或歧义规格需显式选择 Schema 并填写原因后才能批准；不提供“接受第一个候选”。</p>
        </div>
      </div>

      {openTasks.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有待审核的推理规格。</p>
        </div>
      ) : (
        <ul className="spec-review-queue__list">
          {openTasks.map((task) => {
            const draft = drafts[task.id] ?? { schemaId: "", reason: "" };
            const canApprove = Boolean(draft.schemaId.trim() && draft.reason.trim());

            return (
              <li key={task.id} className="spec-review-queue__item">
                <header>
                  <strong>{task.propertyKey}</strong>
                  {task.driverModule ? <span> · {task.driverModule}</span> : null}
                  {task.ambiguous ? <span className="risk-badge medium">歧义</span> : null}
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

                <div>
                  <h4>候选 Schema</h4>
                  <ul>
                    {task.candidates.map((candidate) => (
                      <li key={candidate.id}>{candidate.label}</li>
                    ))}
                  </ul>
                </div>

                <div className="spec-review-queue__form">
                  <label>
                    选择 Schema
                    <select
                      aria-label="选择 Schema"
                      value={draft.schemaId}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [task.id]: { ...draft, schemaId: event.target.value }
                        }))
                      }
                    >
                      <option value="">请选择 Schema…</option>
                      {task.candidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                    </select>
                  </label>

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
                      disabled={!canApprove}
                      onClick={() =>
                        onApprove({
                          taskId: task.id,
                          parameterSpecId: draft.schemaId,
                          reason: draft.reason.trim()
                        })
                      }
                    >
                      批准
                    </button>
                    {onDismiss ? (
                      <button
                        type="button"
                        className="button subtle"
                        disabled={!draft.reason.trim()}
                        onClick={() => onDismiss({ taskId: task.id, reason: draft.reason.trim() })}
                      >
                        驳回
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

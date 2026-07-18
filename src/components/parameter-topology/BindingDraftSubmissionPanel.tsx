import { useEffect, useState } from "react";
import type {
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import type { BindingDraftResult } from "@/application/ports/ParameterTopologyRepository";

export type PendingBindingDraft = BindingDraftResult & { projectId: string; reason: string };

export type BindingDraftSubmissionPanelProps = {
  projectId: string;
  draft: PendingBindingDraft;
  candidates: WorkflowAssigneeCandidates | null;
  candidatesError?: string | null;
  onSubmit: (
    input: SubmitParameterChangesInput
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  onNavigate: (path: string) => void;
};

export function BindingDraftSubmissionPanel({
  projectId,
  draft,
  candidates,
  candidatesError = null,
  onSubmit,
  onNavigate
}: BindingDraftSubmissionPanelProps) {
  const [hardwareCommitterId, setHardwareCommitterId] = useState("");
  const [softwareCommitterId, setSoftwareCommitterId] = useState("");
  const [softwareUserId, setSoftwareUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHardwareCommitterId(candidates?.hardwareCommitters[0]?.id ?? "");
    setSoftwareCommitterId(candidates?.softwareCommitters[0]?.id ?? "");
    setSoftwareUserId(candidates?.softwareUsers[0]?.id ?? "");
  }, [candidates]);

  useEffect(() => {
    setSubmitted(false);
    setError(null);
  }, [draft.draftId]);

  const assigneesReady = Boolean(hardwareCommitterId && softwareCommitterId && softwareUserId);

  return (
    <section className="binding-draft-submission" role="region" aria-label="绑定变更提交">
      <header>
        <h3>提交 binding 变更</h3>
        <p>
          <code>{draft.writeTarget.propertyKey}</code> · candidate <code>{draft.candidateRevisionId}</code>
        </p>
      </header>
      <dl>
        <div>
          <dt>{draft.action === "delete" ? "操作" : "目标值"}</dt>
          <dd><code>{draft.action === "delete" ? "删除属性" : draft.rawText}</code></dd>
        </div>
        <div>
          <dt>修改原因</dt>
          <dd>{draft.reason}</dd>
        </div>
      </dl>

      {candidatesError ? <p className="form-error" role="alert">{candidatesError}</p> : null}
      {!candidates && !candidatesError ? <p role="status">正在加载项目角色候选人…</p> : null}
      {candidates ? (
        <div className="submission-assignee-grid" aria-label="后续流程处理人">
          <label>
            硬件 MDE
            <select aria-label="硬件 MDE" value={hardwareCommitterId} onChange={(event) => setHardwareCommitterId(event.target.value)}>
              {candidates.hardwareCommitters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <label>
            软件 MDE
            <select aria-label="软件 MDE" value={softwareCommitterId} onChange={(event) => setSoftwareCommitterId(event.target.value)}>
              {candidates.softwareCommitters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <label>
            软件开发
            <select aria-label="软件开发" value={softwareUserId} onChange={(event) => setSoftwareUserId(event.target.value)}>
              {candidates.softwareUsers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {submitted ? <p role="status">已提交正式审核，后续阶段将在审核队列中按角色推进。</p> : null}
      <div className="binding-draft-submission__actions">
        <button
          type="button"
          className="button primary"
          disabled={!assigneesReady || submitting || submitted || Boolean(candidatesError)}
          onClick={() => {
            setSubmitting(true);
            setError(null);
            void onSubmit({
              projectId,
              items: [
                {
                  draftId: draft.draftId,
                  action: draft.action,
                  targetValue: draft.rawText,
                  reason: draft.reason,
                  projectParameterBindingId: draft.projectParameterBindingId,
                  parameterSpecId: draft.parameterSpecId
                }
              ],
              assignees: { hardwareCommitterId, softwareCommitterId, softwareUserId }
            })
              .then((result) => {
                if (result && "notification" in result) {
                  setError(result.notification);
                  return;
                }
                setSubmitted(true);
              })
              .catch((submitError: unknown) => {
                setError(submitError instanceof Error ? submitError.message : "提交审核失败。");
              })
              .finally(() => setSubmitting(false));
          }}
        >
          {submitting ? "提交中…" : "提交审核"}
        </button>
        {submitted ? (
          <button type="button" className="button subtle" onClick={() => onNavigate("/parameter-review")}>查看审核队列</button>
        ) : null}
      </div>
    </section>
  );
}

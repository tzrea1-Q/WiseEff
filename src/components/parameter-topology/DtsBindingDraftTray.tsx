import { useEffect, useMemo, useState } from "react";

import type {
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import type { BindingDraftResult } from "@/application/ports/ParameterTopologyRepository";

export type PendingBindingDraft = BindingDraftResult & {
  projectId: string;
  currentRawValue: string;
  reason: string;
};

export type DtsBindingDraftTrayProps = {
  projectId: string;
  drafts: PendingBindingDraft[];
  candidates: WorkflowAssigneeCandidates | null;
  candidatesError?: string | null;
  onRemove: (draftId: string) => void;
  onSubmit?: (
    input: SubmitParameterChangesInput
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  onNavigate: (path: string) => void;
};

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function identityBlocker(projectId: string, drafts: PendingBindingDraft[]): string | null {
  const incomplete = drafts.some((draft) =>
    draft.projectId !== projectId ||
    !nonBlank(draft.draftId) ||
    !nonBlank(draft.candidateRevisionId) ||
    !nonBlank(draft.projectParameterBindingId) ||
    !nonBlank(draft.parameterSpecId) ||
    !nonBlank(draft.writeTarget.propertyKey) ||
    !nonBlank(draft.reason)
  );
  return incomplete ? "草稿缺少完整的项目、candidate、binding 或规格身份，已阻止提交。" : null;
}

function candidateBlocker(drafts: PendingBindingDraft[]): string | null {
  const candidateIds = new Set(drafts.map((draft) => draft.candidateRevisionId));
  return candidateIds.size > 1
    ? "本轮修改属于不同 candidate revision，当前不能批量提交；请仅保留同一 candidate 的草稿。"
    : null;
}

export function DtsBindingDraftTray({
  projectId,
  drafts,
  candidates,
  candidatesError = null,
  onRemove,
  onSubmit,
  onNavigate
}: DtsBindingDraftTrayProps) {
  const [hardwareCommitterId, setHardwareCommitterId] = useState("");
  const [softwareCommitterId, setSoftwareCommitterId] = useState("");
  const [softwareUserId, setSoftwareUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const draftIdentityKey = drafts.map((draft) => draft.draftId).join(":");
  useEffect(() => {
    setSubmitted(false);
    setSubmitError(null);
  }, [draftIdentityKey]);

  useEffect(() => {
    setHardwareCommitterId(candidates?.hardwareCommitters[0]?.id ?? "");
    setSoftwareCommitterId(candidates?.softwareCommitters[0]?.id ?? "");
    setSoftwareUserId(candidates?.softwareUsers[0]?.id ?? "");
  }, [candidates]);

  const draftIdentityError = useMemo(
    () => identityBlocker(projectId, drafts),
    [drafts, projectId]
  );
  const candidateError = useMemo(() => candidateBlocker(drafts), [drafts]);
  const roleError = candidates && !(hardwareCommitterId && softwareCommitterId && softwareUserId)
    ? "项目缺少完整的硬件 MDE、软件 MDE 或软件开发候选人，已阻止提交。"
    : null;
  const submissionEntryError = onSubmit
    ? null
    : "正式 binding 提交入口未配置，已阻止提交。";
  const blocker = candidatesError ?? draftIdentityError ?? candidateError ?? roleError ?? submissionEntryError;
  const canSubmit = Boolean(
    drafts.length > 0 &&
    candidates &&
    !blocker &&
    !submitting &&
    !submitted
  );

  if (drafts.length === 0) return null;

  return (
    <section className="dts-binding-draft-tray binding-draft-submission" role="region" aria-label="绑定变更提交">
      <header>
        <div>
          <p className="eyebrow">Current edits</p>
          <h3>本轮已修改</h3>
          <p>仅提交具有完整 binding / spec / candidate 身份的 typed draft。</p>
        </div>
        <span>{drafts.length} 项</span>
      </header>

      <div className="dts-binding-draft-tray__items">
        {drafts.map((draft) => (
          <article className="dts-binding-draft-tray__item" key={draft.draftId}>
            <div className="dts-binding-draft-tray__item-heading">
              <div>
                <strong><code>{draft.writeTarget.propertyKey}</code></strong>
                <span>{draft.action === "delete" ? "删除属性（tombstone）" : "设置属性"}</span>
              </div>
              <button
                type="button"
                className="button subtle"
                aria-label="移出本轮修改"
                onClick={() => onRemove(draft.draftId)}
              >
                移除
              </button>
            </div>
            <div className="dts-binding-draft-tray__diff" aria-label={`${draft.writeTarget.propertyKey} 值变更`}>
              <code>{draft.currentRawValue || "（属性不存在）"}</code>
              <span aria-hidden="true">→</span>
              <code>{draft.action === "delete" ? "删除属性（tombstone）" : draft.rawText}</code>
            </div>
            <p><strong>原因：</strong>{draft.reason}</p>
            <dl className="dts-binding-draft-tray__identity">
              <div><dt>action</dt><dd><code>{draft.action}</code></dd></div>
              <div><dt>candidate</dt><dd><code>{draft.candidateRevisionId}</code></dd></div>
              <div><dt>draft</dt><dd><code>{draft.draftId}</code></dd></div>
              <div><dt>binding</dt><dd><code>{draft.projectParameterBindingId}</code></dd></div>
              <div><dt>spec</dt><dd><code>{draft.parameterSpecId}</code></dd></div>
            </dl>
          </article>
        ))}
      </div>

      {!candidates && !candidatesError ? <p role="status">正在加载项目角色候选人…</p> : null}
      {candidates ? (
        <div className="submission-assignee-grid" aria-label="后续流程处理人">
          <label>
            硬件 MDE
            <select aria-label="硬件 MDE" value={hardwareCommitterId} onChange={(event) => setHardwareCommitterId(event.target.value)}>
              {candidates.hardwareCommitters.length === 0 ? <option value="">无可用候选人</option> : null}
              {candidates.hardwareCommitters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <label>
            软件 MDE
            <select aria-label="软件 MDE" value={softwareCommitterId} onChange={(event) => setSoftwareCommitterId(event.target.value)}>
              {candidates.softwareCommitters.length === 0 ? <option value="">无可用候选人</option> : null}
              {candidates.softwareCommitters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <label>
            软件开发
            <select aria-label="软件开发" value={softwareUserId} onChange={(event) => setSoftwareUserId(event.target.value)}>
              {candidates.softwareUsers.length === 0 ? <option value="">无可用候选人</option> : null}
              {candidates.softwareUsers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {blocker ? <p className="form-error" role="alert">{blocker}</p> : null}
      {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
      {submitted ? <p role="status">已提交正式审核，后续阶段将在审核队列中按角色推进。</p> : null}

      <div className="binding-draft-submission__actions">
        <button
          type="button"
          className="button primary"
          disabled={!canSubmit}
          onClick={() => {
            if (!onSubmit || !canSubmit) return;
            setSubmitting(true);
            setSubmitError(null);
            void onSubmit({
              projectId,
              items: drafts.map((draft) => ({
                draftId: draft.draftId,
                projectParameterBindingId: draft.projectParameterBindingId,
                parameterSpecId: draft.parameterSpecId,
                action: draft.action,
                targetValue: draft.rawText,
                reason: draft.reason
              })),
              assignees: { hardwareCommitterId, softwareCommitterId, softwareUserId }
            })
              .then((result) => {
                if (result && "notification" in result) {
                  setSubmitError(result.notification);
                  return;
                }
                setSubmitted(true);
              })
              .catch((error: unknown) => {
                setSubmitError(error instanceof Error ? error.message : "提交审核失败。");
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

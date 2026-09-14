import { useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import type {
  CatalogDefinitionResponse,
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobResponse
} from "@/infrastructure/http/parameterCatalogDtos";

import { canExecutePublicationAction, definitionContentOf, emptyPublicationDraft } from "./publicationState";
import { createGovernanceIdempotencyKey, createGovernanceSubmitGate } from "./governanceState";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";

export type DefinitionLifecycleIntent = "retire-definition" | "restore-definition";

export type DefinitionLifecycleDialogProps = {
  open: boolean;
  intent: DefinitionLifecycleIntent;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  domainState: CatalogDomainState;
  catalog: ParameterCatalogRepository;
  catalogReleaseId: string;
  definition: CatalogDefinitionResponse["item"];
  createIdempotencyKey?: () => string;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
};

const copy = {
  "retire-definition": {
    title: "弃用参数定义",
    action: "确认弃用",
    explanation:
      "弃用会把共享定义置为已退役：保留稳定身份、历史修订与已固定的项目引用，但阻止新的匹配与使用。",
    impact: "共享目录中的其他组织将无法再为该身份建立新的匹配或引用。"
  },
  "restore-definition": {
    title: "恢复参数定义",
    action: "确认恢复",
    explanation: "恢复会以同一身份与属性键重新发布 active 修订；历史修订保持不变。",
    impact: "共享目录中的其他组织可以再次为该身份建立新的匹配与引用。"
  }
} as const;

function jobIsPending(status: string): boolean {
  return status === "queued" || status === "running";
}

/**
 * Definition lifecycle (issue #847 decision 10).
 *
 * One dialog performs the whole operation: it captures the shared impact, the
 * administrator confirms once, the change is published through the existing
 * governed pipeline, and the dialog reports the actual activation result rather
 * than the accepted request. Edits after the preview invalidate it.
 */
export function DefinitionLifecycleDialog({
  open,
  intent,
  actor,
  sessionPermissions,
  domainState,
  catalog,
  catalogReleaseId,
  definition,
  createIdempotencyKey,
  onOpenChange,
  onCompleted,
  onRefreshEvidence
}: DefinitionLifecycleDialogProps) {
  const gateRef = useRef(createGovernanceSubmitGate());
  const pollRef = useRef<number | null>(null);
  const [reason, setReason] = useState("");
  const [candidate, setCandidate] = useState<CatalogPublicationCandidateResponse["item"] | null>(null);
  const [job, setJob] = useState<CatalogPublicationJobResponse["item"] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [failure, setFailure] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const allowed = canExecutePublicationAction(
    actor,
    intent === "retire-definition" ? "preview-publication" : "publish-publication",
    domainState,
    sessionPermissions
  );
  const contentText = copy[intent];

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  useEffect(() => {
    if (!open) {
      stopPolling();
      return;
    }
    gateRef.current = createGovernanceSubmitGate();
    setReason("");
    setCandidate(null);
    setJob(null);
    setConfirmOpen(false);
    setPending(false);
    setFieldError("");
    setFailure("");
    setIdempotencyKey(null);
  }, [open]);

  const lifecycleDraft = () => {
    const draft = emptyPublicationDraft();
    return {
      ...draft,
      mode: intent,
      definitionId: definition.id,
      reviseClass: "semantic" as const,
      propertyKey: definition.propertyKey,
      displayName: definition.currentRevision.displayName,
      documentation: definition.currentRevision.documentation ?? "",
      valueType: "mixed" as const,
      reason
    };
  };

  const pollJob = async (jobId: string) => {
    try {
      const response = await catalog.getPublication(jobId);
      setJob(response.item);
      if (!jobIsPending(response.item.status)) {
        stopPolling();
        if (response.item.currentness !== null) {
          void onRefreshEvidence?.();
        }
      }
    } catch (error) {
      stopPolling();
      setFailure(publicationFailureText(error));
    }
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    void pollJob(jobId);
    pollRef.current = window.setInterval(() => void pollJob(jobId), 1000);
  };

  const captureCandidate = async () => {
    if (!allowed || pending) {
      return;
    }
    if (!reason.trim()) {
      setFieldError("请填写原因，用于审计。");
      return;
    }
    setPending(true);
    try {
      const draft = lifecycleDraft();
      const created = await catalog.createPublicationCandidate(
        {
          changeSet: [
            {
              op: intent,
              definitionId: definition.id,
              class: "semantic",
              ...(reason.trim() ? { reason: reason.trim() } : {}),
              content: definitionContentOf(draft)
            }
          ] as never
        },
        { catalogReleaseId }
      );
      setCandidate(created.item);
      setFieldError("");
      setFailure("");
      setConfirmOpen(true);
    } catch (error) {
      setFieldError(publicationFailureText(error));
    } finally {
      setPending(false);
    }
  };

  const publish = async () => {
    if (!candidate || pending) {
      return;
    }
    setPending(true);
    const key = idempotencyKey ?? (createIdempotencyKey ?? createGovernanceIdempotencyKey)();
    setIdempotencyKey(key);
    try {
      const published = await catalog.publishPublicationCandidate(
        candidate.id,
        { idempotencyKey: key },
        { catalogReleaseId }
      );
      setJob(published.item);
      setConfirmOpen(false);
      if (jobIsPending(published.item.status)) {
        startPolling(published.item.id);
      } else {
        void onRefreshEvidence?.();
      }
      onCompleted?.();
    } catch (error) {
      setFailure(publicationFailureText(error));
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  };

  const status = job ? jobStatusText(job) : null;

  return (
    <>
      <ModalDialog
        open={open}
        onDismiss={pending ? undefined : () => onOpenChange(false)}
        className="confirm-dialog governance-confirm-dialog definition-lifecycle-dialog"
        initialFocusRef={undefined}
      >
        <h2>{contentText.title}</h2>
        <p>{contentText.explanation}</p>
        <dl className="parameter-catalog__dl">
          <dt>属性键</dt>
          <dd>{definition.propertyKey}</dd>
          <dt>主体</dt>
          <dd>{definition.subject.canonicalName}</dd>
          <dt>当前生命周期</dt>
          <dd>{definition.lifecycle}</dd>
          <dt>当前修订</dt>
          <dd>{`修订 #${definition.currentRevision.revisionNumber}`}</dd>
          <dt>共享影响</dt>
          <dd>
            {`策略 ${definition.usageSummary.policyCount} · 项目 ${definition.usageSummary.projectCount} · 当前值 ${definition.usageSummary.currentValueCount}`}
          </dd>
        </dl>
        <p role="note">{contentText.impact}</p>
        <label>
          <span>原因</span>
          <textarea
            value={reason}
            aria-label="原因"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {fieldError ? (
          <p role="alert" data-preserve-input="true">
            {fieldError}
          </p>
        ) : null}
        {failure ? (
          <p role="alert" data-silent-retry="true">
            {failure}
          </p>
        ) : null}
        {status ? (
          <p role="status" data-lifecycle-status={job?.status}>
            {status}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="button ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </button>
          <button
            type="button"
            className="button primary"
            data-lifecycle-action={intent}
            disabled={!allowed || pending || !reason.trim()}
            title={allowed ? undefined : "当前会话缺少发布能力或目录不可写。"}
            onClick={() => void captureCandidate()}
          >
            {pending && !candidate ? "正在预演…" : "预演影响"}
          </button>
        </div>
      </ModalDialog>
      <ConfirmDialog
        open={confirmOpen}
        title={`确认${intent === "retire-definition" ? "弃用" : "恢复"}`}
        description={impactSummary(candidate, definition, intent)}
        confirmLabel={contentText.action}
        pending={pending}
        pendingLabel="正在发布…"
        error={failure}
        onConfirm={() => void publish()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function impactSummary(
  candidate: CatalogPublicationCandidateResponse["item"] | null,
  definition: CatalogDefinitionResponse["item"],
  intent: DefinitionLifecycleIntent
): string {
  const changed = candidate?.impactSummary.changedDefinitionCount ?? 0;
  const added = candidate?.impactSummary.addedDefinitionCount ?? 0;
  return [
    `将发布 1 个修订用于${intent === "retire-definition" ? "弃用" : "恢复"} ${definition.propertyKey}。`,
    `变更定义 ${changed} · 新增定义 ${added}。`,
    `共享目录影响：策略 ${definition.usageSummary.policyCount} · 项目 ${definition.usageSummary.projectCount} · 当前值 ${definition.usageSummary.currentValueCount}。`,
    "已固定历史引用的项目不会自动改动。"
  ].join("\n");
}

function jobStatusText(job: CatalogPublicationJobResponse["item"]): string {
  if (job.effective && job.currentness) {
    return job.currentness === "active"
      ? "已生效：当前目录已包含该修订。"
      : "已激活，但已被更晚的目录发布取代。";
  }
  if (job.status === "needs-rebase") {
    return "目录已推进，需要重新预演后再发布。";
  }
  if (job.status === "blocked") {
    return "发布被阻止，请检查策略与采用状态。";
  }
  if (job.status === "failed-terminal") {
    return "发布失败，且不会自动重试。";
  }
  if (job.status === "failed-retryable") {
    return "发布暂时失败，可按既有幂等键重试。";
  }
  return "发布已接受，正在等待激活结果…";
}

function publicationFailureText(error: unknown): string {
  // Only a typed catalog failure can name a reason; anything else (a transport
  // failure, for example) must still produce readable copy instead of throwing.
  let reason: string;
  try {
    reason = catalogFailureReason(error as never);
  } catch {
    reason = "unknown";
  }
  const state = catalogStateFromFailure(error);
  return reason === "unknown"
    ? `操作失败（${state.kind}）。请刷新证据后重试，输入已保留。`
    : `操作失败（${reason}）。请刷新证据后重试，输入已保留。`;
}

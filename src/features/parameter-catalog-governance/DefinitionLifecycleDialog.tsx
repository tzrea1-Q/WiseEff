import { useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import type {
  CatalogCreatePublicationCandidateRequest,
  CatalogDefinitionResponse,
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobResponse
} from "@/infrastructure/http/parameterCatalogDtos";

import { canExecutePublicationAction, publicationStatusCopy } from "./publicationState";
import { createGovernanceIdempotencyKey, createGovernanceSubmitGate } from "./governanceState";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { catalogErrorCopy } from "@/features/parameter-catalog/copy";
import { catalogLifecycleLabel } from "@/features/parameter-catalog/catalogPresentation";
import { DEFINITION_BATCH_LIMIT, MOCK_DEFINITION_BATCH_UNSUPPORTED } from "@/application/parameter-catalog/definitionBatch";
import { formatUsageSummary } from "./formatUsageSummary";

export type DefinitionLifecycleIntent = "retire-definition" | "restore-definition";

export type DefinitionLifecycleDialogProps = {
  open: boolean;
  intent: DefinitionLifecycleIntent;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  domainState: CatalogDomainState;
  catalog: ParameterCatalogRepository;
  catalogReleaseId: string;
  mode: "single" | "batch";
  definitions: CatalogDefinitionResponse["item"][];
  runtimeMode?: WiseEffRuntimeMode;
  createIdempotencyKey?: () => string;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
};

const copy = {
  "retire-definition": {
    verb: "退役",
    title: "退役参数定义",
    action: "确认退役",
    explanation:
      "退役会把共享定义置为已退役：保留稳定身份、历史修订与已固定的项目引用，但阻止新的匹配与使用。",
    impact: "共享目录中的其他组织将无法再为该身份建立新的匹配或引用。"
  },
  "restore-definition": {
    verb: "恢复",
    title: "恢复参数定义",
    action: "确认恢复",
    explanation: "恢复会以同一身份与属性键重新发布生效修订；历史修订保持不变。",
    impact: "共享目录中的其他组织可以再次为该身份建立新的匹配与引用。"
  }
} as const;

function jobIsPending(status: string): boolean {
  return status === "queued" || status === "running";
}

type LifecycleContent = Extract<
  CatalogCreatePublicationCandidateRequest["changeSet"][number],
  { content: unknown }
>["content"];

function lifecycleContentOf(definition: CatalogDefinitionResponse["item"]): LifecycleContent {
  const revision = definition.currentRevision;
  return {
    displayName: revision.displayName,
    documentation: revision.documentation ?? "",
    ...(revision.unit ? { unit: revision.unit.symbol } : {}),
    valueSchema: revision.valueShape.schema as LifecycleContent["valueSchema"]
  };
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
  mode,
  definitions,
  runtimeMode,
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
  const batch = mode === "batch";
  const targets = definitions;
  const definition = targets[0]!;
  const policyUnavailable = targets.some((item) => item.usageSummary.policyCount === null);
  const usage = `本组织使用量：${formatUsageSummary({ policyCount: policyUnavailable ? null : targets.reduce((sum, item) => sum + (item.usageSummary.policyCount ?? 0), 0), projectCount: targets.reduce((sum, item) => sum + item.usageSummary.projectCount, 0), currentValueCount: targets.reduce((sum, item) => sum + item.usageSummary.currentValueCount, 0) })}`;

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

  const pollJob = async (jobId: string) => {
    try {
      const response = await catalog.getPublication(jobId);
      setJob(response.item);
      if (!jobIsPending(response.item.status)) {
        stopPolling();
      }
    } catch (error) {
      stopPolling();
      setFailure(publicationFailureText(error));
    }
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(() => void pollJob(jobId), 1000);
    void pollJob(jobId);
  };

  const captureCandidate = async () => {
    if (!allowed || pending) {
      return;
    }
    if (!batch && !reason.trim()) {
      setFieldError("请填写原因，用于审计。");
      return;
    }
    setPending(true);
    try {
      const created = await catalog.createPublicationCandidate(
        {
          changeSet: targets.map((target) => ({
              op: intent,
              definitionId: target.id,
              class: "semantic",
              ...(reason.trim() ? { reason: reason.trim() } : {}),
              content: lifecycleContentOf(target)
            })) as never
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
      }
    } catch (error) {
      setFailure(publicationFailureText(error));
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  };

  const effective = Boolean(job?.effective && job.currentness);
  const status = job ? jobStatusText(job, targets.length, intent) : null;
  const close = async () => {
    if (pending) return;
    if (effective) {
      setPending(true);
      try {
        await onRefreshEvidence?.();
        onCompleted?.();
      } catch (error) {
        setFailure(publicationFailureText(error));
        setPending(false);
        return;
      }
      setPending(false);
    }
    onOpenChange(false);
  };

  return (
    <>
      <ModalDialog
        open={open}
        onDismiss={pending ? undefined : () => void close()}
        className="confirm-dialog governance-confirm-dialog definition-lifecycle-dialog"
        initialFocusRef={undefined}
      >
        <h2>{batch ? `${contentText.verb} ${targets.length} 个参数定义` : contentText.title}</h2>
        <p>{contentText.explanation}</p>
        {batch ? <><p>{usage}</p><ul>{targets.map((item) => <li key={item.id}>{item.propertyKey} · {item.subject.canonicalName}</li>)}</ul></> : <dl className="parameter-catalog__dl">
          <dt>属性键</dt>
          <dd>{definition.propertyKey}</dd>
          <dt>主体</dt>
          <dd>{definition.subject.canonicalName}</dd>
          <dt>当前生命周期</dt>
          <dd>{catalogLifecycleLabel(definition.lifecycle)}</dd>
          <dt>当前修订</dt>
          <dd>{`修订 #${definition.currentRevision.revisionNumber}`}</dd>
          <dt>共享影响</dt>
          <dd>
            {formatUsageSummary(definition.usageSummary)}
          </dd>
        </dl>}
        <p role="note">{contentText.impact}</p>
        <label>
          <span>原因{batch ? "（可选）" : ""}</span>
          <textarea
            value={reason}
            aria-label="原因"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {batch && runtimeMode === "mock" ? <p role="status">{MOCK_DEFINITION_BATCH_UNSUPPORTED}</p> : null}
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
          {!effective ? <button type="button" className="button ghost" onClick={() => void close()} disabled={pending}>
            取消
          </button> : null}
          <button
            type="button"
            className="button primary"
            data-lifecycle-action={intent}
            disabled={effective ? pending : !allowed || pending || Boolean(job && jobIsPending(job.status)) || (!batch && !reason.trim()) || (batch && (runtimeMode === "mock" || targets.length === 0 || targets.length > DEFINITION_BATCH_LIMIT))}
            title={allowed ? undefined : "当前会话缺少发布能力或目录不可写。"}
            onClick={() => void (effective ? close() : captureCandidate())}
          >
            {effective ? "完成" : pending && !candidate ? "正在预演…" : "预演影响"}
          </button>
        </div>
      </ModalDialog>
      <ConfirmDialog
        open={confirmOpen}
        title={contentText.action}
        description={batch ? `将${contentText.verb} ${targets.length} 个定义。${usage}。` : impactSummary(candidate, definition, intent)}
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
    `将发布 1 个修订用于${copy[intent].verb} ${definition.propertyKey}。`,
    `变更定义 ${changed} · 新增定义 ${added}。`,
    `共享目录影响：${formatUsageSummary(definition.usageSummary)}。`,
    "已固定历史引用的项目不会自动改动。"
  ].join("\n");
}

function jobStatusText(job: CatalogPublicationJobResponse["item"], count: number, intent: DefinitionLifecycleIntent): string {
  if (job.effective && job.currentness) {
    return job.currentness === "active"
      ? `已生效：${count} 个定义已${copy[intent].verb}。`
      : "已激活，但已被更晚的目录发布取代。";
  }
  if (job.maintenanceRewrites?.length) {
    return publicationStatusCopy(job).message;
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
  let reason: ReturnType<typeof catalogFailureReason>;
  try {
    reason = catalogFailureReason(error as never);
  } catch {
    reason = "unknown";
  }
  return `${catalogErrorCopy(reason)} 输入已保留。`;
}

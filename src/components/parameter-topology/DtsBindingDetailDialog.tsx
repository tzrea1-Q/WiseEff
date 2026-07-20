import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleX } from "lucide-react";

import type {
  BindingCompareEntry,
  BindingHistoryEntry,
  DtsValue
} from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { BindingEditValidation } from "./BindingDetailPanel";

export type DtsBindingDetailDialogProps = {
  row: DtsParameterWorkbenchRow;
  canEdit: boolean;
  onClose: () => void;
  onCreateDraft: (input: {
    bindingId: string;
    rawValue: string;
    reason: string;
  }) => Promise<BindingEditValidation>;
  focusEditorOnOpen?: boolean;
  historyEntries?: BindingHistoryEntry[];
  compareEntries?: BindingCompareEntry[];
};

type SubmissionState = "idle" | "pending" | "success" | "failure";
type SuccessfulSubmission = {
  rawValue: string;
  reason: string;
  diagnostics: BindingEditValidation["diagnostics"];
};

function IdentityField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd><code>{value ?? "不可用"}</code></dd>
    </div>
  );
}

function formatEffectiveValue(value: DtsValue): string {
  switch (value.kind) {
    case "boolean":
      return "property present";
    case "empty":
      return "empty";
    case "strings":
      return value.values.map((item) => JSON.stringify(item)).join(", ");
    case "bytes":
      return `[${value.values.map((item) => item.toString(16).padStart(2, "0")).join(" ")}]`;
    case "cells":
      return value.groups
        .map((group) => `<${group.map((cell) => cell.kind === "phandle" ? `&${cell.label}` : cell.raw).join(" ")}>`)
        .join(", ");
    case "mixed":
      return value.segments.map((segment) => {
        if (segment.kind === "string") return segment.raw;
        return `/bits/ ${segment.bits} <${segment.cells.map((cell) => cell.kind === "phandle" ? `&${cell.label}` : cell.raw).join(" ")}>`;
      }).join(" ");
  }
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "服务端暂时无法创建草稿，请稍后重试。";
}

export function DtsBindingDetailDialog({
  row,
  canEdit,
  onClose,
  onCreateDraft,
  focusEditorOnOpen = false,
  historyEntries = [],
  compareEntries = []
}: DtsBindingDetailDialogProps) {
  const rawValueRef = useRef<HTMLTextAreaElement | null>(null);
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);
  const activeBindingIdRef = useRef(row.bindingId);
  const [rawValue, setRawValue] = useState(row.rawValue);
  const [reason, setReason] = useState("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [diagnostics, setDiagnostics] = useState<BindingEditValidation["diagnostics"]>([]);
  const [failureMessage, setFailureMessage] = useState("");
  const [successfulSubmission, setSuccessfulSubmission] = useState<SuccessfulSubmission | null>(null);
  const isPending = submissionState === "pending";
  const trimmedReason = reason.trim();
  const isAlreadySubmitted = successfulSubmission !== null
    && successfulSubmission.rawValue === rawValue
    && successfulSubmission.reason === trimmedReason;
  const canSubmit = canEdit && !isPending && Boolean(trimmedReason) && !isAlreadySubmitted;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    activeBindingIdRef.current = row.bindingId;
    requestGenerationRef.current += 1;
    setRawValue(row.rawValue);
    setReason("");
    setSubmissionState("idle");
    setDiagnostics([]);
    setFailureMessage("");
    setSuccessfulSubmission(null);
  }, [row.bindingId]);

  const reconcileValidationForInput = (nextRawValue: string, nextReason: string) => {
    const matchesSuccessfulSubmission = successfulSubmission !== null
      && successfulSubmission.rawValue === nextRawValue
      && successfulSubmission.reason === nextReason.trim();
    if (matchesSuccessfulSubmission) {
      setSubmissionState("success");
      setDiagnostics(successfulSubmission.diagnostics);
      setFailureMessage("");
      return;
    }
    setSubmissionState("idle");
    setDiagnostics([]);
    setFailureMessage("");
  };

  const createDraft = async () => {
    if (!canSubmit) return;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const requestBindingId = row.bindingId;
    const requestInput = {
      bindingId: requestBindingId,
      rawValue,
      reason: trimmedReason
    };
    setSubmissionState("pending");
    setDiagnostics([]);
    setFailureMessage("");
    try {
      const result = await onCreateDraft(requestInput);
      if (
        !mountedRef.current
        || requestGenerationRef.current !== requestGeneration
        || activeBindingIdRef.current !== requestBindingId
      ) return;
      setDiagnostics(result.diagnostics);
      setSubmissionState(result.valid ? "success" : "failure");
      if (result.valid) {
        setSuccessfulSubmission({
          rawValue: requestInput.rawValue,
          reason: requestInput.reason,
          diagnostics: result.diagnostics
        });
      } else {
        setFailureMessage("服务端校验未通过");
      }
    } catch (error) {
      if (
        !mountedRef.current
        || requestGenerationRef.current !== requestGeneration
        || activeBindingIdRef.current !== requestBindingId
      ) return;
      setSubmissionState("failure");
      setFailureMessage(readableError(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent
        aria-label={`${row.propertyKey} 参数详情`}
        className="dts-binding-detail-dialog max-h-[calc(100vh-2rem)] max-w-5xl overflow-y-auto"
        overlayClassName="dts-binding-detail-dialog__overlay"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          if (!focusEditorOnOpen || !canEdit) return;
          event.preventDefault();
          rawValueRef.current?.focus();
        }}
      >
        <DialogHeader className="dts-binding-detail-dialog__header flex-row items-start justify-between">
          <div>
            <DialogTitle>{row.propertyKey} 参数详情</DialogTitle>
            <DialogDescription>
              {row.instanceName ?? "器件实例不可用"} · {row.driverModule ?? row.compatible ?? "驱动不可用"}
            </DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭参数详情" onClick={onClose}>
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </DialogHeader>

        <div className="dts-binding-detail-dialog__content grid gap-4">
          <section aria-labelledby="dts-binding-identity-title">
            <h3 id="dts-binding-identity-title">身份</h3>
            <dl className="grid gap-2 sm:grid-cols-2">
              <IdentityField label="Binding ID" value={row.bindingId} />
              <IdentityField label="Parameter Spec ID" value={row.parameterSpecId} />
              <IdentityField label="Spec Version ID" value={row.parameterSpecVersionId} />
              <IdentityField label="Logical Node ID" value={row.logicalNodeId} />
            </dl>
            <p>当前接口未提供规格详情</p>
          </section>

          <section aria-labelledby="dts-binding-location-title">
            <h3 id="dts-binding-location-title">DTS 位置</h3>
            <dl className="grid gap-2 sm:grid-cols-2">
              <IdentityField label="器件 / 驱动" value={[row.instanceName, row.driverModule].filter(Boolean).join(" · ") || null} />
              <IdentityField label="Compatible" value={row.compatible} />
              <IdentityField label="Unit address" value={row.unitAddress} />
              <IdentityField label="Topology node ID" value={row.topologyNodeId} />
              <IdentityField label="完整路径" value={row.topologyPath} />
              <IdentityField label="源节点路径" value={row.sourceNodePath} />
              <IdentityField label="源出现 ID" value={row.sourceOccurrenceId} />
              <IdentityField
                label="源文件 / 行号"
                value={row.sourceFileName ? `${row.sourceFileName} · ${row.sourceLine ? `L${row.sourceLine}` : "行号不可用"}` : null}
              />
            </dl>
          </section>

          <section aria-labelledby="dts-binding-provenance-title">
            <h3 id="dts-binding-provenance-title">来源链</h3>
            {row.effects.length > 0 ? (
              <ol>
                {row.effects.map((effect) => (
                  <li key={effect.id}>
                    <code>{effect.effectKind} · order {effect.sourceOrder} · {effect.nodeOccurrenceId ?? "source occurrence 不可用"}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p>当前接口未提供来源 effect。</p>
            )}
          </section>

          <section aria-labelledby="dts-binding-history-title">
            <h3 id="dts-binding-history-title">历史与 diff</h3>
            {historyEntries.length > 0 ? (
              <ol aria-label="参数历史">
                {historyEntries.map((entry) => (
                  <li key={entry.id}>
                    <code>
                      {entry.changedAt}
                      {entry.fromRawValue != null || entry.toRawValue != null
                        ? ` · ${entry.fromRawValue ?? "∅"} → ${entry.toRawValue ?? "∅"}`
                        : ""}
                    </code>
                  </li>
                ))}
              </ol>
            ) : (
              <p>暂无历史记录。</p>
            )}
          </section>

          <section aria-labelledby="dts-binding-compare-title">
            <h3 id="dts-binding-compare-title">跨项目对比</h3>
            {compareEntries.length > 0 ? (
              <ul aria-label="跨项目对比">
                {compareEntries.map((entry) => (
                  <li key={entry.projectId}>
                    <strong>{entry.projectName}</strong>
                    <code> {entry.rawValue}</code>
                    {entry.moduleName || entry.driverModule ? (
                      <small>
                        {" "}
                        · {[entry.moduleName, entry.driverModule].filter(Boolean).join(" · ")}
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>暂无其他项目的对比数据。</p>
            )}
          </section>

          <section aria-labelledby="dts-binding-contract-title">
            <h3 id="dts-binding-contract-title">值与约束</h3>
            <dl className="grid gap-2 sm:grid-cols-2">
              <IdentityField label="Raw value" value={row.rawValue} />
              <IdentityField label="Effective value" value={formatEffectiveValue(row.effectiveValue)} />
              <IdentityField label="Value shape" value={row.valueShapeSummary} />
              <IdentityField
                label="Governance"
                value={`schema: ${row.schemaState} · policy: ${row.policyState} · governance: ${row.governanceState} · mapping: ${row.mappingOpen ? "open" : "resolved"}`}
              />
            </dl>
          </section>

          <section aria-labelledby="dts-binding-edit-title">
            <h3 id="dts-binding-edit-title">类型化编辑</h3>
            {canEdit ? (
              <div className="grid gap-3">
                <Label htmlFor="dts-binding-raw-value">目标值 raw</Label>
                <Textarea
                  id="dts-binding-raw-value"
                  ref={rawValueRef}
                  value={rawValue}
                  disabled={isPending}
                  onChange={(event) => {
                    const nextRawValue = event.target.value;
                    setRawValue(nextRawValue);
                    reconcileValidationForInput(nextRawValue, reason);
                  }}
                />
                <Label htmlFor="dts-binding-edit-reason">修改原因</Label>
                <Textarea
                  id="dts-binding-edit-reason"
                  value={reason}
                  disabled={isPending}
                  onChange={(event) => {
                    const nextReason = event.target.value;
                    setReason(nextReason);
                    reconcileValidationForInput(rawValue, nextReason);
                  }}
                />
                <Button type="button" disabled={!canSubmit} onClick={() => void createDraft()}>
                  {isPending ? "创建中…" : "校验并创建草稿"}
                </Button>
                {submissionState === "success" ? (
                  <p role="status">服务端校验通过，草稿已创建</p>
                ) : null}
                {submissionState === "failure" ? (
                  <p role="alert">{failureMessage}</p>
                ) : null}
                {diagnostics.length > 0 ? (
                  <ul aria-label="编辑诊断">
                    {diagnostics.map((diagnostic) => (
                      <li key={`${diagnostic.code ?? "diagnostic"}:${diagnostic.message}`}>
                        {diagnostic.code ? `${diagnostic.code}: ` : null}{diagnostic.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p>当前账号仅可查看此绑定。</p>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

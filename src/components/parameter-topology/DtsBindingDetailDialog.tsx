import { useEffect, useMemo, useRef, useState } from "react";
import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import { formatModulePathLabel } from "@/domain/modules/moduleTree";
import {
  buildBindingProjectComparison,
  dedupeBindingComparePeers,
  type BindingComparePeer
} from "@/domain/parameter-topology/bindingProjectComparison";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type {
  BindingCompareEntry as DomainBindingCompareEntry,
  BindingHistoryEntry as DomainBindingHistoryEntry,
  CanonicalDtsDefinitionDetail,
  ParameterSpecDetail
} from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import { Button } from "@/components/ui/button";

import { DtsBindingCompareDialog } from "./DtsBindingCompareDialog";
import { DtsBindingHistoryDiffDialog } from "./DtsBindingHistoryDiffDialog";

export type BindingHistoryEntry = DomainBindingHistoryEntry & {
  actor?: string | null;
  reason?: string | null;
};

export type BindingCompareEntry = DomainBindingCompareEntry;
export type BindingComparePeerEntry = BindingComparePeer;

export type DtsBindingDetailDialogProps = {
  row: DtsParameterWorkbenchRow;
  canEdit: boolean;
  onClose: () => void;
  onAddToDraft?: (bindingId: string) => void;
  /** Seed local draft from a peer project's raw value (mature compare action). */
  onUseCompareAsDraft?: (input: { rawValue: string; reason: string }) => void;
  historyEntries?: BindingHistoryEntry[];
  compareEntries?: BindingCompareEntry[];
  /** Current project identity for the compare base row. */
  baseProjectId?: string;
  baseProjectName?: string;
  /** Loaded on open from the exact canonical Definition revision. */
  specDetail?: ParameterSpecDetail | CanonicalDtsDefinitionDetail | null;
  specDetailStatus?: "idle" | "loading" | "ready" | "error";
  specDetailErrorMessage?: string | null;
  historyStatus?: "idle" | "loading" | "ready" | "error";
  historyErrorMessage?: string | null;
  compareStatus?: "idle" | "loading" | "ready" | "error";
  compareErrorMessage?: string | null;
  onRetrySpecDetail?: () => void;
  onRetryHistory?: () => void;
  onRetryCompare?: () => void;
};

const RECENT_HISTORY_LIMIT = 3;

function IdentityField({ label, value }: { label: string; value: string | null }) {
  const display = value == null ? "不可用" : formatDtsRawValueForUi(value) || value;
  return (
    <div>
      <dt>{label}</dt>
      <dd><code>{display}</code></dd>
    </div>
  );
}

function TextField({ label, value }: { label: string; value: string }) {
  return (
    <div className="dts-binding-detail-copy">
      <strong>{label}</strong>
      <p>{value}</p>
    </div>
  );
}

function formatUnknownValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatConstraints(constraints: Record<string, unknown> | null | undefined): string | null {
  if (!constraints || Object.keys(constraints).length === 0) return null;
  const parts: string[] = [];
  if (constraints.min != null || constraints.max != null) {
    parts.push(`范围 ${constraints.min ?? "…"} – ${constraints.max ?? "…"}`);
  }
  if (constraints.cells != null) parts.push(`cells=${String(constraints.cells)}`);
  if (constraints.minItems != null || constraints.maxItems != null) {
    parts.push(`项数 ${constraints.minItems ?? "…"} – ${constraints.maxItems ?? "…"}`);
  }
  if (Array.isArray(constraints.enum) && constraints.enum.length > 0) {
    parts.push(`枚举 ${constraints.enum.map(String).join(" / ")}`);
  }
  if (parts.length === 0) {
    try {
      return JSON.stringify(constraints);
    } catch {
      return null;
    }
  }
  return parts.join(" · ");
}

function importanceLabel(importance: DtsParameterWorkbenchRow["importance"]): string {
  if (importance === "high") return "高";
  if (importance === "low") return "低";
  return "中";
}

function displayHistoryRaw(value: string | null | undefined, valueState?: BindingHistoryEntry["valueState"]) {
  if (valueState === "deleted" && (value == null || value.trim() === "")) return "已删除";
  if (value == null || value.trim() === "") return "∅";
  return formatDtsRawValueForUi(value) || "∅";
}

function historyRevisionLabel(
  entry: Pick<BindingHistoryEntry, "definitionRevisionId" | "effectiveRevisionId">
): string | null {
  const definitionRevisionId = entry.definitionRevisionId?.trim() || null;
  const effectiveRevisionId = entry.effectiveRevisionId?.trim() || null;
  if (definitionRevisionId && effectiveRevisionId && definitionRevisionId === effectiveRevisionId) {
    return `修订 ${definitionRevisionId}`;
  }
  return [
    definitionRevisionId ? `值的固定修订 ${definitionRevisionId}` : null,
    effectiveRevisionId ? `事件有效修订 ${effectiveRevisionId}` : null
  ].filter(Boolean).join(" / ") || null;
}

function BindingHistoryEntryItem({
  entry,
  eventLabel
}: {
  entry: BindingHistoryEntry;
  eventLabel: string;
}) {
  const metaParts = [
    formatAuditAbsoluteTime(entry.changedAt),
    entry.actor?.trim() ? entry.actor.trim() : null
  ].filter(Boolean);

  return (
    <li className="parameter-detail-history__item" data-complex="true">
      <span className="parameter-detail-history__version">{eventLabel}</span>
      <span className="parameter-detail-history__value">
        <code tabIndex={0}>{displayHistoryRaw(entry.toRawValue, entry.valueState)}</code>
      </span>
      <small className="parameter-detail-history__meta">
        {[entry.eventType, historyRevisionLabel(entry), ...metaParts]
          .filter(Boolean)
          .join(" / ")}
      </small>
    </li>
  );
}

export function DtsBindingDetailDialog({
  row,
  canEdit,
  onClose,
  onAddToDraft,
  onUseCompareAsDraft,
  historyEntries = [],
  compareEntries = [],
  baseProjectId = "current",
  baseProjectName = "当前项目",
  specDetail = null,
  specDetailStatus = "idle",
  specDetailErrorMessage = null,
  historyStatus = "idle",
  historyErrorMessage = null,
  compareStatus = "idle",
  compareErrorMessage = null,
  onRetrySpecDetail,
  onRetryHistory,
  onRetryCompare
}: DtsBindingDetailDialogProps) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [historyDiffOpen, setHistoryDiffOpen] = useState(false);
  const stackedReturnFocusRef = useRef<HTMLButtonElement | null>(null);

  const peerCount = useMemo(
    () => dedupeBindingComparePeers(compareEntries).length,
    [compareEntries]
  );
  const coverage = useMemo(
    () => {
      try {
        return buildBindingProjectComparison({
          baseProjectId,
          baseProjectName,
          baseRawValue: row.rawValue,
          peers: compareEntries,
          targetBindingId: null
        }).coverage;
      } catch {
        return null;
      }
    },
    [baseProjectId, baseProjectName, row.rawValue, compareEntries]
  );

  const canonicalSpec: CanonicalDtsDefinitionDetail | null =
    specDetail && "revisionId" in specDetail ? specDetail : null;
  const legacySpec: ParameterSpecDetail | null =
    specDetail && !("revisionId" in specDetail) ? specDetail : null;
  const pinnedDisplayName = row.displayName === undefined
    ? specDetail?.displayName
    : row.displayName;
  const displayName = pinnedDisplayName?.trim() && pinnedDisplayName !== row.propertyKey
    ? pinnedDisplayName
    : null;
  const displayDescription = (
    row.description === undefined ? legacySpec?.description : row.description
  )?.trim() || "暂无展示描述";
  const documentation = (
    row.documentation === undefined ? specDetail?.documentation : row.documentation
  )?.trim() || "暂无参数说明";
  const exampleValue = formatUnknownValue(legacySpec?.exampleValue ?? null);
  const units = canonicalSpec?.unit?.trim() || legacySpec?.units?.trim() || null;
  const canonicalConstraints = canonicalSpec?.constraints;
  const constraintsSummary = canonicalSpec
    ? canonicalConstraints &&
      typeof canonicalConstraints === "object" &&
      "kind" in canonicalConstraints && canonicalConstraints.kind === "none"
      ? null
      : formatUnknownValue(canonicalConstraints)
    : formatConstraints(legacySpec?.constraints);
  const schemaDefault = formatUnknownValue(legacySpec?.schemaDefault ?? null);
  const policyTarget = formatUnknownValue(legacySpec?.policyTarget ?? null);
  const hasPeers = peerCount > 0 && coverage !== null;
  const recentHistory = historyEntries.slice(0, RECENT_HISTORY_LIMIT);
  // The stacked child owns focus and dismissal while it is open. Suspending the
  // outer surface avoids a double backdrop without changing the detail state.
  const stackedChildOpen = compareOpen || historyDiffOpen;

  useEffect(() => {
    const trigger = stackedReturnFocusRef.current;
    if (stackedChildOpen || !trigger) {
      return undefined;
    }

    trigger.focus();
    // The child restores its captured focus during passive cleanup. Retry after
    // that cleanup so a browser that blurred the suspended parent returns here.
    const frame = window.requestAnimationFrame(() => {
      trigger.focus();
      if (stackedReturnFocusRef.current === trigger) {
        stackedReturnFocusRef.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stackedChildOpen]);

  return (
    <>
      <ModalDialog
        open
        onDismiss={stackedChildOpen ? undefined : onClose}
        className={`dts-binding-detail-dialog${stackedChildOpen ? " is-suspended" : ""}`}
        backdropClassName={`dts-binding-detail-dialog__overlay${stackedChildOpen ? " is-suspended" : ""}`}
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
          <div className="dts-binding-detail-dialog__header">
            <div>
              <h2 id={titleId}>{row.propertyKey} 参数详情</h2>
              <p id={descriptionId} className="sr-only">
                查看该参数的定义、近期历史与跨项目对比。
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭参数详情" onClick={onClose}>
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>

          <div className="dts-binding-detail-dialog__content">
            <section aria-labelledby="dts-binding-definition-title">
              <h3 id="dts-binding-definition-title">参数定义</h3>
              {specDetailStatus === "loading" ? (
                <p role="status">正在加载规格详情…</p>
              ) : null}
              {specDetailStatus === "error" ? (
                <div role="alert" aria-label="规格详情加载失败">
                  <span>{specDetailErrorMessage ?? "规格详情暂时无法加载，以下仅展示绑定当前值。"}</span>
                  {onRetrySpecDetail ? (
                    <Button type="button" variant="outline" size="sm" onClick={onRetrySpecDetail}>
                      重试规格详情
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {displayName ? <TextField label="显示名" value={displayName} /> : null}
              <TextField label="展示描述" value={displayDescription} />
              <TextField label="参数说明" value={documentation} />
              <dl className="grid gap-2 sm:grid-cols-2">
                <IdentityField label="当前值" value={row.rawValue} />
                {exampleValue ? (
                  <IdentityField label="示例值（示意，非推荐）" value={exampleValue} />
                ) : null}
                {units ? <IdentityField label="单位" value={units} /> : null}
                {constraintsSummary ? <IdentityField label="约束" value={constraintsSummary} /> : null}
                {schemaDefault ? <IdentityField label="规格默认" value={schemaDefault} /> : null}
                {policyTarget ? <IdentityField label="策略目标" value={policyTarget} /> : null}
                <IdentityField
                  label="所属模块"
                  value={formatModulePathLabel(row.modulePath, row.moduleName)}
                />
                <IdentityField label="重要性" value={importanceLabel(row.importance)} />
              </dl>
            </section>

            <section className="parameter-detail-history dts-binding-detail-history" aria-labelledby="dts-binding-history-title">
              <div className="parameter-detail-history__head">
                <h3 id="dts-binding-history-title">近期历史</h3>
                {historyStatus !== "loading" && historyStatus !== "error" && historyEntries.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="parameter-history-open-button"
                    onClick={(event) => {
                      stackedReturnFocusRef.current = event.currentTarget;
                      setHistoryDiffOpen(true);
                    }}
                  >
                    查看历史差异
                  </Button>
                ) : null}
              </div>
              {historyStatus === "loading" ? (
                <p role="status">正在加载历史…</p>
              ) : historyStatus === "error" ? (
                <div role="alert" aria-label="历史加载失败">
                  <span>{historyErrorMessage ?? "历史加载失败，未将失败显示为空记录。"}</span>
                  {onRetryHistory ? (
                    <Button type="button" variant="outline" size="sm" onClick={onRetryHistory}>
                      重试历史
                    </Button>
                  ) : null}
                </div>
              ) : recentHistory.length > 0 ? (
                <ul aria-label="参数历史">
                  {recentHistory.map((entry, index) => (
                    <BindingHistoryEntryItem
                      key={entry.id}
                      entry={entry}
                      eventLabel={historyRevisionLabel(entry)
                        ?? (entry.currentValueId
                          ? `值 ${entry.currentValueId}`
                          : `历史事件 ${index + 1}`)}
                    />
                  ))}
                </ul>
              ) : (
                <p>暂无历史记录。</p>
              )}
            </section>

            <section className="dts-binding-compare-entry" aria-labelledby="dts-binding-compare-title">
              <div className="dts-binding-compare-entry__row">
                <div>
                  <h3 id="dts-binding-compare-title">跨项目对比</h3>
                  {compareStatus === "loading" ? (
                    <p role="status">正在加载对比…</p>
                  ) : compareStatus === "error" ? (
                    <div role="alert" aria-label="对比加载失败">
                      <span>{compareErrorMessage ?? "对比加载失败，未将失败显示为空对端。"}</span>
                      {onRetryCompare ? (
                        <Button type="button" variant="outline" size="sm" onClick={onRetryCompare}>
                          重试对比
                        </Button>
                      ) : null}
                    </div>
                  ) : coverage === null ? (
                    <div role="alert" aria-label="对比数据身份冲突">
                      <span>对比数据缺少唯一配置实例身份，无法安全选择目标。</span>
                      {onRetryCompare ? (
                        <Button type="button" variant="outline" size="sm" onClick={onRetryCompare}>
                          重试对比
                        </Button>
                      ) : null}
                    </div>
                  ) : hasPeers ? (
                    <p>
                      {coverage.configured}/{coverage.total} 个配置实例已配置 · 另有 {peerCount} 个对端可对比
                    </p>
                  ) : (
                    <p>暂无其他项目的对比数据。</p>
                  )}
                </div>
                {compareStatus !== "loading" && compareStatus !== "error" && hasPeers ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      stackedReturnFocusRef.current = event.currentTarget;
                      setCompareOpen(true);
                    }}
                  >
                    打开跨项目对比
                  </Button>
                ) : null}
              </div>
            </section>
          </div>

          <div className="dts-binding-detail-dialog__footer">
            <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
            {canEdit && onAddToDraft ? (
              <Button type="button" onClick={() => onAddToDraft(row.bindingId)}>
                加入草稿
              </Button>
            ) : null}
          </div>
          </>
        )}
      </ModalDialog>

      {compareOpen && hasPeers ? (
        <DtsBindingCompareDialog
          propertyKey={row.propertyKey}
          baseBindingId={row.bindingId}
          baseProjectId={baseProjectId}
          baseProjectName={baseProjectName}
          baseRawValue={row.rawValue}
          peers={compareEntries}
          canEdit={canEdit}
          onClose={() => setCompareOpen(false)}
          onUseCompareAsDraft={onUseCompareAsDraft}
        />
      ) : null}

      {historyDiffOpen && historyEntries.length > 0 ? (
        <DtsBindingHistoryDiffDialog
          propertyKey={row.propertyKey}
          historyEntries={historyEntries}
          onClose={() => setHistoryDiffOpen(false)}
        />
      ) : null}
    </>
  );
}

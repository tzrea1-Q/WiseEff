import { useMemo, useState } from "react";
import { CircleX } from "lucide-react";

import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import { formatModulePathLabel } from "@/domain/modules/moduleTree";
import {
  buildBindingProjectComparison,
  dedupeBindingComparePeers
} from "@/domain/parameter-topology/bindingProjectComparison";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { ParameterSpecDetail } from "@/domain/parameter-topology/types";
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

import { DtsBindingCompareDialog } from "./DtsBindingCompareDialog";
import { DtsBindingHistoryDiffDialog } from "./DtsBindingHistoryDiffDialog";

export type BindingHistoryEntry = {
  id: string;
  changedAt: string;
  actor?: string | null;
  fromRawValue?: string | null;
  toRawValue?: string | null;
  reason?: string | null;
};

export type BindingCompareEntry = {
  projectId: string;
  projectName: string;
  rawValue: string;
  moduleName?: string | null;
  driverModule?: string | null;
};

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
  /** Loaded on open from GET /api/v2/parameter-specs/:id; null while loading or unavailable. */
  specDetail?: ParameterSpecDetail | null;
  specDetailStatus?: "idle" | "loading" | "ready" | "error";
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

function displayHistoryRaw(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "∅";
  return formatDtsRawValueForUi(value) || "∅";
}

function BindingHistoryEntryItem({
  entry,
  versionLabel
}: {
  entry: BindingHistoryEntry;
  versionLabel: string;
}) {
  const metaParts = [
    formatAuditAbsoluteTime(entry.changedAt),
    entry.actor?.trim() ? entry.actor.trim() : null
  ].filter(Boolean);

  return (
    <li className="parameter-detail-history__item" data-complex="true">
      <span className="parameter-detail-history__version">{versionLabel}</span>
      <span className="parameter-detail-history__value">
        <code tabIndex={0}>{displayHistoryRaw(entry.toRawValue)}</code>
      </span>
      <small className="parameter-detail-history__meta">{metaParts.join(" / ")}</small>
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
  specDetailStatus = "idle"
}: DtsBindingDetailDialogProps) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [historyDiffOpen, setHistoryDiffOpen] = useState(false);

  const peerCount = useMemo(
    () => dedupeBindingComparePeers(compareEntries).length,
    [compareEntries]
  );
  const coverage = useMemo(
    () =>
      buildBindingProjectComparison({
        baseProjectId,
        baseProjectName,
        baseRawValue: row.rawValue,
        peers: compareEntries,
        targetProjectId: null
      }).coverage,
    [baseProjectId, baseProjectName, row.rawValue, compareEntries]
  );

  const displayName = specDetail?.displayName?.trim() && specDetail.displayName !== row.propertyKey
    ? specDetail.displayName
    : null;
  const meaning = (specDetail?.documentation ?? specDetail?.description)?.trim() || null;
  const exampleValue = formatUnknownValue(specDetail?.exampleValue ?? null);
  const units = specDetail?.units?.trim() || null;
  const constraintsSummary = formatConstraints(specDetail?.constraints);
  const schemaDefault = formatUnknownValue(specDetail?.schemaDefault ?? null);
  const policyTarget = formatUnknownValue(specDetail?.policyTarget ?? null);
  const hasPeers = peerCount > 0;
  const recentHistory = historyEntries.slice(0, RECENT_HISTORY_LIMIT);

  return (
    <>
      <Dialog open onOpenChange={(open) => {
        if (!open) onClose();
      }}>
        <DialogContent
          aria-label={`${row.propertyKey} 参数详情`}
          className="dts-binding-detail-dialog max-h-[calc(100vh-2rem)] w-full gap-3 sm:max-w-5xl overflow-y-auto"
          overlayClassName="dts-binding-detail-dialog__overlay"
          showCloseButton={false}
        >
          <DialogHeader className="dts-binding-detail-dialog__header flex-row items-center justify-between gap-2">
            <DialogTitle>{row.propertyKey} 参数详情</DialogTitle>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭参数详情" onClick={onClose}>
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </DialogHeader>
          <DialogDescription className="sr-only">
            查看该参数的定义、近期历史与跨项目对比。
          </DialogDescription>

          <div className="dts-binding-detail-dialog__content grid gap-4">
            <section aria-labelledby="dts-binding-definition-title">
              <h3 id="dts-binding-definition-title">参数定义</h3>
              {specDetailStatus === "loading" ? (
                <p role="status">正在加载规格详情…</p>
              ) : null}
              {specDetailStatus === "error" ? (
                <p role="status">规格详情暂时无法加载，以下仅展示绑定当前值。</p>
              ) : null}
              {displayName ? <TextField label="显示名" value={displayName} /> : null}
              {meaning ? <TextField label="参数含义" value={meaning} /> : null}
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
                {historyEntries.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="parameter-history-open-button"
                    onClick={() => setHistoryDiffOpen(true)}
                  >
                    查看历史差异
                  </Button>
                ) : null}
              </div>
              {recentHistory.length > 0 ? (
                <ul aria-label="参数历史">
                  {recentHistory.map((entry, index) => (
                    <BindingHistoryEntryItem
                      key={entry.id}
                      entry={entry}
                      versionLabel={`R${historyEntries.length - index}`}
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
                  {hasPeers ? (
                    <p>
                      {coverage.configured}/{coverage.total} 个项目已配置 · 另有 {peerCount} 个对端可对比
                    </p>
                  ) : (
                    <p>暂无其他项目的对比数据。</p>
                  )}
                </div>
                {hasPeers ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
                    打开跨项目对比
                  </Button>
                ) : null}
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
            {canEdit && onAddToDraft ? (
              <Button type="button" onClick={() => onAddToDraft(row.bindingId)}>
                加入草稿
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {compareOpen && hasPeers ? (
        <DtsBindingCompareDialog
          propertyKey={row.propertyKey}
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

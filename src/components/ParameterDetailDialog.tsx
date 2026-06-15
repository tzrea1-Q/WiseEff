import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  buildSingleParameterProjectComparison,
  type ComparisonProject,
  type SingleParameterComparisonRow
} from "@/domain/parameters/singleParameterComparison";
import type { ParameterRecord } from "@/domain/parameters/types";
import type { ParameterHistoryEntry } from "@/domain/parameters/types";
import { riskLabels } from "../workbenchUi";

export type ParameterDetailDialogProps = {
  parameter: ParameterRecord;
  parameters: ParameterRecord[];
  projects: ComparisonProject[];
  currentProjectId: string;
  targetProjectId: string;
  canEdit: boolean;
  disabledReason?: string;
  alreadyInDraft: boolean;
  onTargetProjectChange: (projectId: string) => void;
  onAddToDraft: (draft?: { targetValue: string; reason: string }) => void;
  onClose: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="parameter-detail-field">
      <dt>{label}</dt>
      <dd>{value || "-"}</dd>
    </div>
  );
}

function formatValue(value: string, unit: string) {
  return `${value} ${unit}`.trim();
}

function formatHistoryValue(value: string, unit: string) {
  return `${value || "-"} ${unit}`.trim();
}

function isComplexParameterValue(value: string) {
  return value.includes("\n") || value.length > 80;
}

function CodeValue({
  actionLabel,
  disabled,
  label,
  onAction,
  value
}: {
  actionLabel?: string;
  disabled?: boolean;
  label: string;
  onAction?: () => void;
  value: string;
}) {
  return (
    <div className="parameter-detail-code-value">
      <div className="parameter-detail-code-value__head">
        <strong>{label}</strong>
        {actionLabel && onAction ? (
          <button className="parameter-source-draft-button" type="button" disabled={disabled} onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      <code tabIndex={0}>{value || "-"}</code>
    </div>
  );
}

function HistoryEntryItem({ entry }: { entry: ParameterHistoryEntry }) {
  const isComplex = isComplexParameterValue(entry.value);

  return (
    <li className="parameter-detail-history__item" data-complex={isComplex || undefined}>
      <span className="parameter-detail-history__version">{entry.version}</span>
      <span className="parameter-detail-history__value">
        {isComplex ? <code tabIndex={0}>{entry.value || "-"}</code> : <span>{entry.value || "-"}</span>}
      </span>
      <small className="parameter-detail-history__meta">
        {entry.changedAt} / {entry.changedBy}
      </small>
    </li>
  );
}

const moduleLabels: Record<string, string> = {
  "Charging Policy": "充电策略",
  "Battery Safety": "电池安全",
  "Battery Estimation": "电量估算",
  "Battery Health": "电池健康",
  "Charging Protocol": "充电协议",
  "Wireless Charging": "无线充电",
  "Battery Protection": "电池保护"
};

function formatModuleLabel(module: string) {
  return moduleLabels[module] ?? module;
}

function formatRiskLabel(risk: SingleParameterComparisonRow["risk"]) {
  return risk === "Missing" ? "未配置" : riskLabels[risk];
}

function formatRowValue(row: SingleParameterComparisonRow | null, field: "currentValue" | "recommendedValue") {
  return row?.[field] ?? "未配置";
}

type DiffLineKind = "equal" | "remove" | "add";

type DiffLine = {
  kind: DiffLineKind;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  value: string;
};

function splitDiffLines(value: string) {
  const lines = value.split("\n");
  return lines.length === 0 ? [""] : lines;
}

function buildDiffLines(baseValue: string, targetValue: string): DiffLine[] {
  const baseLines = splitDiffLines(baseValue);
  const targetLines = splitDiffLines(targetValue);
  const lineCount = Math.max(baseLines.length, targetLines.length);
  const diffLines: DiffLine[] = [];

  for (let index = 0; index < lineCount; index += 1) {
    const baseLine = baseLines[index];
    const targetLine = targetLines[index];
    const baseLineNumber = baseLine === undefined ? null : index + 1;
    const targetLineNumber = targetLine === undefined ? null : index + 1;

    if (baseLine === targetLine) {
      diffLines.push({
        kind: "equal",
        leftLineNumber: baseLineNumber,
        rightLineNumber: targetLineNumber,
        value: baseLine ?? ""
      });
      continue;
    }

    if (baseLine !== undefined) {
      diffLines.push({
        kind: "remove",
        leftLineNumber: baseLineNumber,
        rightLineNumber: null,
        value: baseLine
      });
    }

    if (targetLine !== undefined) {
      diffLines.push({
        kind: "add",
        leftLineNumber: null,
        rightLineNumber: targetLineNumber,
        value: targetLine
      });
    }
  }

  return diffLines;
}

function DiffCodeBlock({ baseValue, targetValue }: { baseValue: string; targetValue: string }) {
  const diffLines = buildDiffLines(baseValue, targetValue);

  return (
    <div className="parameter-diff-code" role="list">
      {diffLines.map((line, index) => (
        <div
          className="parameter-diff-code-row"
          data-kind={line.kind}
          key={`${line.kind}-${line.leftLineNumber ?? "-"}-${line.rightLineNumber ?? "-"}-${index}`}
          role="listitem"
        >
          <span className="parameter-diff-code-row__marker" aria-hidden="true">
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="parameter-diff-code-row__line-number">{line.leftLineNumber ?? ""}</span>
          <span className="parameter-diff-code-row__line-number">{line.rightLineNumber ?? ""}</span>
          <code>{line.value || " "}</code>
        </div>
      ))}
    </div>
  );
}

function DiffSection({
  baseValue,
  targetValue,
  title
}: {
  baseValue: string;
  targetValue: string;
  title: string;
}) {
  const changed = baseValue !== targetValue;

  return (
    <section className="parameter-diff-section" aria-label={title}>
      <div className="parameter-diff-section__head">
        <h4>{title}</h4>
        <span data-changed={changed}>{changed ? "存在差异" : "值相同"}</span>
      </div>
      <DiffCodeBlock baseValue={baseValue} targetValue={targetValue} />
    </section>
  );
}

function buildHistoryDiffPairs(history: ParameterHistoryEntry[]) {
  return history.slice(1).map((entry, index) => ({
    previous: history[index],
    current: entry
  }));
}

function ParameterHistoryDiffDialog({
  history,
  onClose,
  parameterName,
  unit
}: {
  history: ParameterHistoryEntry[];
  onClose: () => void;
  parameterName: string;
  unit: string;
}) {
  const diffPairs = buildHistoryDiffPairs(history);

  return (
    <div className="modal-backdrop parameter-history-backdrop" role="dialog" aria-modal="true" aria-label={`历史差异 ${parameterName}`}>
      <div className="parameter-history-diff-dialog">
        <header className="parameter-history-diff-dialog__head">
          <div>
            <span className="eyebrow">近期历史</span>
            <h3>{parameterName}</h3>
            <p>按版本顺序查看历史提交带来的参数值变化。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭历史差异" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="parameter-history-diff-list">
          {diffPairs.map(({ previous, current }) => (
            <article className="parameter-history-diff-card" key={`${previous.version}-${current.version}-${current.changedAt}`}>
              <div className="parameter-history-diff-card__head">
                <div>
                  <strong>{previous.version} → {current.version}</strong>
                  <span>
                    {current.changedAt} / {current.changedBy}
                  </span>
                </div>
                {current.requestId ? <em>{current.requestId}</em> : null}
              </div>
              <DiffCodeBlock
                baseValue={formatHistoryValue(previous.value, unit)}
                targetValue={formatHistoryValue(current.value, unit)}
              />
            </article>
          ))}
        </div>
        <footer className="parameter-history-diff-dialog__footer">
          <button className="button subtle" type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

function ProjectDiffSummary({
  baseRow,
  targetRow
}: {
  baseRow: SingleParameterComparisonRow | null;
  targetRow: SingleParameterComparisonRow | null;
}) {
  return (
    <div className="parameter-diff-summary" aria-label="基准与目标项目">
      <div className="parameter-diff-summary__card" data-side="base">
        <span>基准项目</span>
        <strong>{baseRow?.projectCode ?? "未选择"}</strong>
        <small>{baseRow?.projectName ?? "当前项目未配置该参数"}</small>
        <dl>
          <div>
            <dt>风险</dt>
            <dd>{formatRiskLabel(baseRow?.risk ?? "Missing")}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{baseRow?.updatedAt ?? "-"}</dd>
          </div>
        </dl>
      </div>
      <div className="parameter-diff-summary__connector" aria-hidden="true">
        →
      </div>
      <div className="parameter-diff-summary__card" data-side="target">
        <span>目标项目</span>
        <strong>{targetRow?.projectCode ?? "未选择"}</strong>
        <small>{targetRow?.projectName ?? "目标项目未配置该参数"}</small>
        <dl>
          <div>
            <dt>风险</dt>
            <dd>{formatRiskLabel(targetRow?.risk ?? "Missing")}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{targetRow?.updatedAt ?? "-"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function ProjectDiffComparison({
  baseRow,
  targetRow
}: {
  baseRow: SingleParameterComparisonRow | null;
  targetRow: SingleParameterComparisonRow | null;
}) {
  return (
    <article className="parameter-diff-comparison" aria-label={`${targetRow?.projectCode ?? "目标项目"} 当前值对比`}>
      <ProjectDiffSummary baseRow={baseRow} targetRow={targetRow} />
      <DiffSection title="当前值对比" baseValue={formatRowValue(baseRow, "currentValue")} targetValue={formatRowValue(targetRow, "currentValue")} />
    </article>
  );
}

function rowTone(row: SingleParameterComparisonRow) {
  if (row.status === "missing") return "missing";
  if (row.isBase) return "base";
  if (row.isTarget) return "target";
  return "configured";
}

function ProjectOverview({ rows }: { rows: SingleParameterComparisonRow[] }) {
  return (
    <div className="parameter-detail-project-overview" aria-label="项目配置概览">
      <div className="parameter-detail-project-overview__head">
        <h4>项目概览</h4>
        <span>辅助查看其他项目状态</span>
      </div>
      <div className="parameter-detail-project-overview__list">
        {rows.map((row) => (
          <div className="parameter-detail-project-overview__item" data-tone={rowTone(row)} key={row.projectId}>
            <div>
              <strong>{row.projectCode}</strong>
              <small>{row.projectName}</small>
            </div>
            <div className="parameter-detail-project-overview__meta">
              {row.isBase ? <em>基准</em> : null}
              {row.isTarget ? <em>目标</em> : null}
              <span>{formatRiskLabel(row.risk)}</span>
              <small>{row.updatedAt}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
      ].join(",")
    )
  ).filter((element) => !element.hasAttribute("disabled") && !element.hasAttribute("hidden") && element.tabIndex >= 0);
}

export function ParameterDetailDialog({
  parameter,
  parameters,
  projects,
  currentProjectId,
  targetProjectId,
  canEdit,
  disabledReason,
  alreadyInDraft,
  onTargetProjectChange,
  onAddToDraft,
  onClose
}: ParameterDetailDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [historyDiffOpen, setHistoryDiffOpen] = useState(false);
  const comparison = buildSingleParameterProjectComparison({
    parameters,
    projects,
    parameterName: parameter.name,
    baseProjectId: currentProjectId,
    targetProjectId
  });
  const currentProject = projects.find((project) => project.id === parameter.projectId) ?? null;
  const baseProjectCode = comparison.baseRow?.projectCode ?? currentProjectId;
  const draftDisabled = !canEdit || alreadyInDraft;
  const draftLabel = alreadyInDraft ? "已在草稿中" : "加入修改草稿";
  const hasComplexValue = isComplexParameterValue(parameter.currentValue) || isComplexParameterValue(parameter.recommendedValue);
  const rowsByProjectId = new Map(comparison.rows.map((row) => [row.projectId, row]));
  const targetRow = rowsByProjectId.get(targetProjectId) ?? null;
  const targetParameter = parameters.find((item) => item.projectId === targetProjectId && item.name === parameter.name) ?? null;
  const selectedTargetLabel = targetRow?.projectCode ?? "未选择目标项目";
  const diffDeltaLabel = comparison.delta.label;
  const diffDeltaKind = comparison.delta.kind;

  function handleTargetProjectChange(projectId: string) {
    onTargetProjectChange(projectId);
  }

  function addRecommendedToDraft() {
    onAddToDraft({
      targetValue: parameter.recommendedValue,
      reason: "使用推荐配置生成草稿"
    });
  }

  function addTargetProjectToDraft() {
    if (!targetRow || targetRow.status === "missing" || !targetParameter) {
      return;
    }
    onAddToDraft({
      targetValue: targetParameter.currentValue,
      reason: `参考 ${targetRow.projectCode} 项目当前配置生成草稿`
    });
  }

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;
      const current = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = event.shiftKey
        ? (current - 1 + focusableElements.length) % focusableElements.length
        : (current + 1) % focusableElements.length;

      event.preventDefault();
      focusableElements[nextIndex]?.focus();
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => dialog.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="parameter-detail-title">
      <div ref={dialogRef} className={hasComplexValue ? "parameter-detail-dialog parameter-detail-dialog--wide" : "parameter-detail-dialog"}>
        <header className="parameter-detail-dialog__header">
          <div>
            <span className="eyebrow">
              模块：{formatModuleLabel(parameter.module)} · 重要性：{formatRiskLabel(parameter.risk)}
            </span>
            <h2 id="parameter-detail-title">{parameter.name}</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" aria-label="关闭参数详情" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="parameter-detail-dialog__body">
          <section className="parameter-detail-panel" aria-label="参数定义">
            <div className="parameter-detail-panel__head">
              <h3>参数定义</h3>
              <span>{currentProject ? `${currentProject.code} · ${currentProject.name}` : parameter.projectId}</span>
            </div>
            {hasComplexValue ? (
              <>
                <dl className="parameter-detail-grid parameter-detail-grid--compact">
                  <Field label="范围" value={formatValue(parameter.range, parameter.unit)} />
                  <Field label="更新时间" value={parameter.updatedAt} />
                </dl>
                <div className="parameter-detail-code-grid">
                  <CodeValue label="当前配置" value={parameter.currentValue} />
                  <CodeValue
                    actionLabel="使用推荐配置加入草稿"
                    disabled={!canEdit}
                    label="推荐配置"
                    value={parameter.recommendedValue}
                    onAction={addRecommendedToDraft}
                  />
                </div>
              </>
            ) : (
              <dl className="parameter-detail-grid">
                <Field label="当前值" value={formatValue(parameter.currentValue, parameter.unit)} />
                <div className="parameter-detail-field parameter-detail-field--with-action">
                  <dt>推荐值</dt>
                  <dd>
                    <span>{formatValue(parameter.recommendedValue, parameter.unit)}</span>
                    <button className="parameter-source-draft-button" type="button" disabled={!canEdit} onClick={addRecommendedToDraft}>
                      使用推荐配置加入草稿
                    </button>
                  </dd>
                </div>
                <Field label="范围" value={formatValue(parameter.range, parameter.unit)} />
                <Field label="更新时间" value={parameter.updatedAt} />
              </dl>
            )}
            <div className="parameter-detail-copy">
              <strong>描述</strong>
              <p>{parameter.description}</p>
            </div>
            <div className="parameter-detail-copy">
              <strong>说明</strong>
              <p>{parameter.explanation}</p>
            </div>
            <div className="parameter-detail-copy">
              <strong>配置格式</strong>
              <code tabIndex={0}>{parameter.configFormat || "-"}</code>
            </div>
            {parameter.history.length > 0 ? (
              <div className="parameter-detail-history">
                <div className="parameter-detail-history__head">
                  <strong>近期历史</strong>
                  {parameter.history.length > 1 ? (
                    <button className="parameter-history-open-button" type="button" onClick={() => setHistoryDiffOpen(true)}>
                      查看历史差异
                    </button>
                  ) : null}
                </div>
                <ul>
                  {parameter.history.slice(0, 3).map((entry) => (
                    <HistoryEntryItem entry={entry} key={`${entry.version}-${entry.changedAt}`} />
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="parameter-detail-panel" aria-label="跨项目对比">
            <div className="parameter-detail-panel__head">
              <div>
                <h3>跨项目对比</h3>
                <span>
                  {comparison.coverage.configured}/{comparison.coverage.total} 个项目已配置
                </span>
                <span>对比 {baseProjectCode} 与 {selectedTargetLabel}</span>
              </div>
              <label className="parameter-detail-target">
                <span>目标项目</span>
                <select
                  aria-label="对比目标项目"
                  value={targetProjectId}
                  onChange={(event) => handleTargetProjectChange(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id} disabled={project.id === currentProjectId}>
                      {project.code} {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="parameter-source-action-row">
              <span>{targetRow && targetRow.status !== "missing" ? `可将 ${targetRow.projectCode} 的当前配置作为草稿目标值` : "目标项目尚未配置该参数"}</span>
              <button
                className="parameter-source-draft-button"
                type="button"
                disabled={!canEdit || !targetRow || targetRow.status === "missing" || !targetParameter}
                onClick={addTargetProjectToDraft}
              >
                使用该项目配置加入草稿
              </button>
            </div>

            <div className="parameter-detail-delta" data-kind={diffDeltaKind}>
              <span>重点差异</span>
              <strong>{diffDeltaLabel}</strong>
            </div>

            <div className="parameter-diff-view">
              <div className="parameter-diff-view__head">
                <h4>差异视图</h4>
                <span>以提交 diff 的方式阅读基准项目与目标项目的参数差异</span>
              </div>
              {targetRow ? (
                <ProjectDiffComparison baseRow={comparison.baseRow} targetRow={targetRow} />
              ) : (
                <div className="parameter-diff-empty" role="status">
                  请选择至少一个目标项目进行对比
                </div>
              )}
            </div>

            <ProjectOverview rows={comparison.rows} />
          </section>
        </div>

        <footer className="parameter-detail-dialog__footer">
          <span className="parameter-detail-footer-status">
            {disabledReason ? <span className="parameter-detail-disabled-reason">{disabledReason}</span> : null}
          </span>
          <div className="parameter-detail-dialog__actions">
            <button className="button subtle" type="button" onClick={onClose}>
              关闭
            </button>
            <button className="button primary" type="button" disabled={draftDisabled} onClick={() => onAddToDraft()}>
              {draftLabel}
            </button>
          </div>
        </footer>
        {historyDiffOpen ? (
          <ParameterHistoryDiffDialog
            history={parameter.history}
            parameterName={parameter.name}
            unit={parameter.unit}
            onClose={() => setHistoryDiffOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

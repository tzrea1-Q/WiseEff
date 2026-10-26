import { useEffect, useId, useRef, useState } from "react";
import { CircleX, FlaskConical } from "lucide-react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatModulePathLabel } from "@/domain/modules/moduleTree";
import { formatDtsRawValueForUi, formatDtsValueForUi, isDtsEmptyValueAllowed } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";
import type { BindingCompareEntry, BindingHistoryEntry, CanonicalDtsDefinitionDetail, ParameterSpecDetail } from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import { presentError } from "@/infrastructure/http/presentError";
import { complexEditorRows } from "@/parameterValueKind";
import type { BindingEditValidation } from "./BindingDetailPanel";
import { DtsBindingCompareDialog } from "./DtsBindingCompareDialog";
import { DtsBindingHistoryDiffDialog } from "./DtsBindingHistoryDiffDialog";
import "./parameter-inspector.css";

export type { BindingCompareEntry, BindingHistoryEntry } from "@/domain/parameter-topology/types";
export type BindingComparePeerEntry = BindingCompareEntry;
export type DtsParameterEdit = { rawValue: string; reason: string; action?: "set" | "delete" };
export type DtsBindingDetailDialogProps = {
  row: DtsParameterWorkbenchRow;
  canEdit: boolean;
  onClose: () => void;
  draft?: DtsParameterEdit;
  hasLocalChanges?: boolean;
  hasSavedDraft?: boolean;
  onDraftChange?: (draft: DtsParameterEdit) => void;
  onResetDraft?: () => void;
  onSaveDraft?: (input: DtsParameterEdit & { bindingId: string }) => Promise<BindingEditValidation>;
  onStartDtsReload?: () => void;
  onOpenSource?: () => void;
  onUseCompareAsDraft?: (input: { rawValue: string; reason: string }) => void;
  historyEntries?: BindingHistoryEntry[];
  compareEntries?: BindingCompareEntry[];
  baseProjectId?: string;
  baseProjectName?: string;
  specDetail?: ParameterSpecDetail | CanonicalDtsDefinitionDetail | null;
  latestDefinition?: CanonicalDtsDefinitionDetail | null;
  latestStatus?: "idle" | "loading" | "ready" | "error";
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


function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return value ? <div><dt>{label}</dt><dd>{value}</dd></div> : null;
}

export function DtsBindingDetailDialog({
  row, canEdit, onClose, draft, hasLocalChanges = false, hasSavedDraft = false,
  onDraftChange, onResetDraft, onSaveDraft, onStartDtsReload, onOpenSource,
  onUseCompareAsDraft, historyEntries = [], compareEntries = [], baseProjectId = "current",
  baseProjectName = "当前项目", specDetail = null, latestDefinition = null, latestStatus = "idle", specDetailStatus = "idle", specDetailErrorMessage,
  historyStatus = "idle", historyErrorMessage, compareStatus = "idle", compareErrorMessage,
  onRetrySpecDetail, onRetryHistory, onRetryCompare
}: DtsBindingDetailDialogProps) {
  const [tab, setTab] = useState("configuration");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [compareReplacement, setCompareReplacement] = useState<{ rawValue: string; reason: string } | null>(null);
  const mounted = useRef(true);
  const id = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const value = draft ?? { rawValue: formatDtsRawValueForUi(row.rawValue), reason: "", action: "set" as const };
  const isDelete = value.action === "delete";
  const emptyProperty = isDtsEmptyValueAllowed(row.effectiveValue);
  let syntaxError: string | null = null;
  if (!isDelete) {
    if (!value.rawValue.trim() && !emptyProperty) syntaxError = "请填写目标值。";
    else {
      try { parseDtsValue(row.propertyKey, value.rawValue); }
      catch { syntaxError = "目标值不符合 DTS 格式，请检查引号、括号和数值。"; }
    }
  }
  const writable = Boolean(onDraftChange && onSaveDraft);
  const locked = pending || !canEdit;
  const canonical = specDetail && "revisionId" in specDetail ? specDetail : null;
  const legacy = specDetail && !("revisionId" in specDetail) ? specDetail : null;
  const currentDefinition = latestStatus === "ready" && latestDefinition?.definitionId === (row.definitionId ?? row.parameterSpecId)
    && latestDefinition?.propertyKey === row.propertyKey ? latestDefinition : null;
  const pinnedRevisionId = row.effectiveRevisionId ?? row.parameterSpecVersionId;
  const differsFromPinned = Boolean(currentDefinition && currentDefinition.revisionId !== pinnedRevisionId);
  const name = currentDefinition?.displayName?.trim() || row.currentDisplayName?.trim() || row.displayName?.trim() || specDetail?.displayName?.trim() || row.propertyKey;
  const documentation = currentDefinition ? currentDefinition.documentation?.trim() : row.documentation?.trim() || specDetail?.documentation?.trim();
  const description = row.description?.trim() || legacy?.description?.trim();
  const unit = canonical?.unit || legacy?.units;
  const constraints = formatParameterConstraints(specDetail?.constraints);
  const currentDisplay = formatDtsValueForUi(row.rawValue, row.effectiveValue);
  const targetDisplay = formatDtsValueForUi(value.rawValue, row.effectiveValue, isDelete ? "deleted" : "present");
  const scalar = row.effectiveValue.kind === "cells" && row.effectiveValue.groups.length === 1
    && row.effectiveValue.groups[0].length === 1 && row.effectiveValue.groups[0][0].kind === "integer";
  let scalarText = value.rawValue;
  if (scalar) scalarText = value.rawValue.match(/<\s*([^<>]*)\s*>/)?.[1]?.trim() ?? value.rawValue;
  const update = (patch: Partial<DtsParameterEdit>) => { setFeedback(null); onDraftChange?.({ ...value, ...patch }); };
  const save = async () => {
    if (locked || !onSaveDraft || syntaxError || !value.reason.trim() || !hasLocalChanges) return;
    setPending(true);
    try {
      const result = await onSaveDraft({ bindingId: row.bindingId, ...value, reason: value.reason.trim() });
      if (mounted.current) setFeedback({ error: !result.valid, message: result.valid ? "草稿已保存，待提交审核。" : result.diagnostics.map(d => d.message).join("；") || "校验未通过，请检查后重试。" });
    } catch (error) {
      if (mounted.current) setFeedback({ error: true, message: presentError(error, "保存失败，已保留输入，请重试。") });
    } finally { if (mounted.current) setPending(false); }
  };
  const useComparison = (input: { rawValue: string; reason: string }) => {
    if (locked) return;
    if (hasLocalChanges) { setCompareReplacement(input); return; }
    onUseCompareAsDraft?.(input); setFeedback(null); setTab("configuration");
  };
  const tabs = [["configuration", "配置"], ["history", "变更历史"], ["compare", "跨项目对比"], ["source", "配置来源"]];
  return <>
    <ModalDialog open onDismiss={pending ? undefined : onClose} className="dts-binding-detail-dialog parameter-inspector" backdropClassName="dts-binding-detail-dialog__overlay" describedBy>
      {({ titleId, descriptionId }) => <>
        <header className="parameter-inspector__header">
          <div><h2 id={titleId}>{name} · 参数详情</h2><p id={descriptionId}><code>{row.propertyKey}</code><span>{baseProjectName} · {row.instanceName || row.driverModule || "项目配置"}</span></p></div>
          <Button variant="ghost" size="icon-sm" aria-label="关闭参数详情" disabled={pending} onClick={onClose}><CircleX size={20} aria-hidden="true" /></Button>
        </header>
        <div className="parameter-inspector__context"><span>{formatModulePathLabel(row.modulePath, row.moduleName)}</span><span role="status">{hasLocalChanges ? "有未保存修改" : hasSavedDraft || feedback && !feedback.error ? "已保存草稿 · 待提交" : "当前生效配置"}</span></div>
        {row.nodeEnablementNotice ? <p className="parameter-inspector__notice">{row.nodeEnablementNotice}</p> : null}
        <ViewSwitch variant="tabs" ariaLabel="参数详情内容" value={tab} onValueChange={setTab} items={tabs.map(([key, label]) => ({ value: key, label, id: `${id}-${key}-tab`, panelId: `${id}-${key}-panel` }))} />
        <div className="parameter-inspector__content dts-binding-detail-dialog__content">
          <TabPanel id={`${id}-configuration-panel`} aria-labelledby={`${id}-configuration-tab`} hidden={tab !== "configuration"}>
            <div className="parameter-inspector__configuration">
              <section className="parameter-inspector__definition"><h3>参数定义</h3>
                {currentDefinition && differsFromPinned ? <p role="status">当前目录定义 v{currentDefinition.revisionNumber} · 项目合同仍固定于 {pinnedRevisionId}。下方说明来自最新目录；单位、约束与实际值仍遵循项目固定修订。</p> : null}
                {latestStatus === "loading" ? <p role="status">正在读取最新目录说明…</p> : null}
                {latestStatus === "error" ? <p role="status">最新目录说明暂不可用，当前展示项目固定修订。</p> : null}
                {description ? <p>{description}</p> : null}{documentation ? <p>{documentation}</p> : null}
                {currentDefinition?.examples?.length ? <div><strong>最新目录示例（仅供参考）</strong><pre>{JSON.stringify(currentDefinition.examples, null, 2)}</pre></div> : null}
                {specDetailStatus === "loading" ? <p role="status">正在加载规格详情…</p> : null}
                {specDetailStatus === "error" ? <div role="alert" aria-label="规格详情加载失败"><p>{specDetailErrorMessage || "参数说明加载失败，当前配置仍可查看。"}</p><Button variant="outline" onClick={onRetrySpecDetail}>重试规格详情</Button></div> : null}
                <dl>{currentDisplay ? <div><dt>当前值</dt><dd><pre className="parameter-value-content" role="region" aria-label="当前生效值" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Full parameter values must support keyboard scrolling. */}>{currentDisplay}</pre></dd></div> : null}<Field label="单位" value={unit} /><Field label="约束" value={constraints} /><Field label="所属模块" value={formatModulePathLabel(row.modulePath, row.moduleName)} /><Field label="重要性" value={{ high: "高", medium: "中", low: "低" }[row.importance]} />
                  {legacy?.exampleValue != null ? <Field label="示例值（示意，非推荐）" value={typeof legacy.exampleValue === "string" ? legacy.exampleValue : JSON.stringify(legacy.exampleValue)} /> : null}
                  {legacy?.schemaDefault != null ? <Field label="规格默认" value={JSON.stringify(legacy.schemaDefault)} /> : null}
                  {legacy?.policyTarget != null ? <Field label="策略目标" value={JSON.stringify(legacy.policyTarget)} /> : null}
                </dl>
                {!writable ? <p className="parameter-inspector__hint">当前权限仅可查看，不能修改本项目配置。</p> : <p className="parameter-inspector__hint">修改仅作用于当前项目；保存草稿后仍需提交审核。</p>}
              </section>
              {writable ? <section className="parameter-inspector__editor" aria-label="项目配置修改"><h3>项目配置</h3>
                {!canEdit ? <p role="status">当前状态暂不可编辑，已有输入已保留。</p> : null}
                {emptyProperty ? <fieldset disabled={locked}><legend>目标属性状态</legend><div className="parameter-inspector__value-actions"><Button variant="outline" aria-pressed={!isDelete} onClick={() => update({ action: "set", rawValue: "" })}>{row.effectiveValue.kind === "boolean" ? "属性存在（启用）" : "保留空属性"}</Button><Button variant="outline" aria-pressed={isDelete} onClick={() => update({ action: "delete", rawValue: "" })}>移除属性</Button></div><p className="parameter-inspector__hint">属性存在时无需填写字面值，移除仍须审核。</p></fieldset> : <>
                  <label htmlFor={`${id}-target`}>目标值{unit ? <span> · {unit}</span> : null}</label>
                  {isDelete ? <p role="status">已选择移除属性，提交审核通过后生效。</p> : scalar ? <Input id={`${id}-target`} aria-label="目标值" value={scalarText} disabled={locked} aria-invalid={Boolean(syntaxError)} aria-describedby={syntaxError ? `${id}-syntax` : undefined} onChange={event => update({ rawValue: event.target.value.trim() ? `${row.effectiveValue.kind === "cells" && row.effectiveValue.bits !== 32 ? `/bits/ ${row.effectiveValue.bits} ` : ""}<${event.target.value}>` : "", action: "set" })} /> : <Textarea id={`${id}-target`} aria-label="目标值" value={value.rawValue} disabled={locked} rows={complexEditorRows(value.rawValue)} spellCheck={false} aria-invalid={Boolean(syntaxError)} aria-describedby={syntaxError ? `${id}-syntax` : undefined} onChange={event => update({ rawValue: event.target.value, action: "set" })} />}
                  <details className="parameter-inspector__technical"><summary>更多修改操作</summary><Button variant="outline" disabled={locked} onClick={() => update({ action: isDelete ? "set" : "delete", rawValue: isDelete ? row.rawValue : "" })}>{isDelete ? "保留属性" : "移除属性"}</Button></details>
                </>}
                {syntaxError ? <p id={`${id}-syntax`} className="parameter-inspector__error">{syntaxError}</p> : null}
                <label htmlFor={`${id}-reason`}>修改原因</label><Textarea id={`${id}-reason`} value={value.reason} disabled={locked} placeholder="说明修改目的及依据" rows={3} onChange={event => update({ reason: event.target.value })} />
                <div className="parameter-inspector__preview"><h4>变更预览</h4><ParameterValueDiff baseValue={currentDisplay} targetValue={targetDisplay} /></div>
              </section> : null}
            </div>
          </TabPanel>
          <TabPanel id={`${id}-history-panel`} aria-labelledby={`${id}-history-tab`} hidden={tab !== "history"}>
            {historyStatus === "loading" ? <p role="status">正在加载历史…</p> : historyStatus === "error" ? <div role="alert" aria-label="历史加载失败"><p>{historyErrorMessage || "历史加载失败。"}</p><Button variant="outline" onClick={onRetryHistory}>重试历史</Button></div> : historyEntries.length ? <DtsBindingHistoryDiffDialog embedded propertyKey={row.propertyKey} effectiveValue={row.effectiveValue} historyEntries={historyEntries} onClose={onClose} /> : <p>暂无历史记录。</p>}
          </TabPanel>
          <TabPanel id={`${id}-compare-panel`} aria-labelledby={`${id}-compare-tab`} hidden={tab !== "compare"}>
            {compareStatus === "loading" ? <p role="status">正在加载对比…</p> : compareStatus === "error" ? <div role="alert" aria-label="对比加载失败"><p>{compareErrorMessage || "对比加载失败。"}</p><Button variant="outline" onClick={onRetryCompare}>重试对比</Button></div> : compareEntries.length ? <DtsBindingCompareDialog embedded propertyKey={row.propertyKey} baseBindingId={row.bindingId} baseProjectId={baseProjectId} baseProjectName={baseProjectName} baseRawValue={row.rawValue} baseEffectiveValue={row.effectiveValue} peers={compareEntries} canEdit={canEdit && !pending} onClose={onClose} onUseCompareAsDraft={onUseCompareAsDraft ? useComparison : undefined} /> : <p>暂无其他项目的对比数据。</p>}
          </TabPanel>
          <TabPanel id={`${id}-source-panel`} aria-labelledby={`${id}-source-tab`} hidden={tab !== "source"}>
            <h3>配置来源</h3><dl><Field label="来源文件" value={row.sourceFileName || "未提供"} /><Field label="节点路径" value={row.sourceNodePath || row.topologyPath || "未提供"} /><Field label="源码行" value={row.sourceLine ? String(row.sourceLine) : null} /><Field label="器件 / 驱动" value={[row.instanceName, row.driverModule, row.compatible].filter(Boolean).join(" · ")} /></dl>
            <h4>当前参数配置片段</h4><pre><code>{`${row.propertyKey}${row.rawValue.trim() ? ` = ${formatDtsRawValueForUi(row.rawValue)}` : ""};`}</code></pre>
            <div className="parameter-inspector__value-actions">{onOpenSource ? <Button variant="outline" disabled={pending} onClick={onOpenSource}>在源码中定位</Button> : null}{onStartDtsReload ? <Button variant="outline" disabled={pending} onClick={onStartDtsReload}><FlaskConical size={16} aria-hidden="true" />带入 DTS 调试</Button> : null}</div>
            <details className="parameter-inspector__technical"><summary>技术详情</summary><dl><Field label="绑定标识" value={row.bindingId} /><Field label="定义标识" value={row.definitionId || row.parameterSpecId} /><Field label="固定修订" value={row.effectiveRevisionId || row.parameterSpecVersionId} /><Field label="来源实例" value={row.sourceOccurrenceId} /></dl></details>
          </TabPanel>
        </div>
        <footer className="parameter-inspector__footer"><div aria-live="polite">{feedback ? <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "parameter-inspector__error" : "parameter-inspector__success"}>{feedback.message}</p> : <p>关闭会保留本次输入；草稿不会直接改变生效配置。</p>}</div><div className="parameter-inspector__value-actions"><Button variant="outline" onClick={onClose} disabled={pending}>关闭</Button>{writable ? <><Button variant="ghost" onClick={() => { onResetDraft?.(); setFeedback(null); }} disabled={locked || !hasLocalChanges}>放弃本地修改</Button><Button disabled={locked || !hasLocalChanges || Boolean(syntaxError) || !value.reason.trim()} onClick={() => void save()}>{pending ? "保存中…" : "保存草稿"}</Button></> : null}</div></footer>
      </>}
    </ModalDialog>
    <ConfirmDialog open={Boolean(compareReplacement)} title="替换未保存的修改？" description="引用的项目配置将替换当前目标值和修改原因，其他参数的输入不受影响。" confirmLabel="引用并替换" cancelLabel="继续编辑" onCancel={() => setCompareReplacement(null)} onConfirm={() => { if (compareReplacement) onUseCompareAsDraft?.(compareReplacement); setCompareReplacement(null); setTab("configuration"); setFeedback(null); }} />
  </>;
}
import { formatParameterConstraints } from "@/domain/parameter-topology/formatParameterConstraints";

import { useCallback, useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createGovernanceIdempotencyKey } from "@/features/parameter-catalog-governance/governanceState";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import type { ModuleStructurePreviewResponse, ModuleStructureReceipt } from "@/infrastructure/http/parameterCatalogDtos";
import { ModuleStructureDriverCreation } from "./ModuleStructureDriverCreation";
import { importDiagnostic, ModuleStructureImportError, type ImportDiagnostic } from "./ModuleStructureImportError";

type Resolutions = Record<string, "current" | "file">;
type Preview = ModuleStructurePreviewResponse;
type Receipt = ModuleStructureReceipt;
const value = (item: unknown) => item === undefined ? "（省略）" : JSON.stringify(item);
const fieldLabels: Record<string, string> = { name: "名称", description: "描述", scope: "范围", sortOrder: "排序", importance: "重要性", parentRef: "上级模块", create: "新增模块", delete: "删除模块", legacyImpact: "将解除的遗留引用数", placement: "归属", displayAlias: "展示别名",
  state: "登记状态", kind: "当前组织主体类型", ownerSubjectId: "所属驱动", recognition: "识别规则", "recognition.mode": "识别模式", "recognition.compatibles": "兼容标识", "recognition.driverNature": "驱动性质",
  "recognition.instanceCardinality": "实例基数", "recognition.nodeTypeName": "节点名称" };

export function ModuleStructureImport({ apiClient, organizationId, canImport, sessionPermissions, onChanged }: {
  apiClient?: ApiClient; organizationId?: string; canImport: boolean; sessionPermissions?: readonly string[] | null; onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [mode, setMode] = useState<"update" | "copy">("update");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState<ImportDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [confirmPublication, setConfirmPublication] = useState(false);
  const [publicationAttempted, setPublicationAttempted] = useState(false);
  const write = useRef<{ fingerprint: string; key: string } | null>(null);
  const publicationWrite = useRef<{ fingerprint: string; key: string; retryAfterFailure: boolean } | null>(null);
  const requestPending = useRef(false);
  const requestEpoch = useRef(0);
  const creation = preview?.driverCreation;
  const publishing = creation?.phase === "publishing";
  const needsPublication = creation?.phase === "required" || creation?.phase === "blocked";
  const canPublish = Boolean(canImport && sessionPermissions?.includes("catalog:author") && sessionPermissions.includes("catalog:publish"));
  const publicationStarted = Boolean(publicationAttempted || creation?.jobId || creation?.candidateId);
  const readyToApply = !creation || creation.phase === "ready" || creation.phase === "applied";
  const dirty = Boolean(fileName && !receipt);
  const base = `/api/v2/organizations/${encodeURIComponent(organizationId ?? "")}/module-structure`;
  const clearError = useCallback(() => { setError(""); setDiagnostic(null); }, []);
  const close = () => { requestEpoch.current++; setOpen(false); setDocument(null); setFileName(""); setResolutions({}); setMappings({}); setMode("update"); setPreview(null); setReason(""); setReceipt(null); setPublicationAttempted(false); clearError(); write.current = null; publicationWrite.current = null; };
  const requestClose = () => { if (publicationStarted && !receipt) setOpen(false); else if (dirty) setDiscard(true); else close(); };
  const showError = useCallback((cause: unknown, fallback: string, phase: ImportDiagnostic["phase"]) => setDiagnostic(importDiagnostic(cause, fallback, phase)), []);
  const refresh = useCallback(async (next: Resolutions, nextMappings = mappings, background = false) => {
    if (!apiClient || !document || requestPending.current) return;
    const epoch = requestEpoch.current;
    requestPending.current = true;
    if (!background) { setBusy(true); clearError(); setPreview(null); }
    try {
      const updated = await apiClient.post<Preview>(`${base}/previews`, { mode, document, resolutions: next, mappings: nextMappings });
      if (epoch === requestEpoch.current) {
        if (updated.driverCreation?.phase === "blocked" && publicationWrite.current) publicationWrite.current.retryAfterFailure = true;
        setPreview(updated); clearError();
      }
    } catch (cause) {
      if (epoch === requestEpoch.current) showError(cause, "预览失败，请检查文件后重试。", "preview");
    } finally { requestPending.current = false; if (epoch === requestEpoch.current && !background) setBusy(false); }
  }, [apiClient, document, mappings, base, mode, clearError, showError]);
  useEffect(() => {
    if (!open || !publishing || diagnostic || busy || receipt) return;
    const timer = window.setTimeout(() => { void refresh(resolutions, mappings, true); }, 1500);
    return () => window.clearTimeout(timer);
  }, [open, publishing, preview, diagnostic, busy, receipt, refresh, resolutions, mappings]);
  useEffect(() => () => { requestEpoch.current++; }, []);
  const publishDrivers = async () => {
    if (!apiClient || !preview || !needsPublication || !canPublish || !reason.trim() || preview.conflicts.length || requestPending.current) return;
    const body = { mode, document, resolutions, mappings, token: preview.token, reason: reason.trim() };
    const fingerprint = JSON.stringify({ mode, document, resolutions, mappings, reason: reason.trim() });
    if (publicationWrite.current?.fingerprint !== fingerprint || (creation?.phase === "blocked" && publicationWrite.current.retryAfterFailure)) {
      publicationWrite.current = { fingerprint, key: createGovernanceIdempotencyKey(), retryAfterFailure: false };
    }
    publicationWrite.current.retryAfterFailure = false;
    const epoch = requestEpoch.current;
    requestPending.current = true; setBusy(true); setPublicationAttempted(true); clearError();
    try {
      const updated = await apiClient.post<Preview>(`${base}/driver-publications`, { ...body, idempotencyKey: publicationWrite.current.key });
      if (epoch === requestEpoch.current) {
        publicationWrite.current.retryAfterFailure = updated.driverCreation?.phase === "blocked";
        setPreview(updated);
      }
    } catch (cause) {
      if (epoch === requestEpoch.current) {
        if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setPreview(null);
        showError(cause, "发布失败，请刷新预览核对进度后重试。", "publish");
      }
    } finally { requestPending.current = false; if (epoch === requestEpoch.current) { setBusy(false); setConfirmPublication(false); } }
  };
  const apply = async () => {
    if (!apiClient || !preview || !readyToApply || requestPending.current) return;
    const body = { mode, document, resolutions, mappings, token: preview.token, reason: reason.trim() };
    const fingerprint = JSON.stringify(body);
    if (write.current?.fingerprint !== fingerprint) write.current = { fingerprint, key: createGovernanceIdempotencyKey() };
    const epoch = requestEpoch.current;
    requestPending.current = true; setBusy(true); clearError();
    try {
      const applied = await apiClient.post<Receipt>(`${base}/applies`, { ...body, idempotencyKey: write.current.key });
      if (epoch === requestEpoch.current) { setReceipt(applied); onChanged?.(); }
    } catch (cause) {
      if (epoch === requestEpoch.current) {
        if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setPreview(null);
        showError(cause, "提交失败，请重试。", "apply");
      }
    } finally { requestPending.current = false; if (epoch === requestEpoch.current) setBusy(false); }
  };
  const sourceInfo = document && typeof document === "object" && "source" in document ? (document as { source?: { organizationId?: unknown; exportId?: unknown } }).source : undefined;
  const source = sourceInfo?.organizationId;
  const modules = document && typeof document === "object" && "modules" in document && Array.isArray(document.modules) ? document.modules : [];
  const subjects = document && typeof document === "object" && "subjects" in document && Array.isArray(document.subjects) ? document.subjects : [];
  const subjectId = (id: string) => id.startsWith("subject:") ? id.slice(8) : subjects.some((subject: { subjectId?: string }) => subject.subjectId === id) ? id : null;
  const moduleLabel = (id: string) => {
    const subject = subjects.find((entry: { subjectId?: string }) => entry.subjectId === subjectId(id));
    const created = creation?.drivers.find(driver => driver.subjectId === subjectId(id));
    if (created) return created.displayAlias || created.compatible;
    if (subjectId(id)) return subject?.displayAlias || subject?.recognition?.effective?.nodeTypeName || subject?.recognition?.effective?.compatibles?.[0] || `主体 ${subjectId(id)}`;
    const module = modules.find((entry: { sourceId?: string; ref?: string }) => entry.sourceId === id || entry.ref === id);
    return typeof module?.name === "string" ? module.name : id;
  };
  const displayValue = (item: unknown): string => {
    if (item === null) return "无";
    if (typeof item === "string") return ({ "": "空", active: "启用", retired: "停用", inherit: "继承目录设置", override: "自定义覆盖", driver: "驱动主体", "node-type": "节点类型主体", "configuration-schema": "配置规范主体", low: "低", medium: "中", high: "高" } as Record<string, string>)[item] ?? item;
    if (Array.isArray(item)) return item.length ? item.join("、") : "无";
    if (!item || typeof item !== "object" || !("kind" in item)) return value(item);
    const placement = item as { kind: string; moduleRef?: string; sourceId?: string };
    if (placement.kind === "unset") return "未设置归属";
    if (placement.kind === "unclassified") return "未分类";
    if (placement.kind !== "module") return placement.sourceId ?? value(item);
    const path: string[] = [];
    let ref = placement.moduleRef;
    const seen = new Set<string>();
    while (ref && !seen.has(ref)) {
      seen.add(ref);
      const module = modules.find((entry: { ref?: string }) => entry.ref === ref);
      if (!module) { path.unshift(ref); break; }
      path.unshift(module.name ?? ref); ref = module.parentRef;
    }
    return path.join(" / ");
  };
  const groups = new Map<string, Preview["changes"]>();
  for (const change of preview?.changes ?? []) {
    const key = subjectId(change.moduleId) ? `subject:${subjectId(change.moduleId)}` : change.moduleId;
    const group = groups.get(key) ?? []; group.push(change); groups.set(key, group);
  }
  const recognitionFields = ["mode", "compatibles", "driverNature", "instanceCardinality", "nodeTypeName"] as const;
  const recognitionValue = (item: unknown, field: typeof recognitionFields[number]) => {
    if (!item || typeof item !== "object") return null;
    const rule = item as Record<string, unknown>;
    if (field === "mode") return rule.mode ?? (rule.overridden === true ? "override" : rule.overridden === false ? "inherit" : null);
    const effective = rule.effective as Record<string, unknown> | undefined;
    return rule[field] ?? effective?.[field] ?? null;
  };
  return <>
    <Button type="button" size="sm" variant="outline" disabled={!canImport || !apiClient || !organizationId} onClick={() => setOpen(true)}>导入结构</Button>
    {open ? <>
      <SettingsLeaveGuard dirty={dirty} saving={busy} description={publicationStarted ? "已提交的发布会继续。返回后重新上传同一份 JSON 并预览，可继续登记。" : "离开将放弃上传文件和未提交的冲突选择。"} />
      <ModalDialog open={!discard && !confirmPublication} onDismiss={busy ? undefined : requestClose} className="submission-dialog param-admin-module-edit-dialog module-structure-import" describedBy>
        {({ titleId, descriptionId }) => <>
          <div className="submission-dialog-head"><div><h2 id={titleId}>导入模块结构</h2>
            <p id={descriptionId}>更新当前组织结构，并可声明新驱动；或复制模块和主体到当前组织。删除须明确处置子模块和主体归属；复制须确认复用或新建。</p></div></div>
          <div className="param-admin-module-edit-body">
            {!receipt ? <SelectControl ariaLabel="导入模式" value={mode} disabled={busy || publishing} options={[{ value: "update", label: "更新当前组织" }, { value: "copy", label: "复制到当前组织" }]} onValueChange={next => {
              setMode(next as "update" | "copy"); setMappings({}); setResolutions({}); setPreview(null); clearError();
            }} /> : null}
            {!receipt ? <label className="button subtle focus-within:ring-2 focus-within:ring-ring">选择 JSON 文件<input className="sr-only" aria-label="JSON 文件" type="file" accept="application/json,.json" disabled={busy || publishing} onChange={async event => {
              const file = event.target.files?.[0]; if (!file) return;
              const epoch = ++requestEpoch.current;
              setFileName(file.name); setDocument(null); setPreview(null); setReceipt(null); setResolutions({}); setMappings({}); setPublicationAttempted(false); clearError(); write.current = null; publicationWrite.current = null;
              if (file.size > 32 * 1024 * 1024) { setError("JSON 文件不能超过 32 MiB。"); return; }
              try {
                const text = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(file);
                });
                if (epoch !== requestEpoch.current) return;
                const parsed = JSON.parse(text);
                if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 4 * 1024 * 1024) { setError("JSON 内容不能超过 4 MiB。"); return; }
                if (epoch === requestEpoch.current) setDocument(parsed);
              } catch (cause) { if (epoch === requestEpoch.current) showError(cause, "JSON 格式无效，请检查文件后重新上传。", "read"); }
            }} /></label> : null}
            {fileName ? <p>文件：{fileName}；来源组织：{typeof source === "string" ? source : "未提供"}；目标组织：{organizationId}</p> : null}
            {preview && !receipt ? <>
              {creation ? <ModuleStructureDriverCreation creation={creation} displayPlacement={displayValue} canPublish={canPublish} /> : null}
              {mode === "copy" ? <><h3>模块映射</h3>{preview.mappings?.map(mapping => <div key={mapping.ref}>
                <strong>{moduleLabel(mapping.ref)}</strong>
                <SelectControl ariaLabel={`${mapping.ref} 的目标模块`} value={mapping.selected ?? ""} disabled={busy || mapping.frozen} options={[
                  { value: "", label: "请选择", disabled: true }, { value: "create", label: "新建目标模块" },
                  ...mapping.candidates.map(candidate => ({ value: candidate.id, label: `建议：复用 ${candidate.name}` })),
                  ...(preview.targets ?? []).filter(target => !mapping.candidates.some(candidate => candidate.id === target.id)).map(target => ({ value: target.id, label: `复用 ${target.name}` }))
                ]} onValueChange={choice => { if (!choice) return; const next = { ...mappings, [mapping.ref]: choice }; setMappings(next); void refresh(resolutions, next); }} />
              </div>)}</> : null}
              <h3>变更（{preview.changes.length}）</h3>
{preview.changes.length ? [...groups].map(([id, changes]) => <section key={id}>
  <h4>{moduleLabel(id)}</h4><ul>{changes.flatMap((change, index) => change.field === "recognition"
    ? [...recognitionFields.filter(field => JSON.stringify(recognitionValue(change.before, field)) !== JSON.stringify(recognitionValue(change.after, field))).map(field => <li key={`${index}:${field}`}>{fieldLabels[`recognition.${field}`]}：{displayValue(recognitionValue(change.before, field))} → {displayValue(recognitionValue(change.after, field))}</li>), <li key={`${index}:details`}><details><summary>识别规则技术详情</summary><p>变更前：{value(change.before)}</p><p>变更后：{value(change.after)}</p></details></li>]
    : [<li key={index}>{fieldLabels[change.field] ?? change.field}：{change.field === "parentRef" && typeof change.before === "string" ? moduleLabel(change.before) : displayValue(change.before)} → {change.field === "parentRef" && typeof change.after === "string" ? moduleLabel(change.after) : displayValue(change.after)}</li>])}</ul>
</section>) : <p>没有领域数据变更。</p>}
              {preview.impact?.length ? <><h3>受影响项目</h3><ul>{preview.impact.map(item => <li key={`${item.subjectId}:${item.projectId}`}>主体 {item.subjectId} · 项目 {item.projectId} · 绑定 {item.bindingCount} · 定义 {item.definitions.join("、")}</li>)}</ul></> : null}
              <h3>待解决冲突（{preview.conflicts.length}）</h3>
              {preview.conflicts.filter(conflict => conflict.field !== "mapping").map(conflict => <div key={conflict.key}>
                <strong>{moduleLabel(conflict.moduleId)} · {fieldLabels[conflict.field] ?? conflict.field}</strong>
                <dl><dt>基准</dt><dd>{displayValue(conflict.baseline)}</dd><dt>文件</dt><dd>{displayValue(conflict.file)}</dd><dt>当前</dt><dd>{displayValue(conflict.current)}</dd></dl>
                <SelectControl ariaLabel={`${conflict.key} 的冲突选择`} value={resolutions[conflict.key] ?? ""} disabled={busy} options={[{ value: "", label: "请选择", disabled: true }, { value: "current", label: "保留当前" }, { value: "file", label: "采用文件" }]} onValueChange={choice => {
                  if (!choice) return; const next = { ...resolutions, [conflict.key]: choice }; setResolutions(next); void refresh(next);
                }} />
              </div>)}
              {Object.entries(resolutions).filter(([key]) => !preview.conflicts.some(conflict => conflict.key === key)).map(([key, choice]) => <div key={key}>{(() => {
                const split = key.lastIndexOf(":"); const ref = key.slice(0, split); const field = key.slice(split + 1);
                const module = modules.find((entry: { ref?: string }) => entry.ref === ref);
                return `${typeof module?.sourceId === "string" ? moduleLabel(module.sourceId) : ref} · ${fieldLabels[field] ?? field} 的选择`;
              })()}
                <SelectControl ariaLabel={`${key} 的冲突选择`} value={choice} disabled={busy} options={[{ value: "current", label: "保留当前" }, { value: "file", label: "采用文件" }]} onValueChange={nextChoice => {
                  const next = { ...resolutions, [key]: nextChoice }; setResolutions(next); void refresh(next);
                }} /></div>)}
              <label>变更原因<Textarea value={reason} disabled={busy || publishing} onChange={event => setReason(event.target.value)} /></label>
            </> : null}
            {receipt ? <p role="status">回执 {receipt.id}：目标组织 {receipt.organizationId}，更新 {receipt.changedModules} 个模块、{receipt.changedFields} 个字段。{receipt.changedFields === 0 ? " 本次没有领域数据变更。" : ""}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {diagnostic ? <ModuleStructureImportError diagnostic={diagnostic} context={{ fileName, mode, targetOrganizationId: organizationId,
              sourceOrganizationId: typeof source === "string" ? source : undefined, exportId: typeof sourceInfo?.exportId === "string" ? sourceInfo.exportId : undefined }} /> : null}
          </div>
          <div className="dialog-actions"><button type="button" className="button subtle" disabled={busy} onClick={requestClose}>关闭</button>
            {!receipt ? <><button type="button" className="button subtle" disabled={!document || busy} onClick={() => void refresh(resolutions)}>{publishing ? "刷新发布进度" : "预览"}</button>
              {needsPublication ? <button type="button" className="button primary" disabled={!canPublish || !preview || preview.conflicts.length > 0 || !reason.trim() || busy} onClick={() => setConfirmPublication(true)}>{creation?.phase === "blocked" ? "重新发布驱动" : "发布新驱动"}</button>
                : <button type="button" className="button primary" disabled={!preview || !readyToApply || preview.conflicts.length > 0 || !reason.trim() || busy} onClick={() => void apply()}>确认提交</button>}</> : null}</div>
        </>}
      </ModalDialog>
      <ConfirmDialog open={discard} title="放弃导入？" description="上传文件和未提交的冲突选择将丢失。" confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => { setDiscard(false); close(); }} onCancel={() => setDiscard(false)} />
      <ConfirmDialog open={confirmPublication} title="发布新驱动？" description={<p>将发布 {creation?.drivers.length ?? 0} 个新驱动到共享目录。发布成功后仍需在本窗口核对模块与归属并确认提交；关闭窗口不会撤销已发布的驱动。</p>}
        acknowledgement="我已核对影响并确认发布到共享目录" acknowledgementKey={preview?.token} confirmLabel="确认发布新驱动" pending={busy} confirmDisabled={!needsPublication || !canPublish}
        onConfirm={() => void publishDrivers()} onCancel={() => setConfirmPublication(false)} />
    </> : null}
  </>;
}

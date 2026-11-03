import { useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createGovernanceIdempotencyKey } from "@/features/parameter-catalog-governance/governanceState";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";

type Resolutions = Record<string, "current" | "file">;
type Preview = {
  token: string;
  changes: { moduleId: string; field: string; before: unknown; after: unknown }[];
  conflicts: { key: string; moduleId: string; field: string; baseline: unknown; file: unknown; current: unknown }[];
  impact?: { subjectId: string; projectId: string; bindingCount: number; definitions: string[] }[];
  mappings?: { ref: string; selected: string | null; frozen: boolean; candidates: { id: string; name: string; suggested: boolean }[] }[];
  targets?: { id: string; name: string }[];
};
type Receipt = { id: string; organizationId: string; changedModules: number; changedFields: number };
const value = (item: unknown) => item === undefined ? "（省略）" : JSON.stringify(item);
const fieldLabels: Record<string, string> = { name: "名称", description: "描述", scope: "范围", sortOrder: "排序", importance: "重要性", parentRef: "上级模块", create: "新增模块", delete: "删除模块", legacyImpact: "将解除的遗留引用数", placement: "归属", displayAlias: "展示别名",
  state: "登记状态", recognition: "识别规则", "recognition.mode": "识别模式", "recognition.compatibles": "兼容标识", "recognition.driverNature": "驱动性质",
  "recognition.instanceCardinality": "实例基数", "recognition.nodeTypeName": "节点名称" };

export function ModuleStructureImport({ apiClient, organizationId, canImport, onChanged }: {
  apiClient?: ApiClient; organizationId?: string; canImport: boolean; onChanged?: () => void;
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
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const write = useRef<{ fingerprint: string; key: string } | null>(null);
  const dirty = Boolean(fileName && !receipt);
  const base = `/api/v2/organizations/${encodeURIComponent(organizationId ?? "")}/module-structure`;
  const close = () => { setOpen(false); setDocument(null); setFileName(""); setResolutions({}); setMappings({}); setMode("update"); setPreview(null); setReason(""); setReceipt(null); setError(""); write.current = null; };
  const requestClose = () => { if (dirty) setDiscard(true); else close(); };
  const showError = (cause: unknown, fallback: string) => {
    const path = cause instanceof WiseEffApiError && typeof cause.details.path === "string" ? `（${cause.details.path}）` : "";
    const issues = cause instanceof WiseEffApiError && Array.isArray(cause.details.issues)
      ? cause.details.issues.map((issue: { path?: unknown; message?: unknown }) => `${Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path ?? "$")}：${String(issue.message ?? "无效")}`).join("；") : "";
    const labels: Record<string, string> = {
      "Subject changes are not supported.": "暂不支持修改主体。",
      "New, structural, or reference changes are not supported.": "暂不支持新增、结构或引用变更。",
      "Unknown or duplicate Subject.": "主体未知或重复。",
      "Duplicate module reference.": "模块引用重复。",
      "A module was deleted after export.": "模块在导出后已被删除。",
      "Module name is required.": "模块名称不能为空。"
    };
    setError(`${cause instanceof WiseEffApiError && labels[cause.message] || presentError(cause, fallback)}${path}${issues ? ` ${issues}` : ""}`);
  };
  const refresh = async (next: Resolutions, nextMappings = mappings) => {
    if (!apiClient || !document) return;
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await apiClient.post<Preview>(`${base}/previews`, { mode, document, resolutions: next, mappings: nextMappings })); }
    catch (cause) { showError(cause, "预览失败，请检查文件后重试。"); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!apiClient || !preview) return;
    const body = { mode, document, resolutions, mappings, token: preview.token, reason: reason.trim() };
    const fingerprint = JSON.stringify(body);
    if (write.current?.fingerprint !== fingerprint) write.current = { fingerprint, key: createGovernanceIdempotencyKey() };
    setBusy(true); setError("");
    try {
      setReceipt(await apiClient.post<Receipt>(`${base}/applies`, { ...body, idempotencyKey: write.current.key }));
      onChanged?.();
    } catch (cause) {
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") {
        setPreview(null); setError("目标状态或预览已变化，请重新预览后确认。");
      } else showError(cause, "提交失败，请重试。");
    } finally { setBusy(false); }
  };
  const source = document && typeof document === "object" && "source" in document ? (document as { source?: { organizationId?: unknown } }).source?.organizationId : undefined;
  const modules = document && typeof document === "object" && "modules" in document && Array.isArray(document.modules) ? document.modules : [];
  const moduleLabel = (id: string) => {
    if (id.startsWith("subject:")) return `主体 ${id.slice(8)}`;
    const module = modules.find((entry: { sourceId?: string; ref?: string }) => entry.sourceId === id || entry.ref === id);
    return typeof module?.name === "string" ? `${module.name}（${id}）` : id;
  };
  const displayValue = (item: unknown): string => {
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
  return <>
    <Button type="button" size="sm" variant="outline" disabled={!canImport || !apiClient || !organizationId} onClick={() => setOpen(true)}>导入结构</Button>
    {open ? <>
      <SettingsLeaveGuard dirty={dirty} saving={busy} description="离开将放弃上传文件和未提交的冲突选择。" />
      <ModalDialog open={!discard} onDismiss={busy ? undefined : requestClose} className="submission-dialog param-admin-module-edit-dialog module-structure-import" describedBy>
        {({ titleId, descriptionId }) => <>
          <div className="submission-dialog-head"><div><h2 id={titleId}>导入模块结构</h2>
            <p id={descriptionId}>更新当前组织结构，或复制业务模块到当前目标组织。删除须明确处置子模块和主体归属；复制须确认复用或新建。生命周期暂不能与删除或识别设置同时修改。</p></div></div>
          <div className="param-admin-module-edit-body">
            {!receipt ? <SelectControl ariaLabel="导入模式" value={mode} disabled={busy} options={[{ value: "update", label: "更新当前组织" }, { value: "copy", label: "复制到当前组织" }]} onValueChange={next => {
              setMode(next as "update" | "copy"); setMappings({}); setResolutions({}); setPreview(null);
            }} /> : null}
            {!receipt ? <label className="button subtle focus-within:ring-2 focus-within:ring-ring">选择 JSON 文件<input className="sr-only" aria-label="JSON 文件" type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
              const file = event.target.files?.[0]; if (!file) return;
              setFileName(file.name); setDocument(null); setPreview(null); setReceipt(null); setResolutions({}); setMappings({}); setError(""); write.current = null;
              if (file.size > 4 * 1024 * 1024) { setError("JSON 文件不能超过 4 MiB。"); return; }
              try {
                const text = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(file);
                });
                setDocument(JSON.parse(text));
              } catch { setError("JSON 格式无效，请检查文件后重新上传。"); }
            }} /></label> : null}
            {fileName ? <p>文件：{fileName}；来源组织：{typeof source === "string" ? source : "未提供"}；目标组织：{organizationId}</p> : null}
            {preview && !receipt ? <>
              {mode === "copy" ? <><h3>模块映射</h3>{preview.mappings?.map(mapping => <div key={mapping.ref}>
                <strong>{moduleLabel(mapping.ref)}</strong>
                <SelectControl ariaLabel={`${mapping.ref} 的目标模块`} value={mapping.selected ?? ""} disabled={busy || mapping.frozen} options={[
                  { value: "", label: "请选择", disabled: true }, { value: "create", label: "新建目标模块" },
                  ...mapping.candidates.map(candidate => ({ value: candidate.id, label: `建议：复用 ${candidate.name}` })),
                  ...(preview.targets ?? []).filter(target => !mapping.candidates.some(candidate => candidate.id === target.id)).map(target => ({ value: target.id, label: `复用 ${target.name}` }))
                ]} onValueChange={choice => { if (!choice) return; const next = { ...mappings, [mapping.ref]: choice }; setMappings(next); void refresh(resolutions, next); }} />
              </div>)}</> : null}
              <h3>变更（{preview.changes.length}）</h3>
{preview.changes.length ? <ul>{preview.changes.map((change, index) => <li key={`${change.moduleId}:${change.field}:${index}`}>{moduleLabel(change.moduleId)} · {fieldLabels[change.field] ?? change.field}：{change.field === "parentRef" && typeof change.before === "string" ? moduleLabel(change.before) : displayValue(change.before)} → {change.field === "parentRef" && typeof change.after === "string" ? moduleLabel(change.after) : displayValue(change.after)}</li>)}</ul> : <p>没有领域数据变更。</p>}
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
              <label>变更原因<Textarea value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
            </> : null}
            {receipt ? <p role="status">回执 {receipt.id}：目标组织 {receipt.organizationId}，更新 {receipt.changedModules} 个模块、{receipt.changedFields} 个字段。{receipt.changedFields === 0 ? " 本次没有领域数据变更。" : ""}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <div className="dialog-actions"><button type="button" className="button subtle" disabled={busy} onClick={requestClose}>关闭</button>
            {!receipt ? <><button type="button" className="button subtle" disabled={!document || busy} onClick={() => void refresh(resolutions)}>预览</button>
              <button type="button" className="button primary" disabled={!preview || preview.conflicts.length > 0 || !reason.trim() || busy} onClick={() => void apply()}>确认提交</button></> : null}</div>
        </>}
      </ModalDialog>
      <ConfirmDialog open={discard} title="放弃导入？" description="上传文件和未提交的冲突选择将丢失。" confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => { setDiscard(false); close(); }} onCancel={() => setDiscard(false)} />
    </> : null}
  </>;
}

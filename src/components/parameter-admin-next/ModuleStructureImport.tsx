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
};
type Receipt = { id: string; organizationId: string; changedModules: number; changedFields: number };
const value = (item: unknown) => item === undefined ? "（省略）" : JSON.stringify(item);
const fieldLabels: Record<string, string> = { name: "名称", description: "描述", scope: "范围", sortOrder: "排序", importance: "重要性" };

export function ModuleStructureImport({ apiClient, organizationId, canImport, onChanged }: {
  apiClient?: ApiClient; organizationId?: string; canImport: boolean; onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const write = useRef<{ fingerprint: string; key: string } | null>(null);
  const dirty = Boolean(fileName && !receipt);
  const base = `/api/v2/organizations/${encodeURIComponent(organizationId ?? "")}/module-structure`;
  const close = () => { setOpen(false); setDocument(null); setFileName(""); setResolutions({}); setPreview(null); setReason(""); setReceipt(null); setError(""); write.current = null; };
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
  const refresh = async (next: Resolutions) => {
    if (!apiClient || !document) return;
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await apiClient.post<Preview>(`${base}/previews`, { mode: "update", document, resolutions: next })); }
    catch (cause) { showError(cause, "预览失败，请检查文件后重试。"); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!apiClient || !preview) return;
    const body = { mode: "update", document, resolutions, token: preview.token, reason: reason.trim() };
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
    const module = modules.find((entry: { sourceId?: string }) => entry.sourceId === id);
    return typeof module?.name === "string" ? `${module.name}（${id}）` : id;
  };
  return <>
    <Button type="button" size="sm" variant="outline" disabled={!canImport || !apiClient || !organizationId} onClick={() => setOpen(true)}>导入结构</Button>
    {open ? <>
      <SettingsLeaveGuard dirty={dirty} saving={busy} description="离开将放弃上传文件和未提交的冲突选择。" />
      <ModalDialog open={!discard} onDismiss={busy ? undefined : requestClose} className="submission-dialog param-admin-module-edit-dialog module-structure-import" describedBy>
        {({ titleId, descriptionId }) => <>
          <div className="submission-dialog-head"><div><h2 id={titleId}>导入模块结构</h2>
            <p id={descriptionId}>更新当前组织已有模块资料。新增、移动、删除、主体设置和跨组织复制尚不支持。</p></div></div>
          <div className="param-admin-module-edit-body">
            {!receipt ? <label className="button subtle focus-within:ring-2 focus-within:ring-ring">选择 JSON 文件<input className="sr-only" aria-label="JSON 文件" type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
              const file = event.target.files?.[0]; if (!file) return;
              setFileName(file.name); setDocument(null); setPreview(null); setReceipt(null); setResolutions({}); setError(""); write.current = null;
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
              <h3>变更（{preview.changes.length}）</h3>
              {preview.changes.length ? <ul>{preview.changes.map((change, index) => <li key={`${change.moduleId}:${change.field}:${index}`}>{moduleLabel(change.moduleId)} · {fieldLabels[change.field] ?? change.field}：{value(change.before)} → {value(change.after)}</li>)}</ul> : <p>没有领域数据变更。</p>}
              <h3>待解决冲突（{preview.conflicts.length}）</h3>
              {preview.conflicts.map(conflict => <div key={conflict.key}>
                <strong>{moduleLabel(conflict.moduleId)} · {fieldLabels[conflict.field] ?? conflict.field}</strong>
                <dl><dt>基准</dt><dd>{value(conflict.baseline)}</dd><dt>文件</dt><dd>{value(conflict.file)}</dd><dt>当前</dt><dd>{value(conflict.current)}</dd></dl>
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

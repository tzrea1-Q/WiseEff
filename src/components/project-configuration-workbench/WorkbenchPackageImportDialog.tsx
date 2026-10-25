import { useMemo, useRef, useState } from "react";
import { configSetPackageLimits, type ConfigSetImportBody, type ConfigSetImportPreview, type ConfigSetImportResult } from "@wiseeff/dto-schemas";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/common/SelectControl";
import { createConfigSetPackageClient } from "@/infrastructure/http/configSetPackageClient";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";

export function WorkbenchPackageImportDialog({ projectId, onDismiss, onApplied, client: supplied }: {
  projectId: string; onDismiss: () => void; onApplied: (result: ConfigSetImportResult) => void | Promise<void>;
  client?: ReturnType<typeof createConfigSetPackageClient>;
}) {
  const client = useMemo(() => supplied ?? createConfigSetPackageClient(), [supplied]);
  const [archive, setArchive] = useState<ConfigSetImportBody["archive"] | null>(null), [name, setName] = useState("");
  const [ownership, setOwnership] = useState<ConfigSetImportBody["ownership"]>("reuse"), [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ConfigSetImportPreview | null>(null), [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<string[]>([]), [pending, setPending] = useState<"file" | "preview" | "apply" | null>(null);
  const first = useRef<HTMLInputElement>(null), generation = useRef(0);
  const mutation = useRef<{ proofToken: string; reason: string; clientMutationId: string } | null>(null);
  function invalidate() { generation.current += 1; setPending(null); setPreview(null); setError(""); setDiagnostics([]); mutation.current = null; }
  function showError(cause: unknown, unknownResult = false) {
    const message = presentError(cause, unknownResult ? "文件和输入已保留。" : "配置预览失败，文件和输入已保留。");
    setError(unknownResult ? `未能确认导入结果，请重试同一操作。${message}` : message);
    const rows = cause instanceof WiseEffApiError ? cause.details.diagnostics : null;
    setDiagnostics(Array.isArray(rows) ? rows.flatMap(row => row && typeof row === "object" && "message" in row && typeof row.message === "string" ? [row.message] : []) : []);
  }
  async function chooseFile(file: File | undefined) {
    invalidate(); setArchive(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip") || file.size > configSetPackageLimits.maxArchiveBytes) { setError("请选择不超过 17 MiB 的完整配置 ZIP。"); return; }
    setPending("file"); const selected = generation.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      if (selected !== generation.current) return;
      setArchive({ name: file.name, contentBase64: btoa(binary) });
      setName(current => current || file.name.replace(/(?:-export)?\.zip$/iu, ""));
    } catch (cause) { if (selected === generation.current) showError(cause); }
    finally { if (selected === generation.current) setPending(null); }
  }
  async function inspect() {
    if (!archive || !name.trim() || pending) return;
    invalidate(); setPending("preview"); const selected = generation.current;
    try { const result = await client.preview(projectId, { name: name.trim(), ownership, archive }); if (selected === generation.current) setPreview(result); }
    catch (cause) { if (selected === generation.current) showError(cause); }
    finally { if (selected === generation.current) setPending(null); }
  }
  async function apply() {
    if (!archive || !preview || !reason.trim() || pending) return;
    setPending("apply"); setError("");
    mutation.current ??= { proofToken: preview.proofToken, reason: reason.trim(), clientMutationId: crypto.randomUUID() };
    try { await onApplied(await client.apply(projectId, { name: name.trim(), ownership, archive, ...mutation.current })); }
    catch (cause) {
      if (cause instanceof WiseEffApiError && ["CONFLICT", "VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND"].includes(cause.code)) { mutation.current = null; setPreview(null); }
      showError(cause, Boolean(mutation.current));
    } finally { setPending(null); }
  }
  const locked = pending === "apply" || Boolean(mutation.current);
  return <ModalDialog open onDismiss={pending ? undefined : onDismiss} initialFocusRef={first} describedBy
    className="review-dialog submission-dialog configuration-workbench__package-import" backdropClassName="param-admin-modal-backdrop">
    {({ titleId, descriptionId }) => <>
      <header><h2 id={titleId}>导入完整配置</h2><p id={descriptionId}>在此空项目重现配置包中的原始源码。项目文件与参数身份将重新生成。</p></header>
      <div className="review-dialog__body" aria-busy={Boolean(pending)}>
        <label>配置包<Input ref={first} type="file" accept=".zip,application/zip" disabled={Boolean(pending) || locked}
          onChange={event => { void chooseFile(event.target.files?.[0]); }} /></label>
        {archive ? <p className="configuration-workbench__package-path">{archive.name}</p> : null}
        <label>配置名称<Input value={name} maxLength={120} disabled={locked} onChange={event => { invalidate(); setName(event.target.value); }} /></label>
        <label>源码归属<SelectControl ariaLabel="源码归属" value={ownership} disabled={locked} onValueChange={value => { invalidate(); setOwnership(value); }}
          options={[{value:"reuse",label:"复用精确共享版本"},{value:"private",label:"全部作为项目私有源码"}]} /></label>
        <p>{ownership === "reuse" ? "只引用当前组织可用的相同发布版本，后续发布不会自动更新本项目。" : "保留全部原始源码及构建输入，不创建共享资源或共享引用。"}</p>
        {pending ? <p role="status">{pending === "file" ? "正在读取配置包…" : pending === "preview" ? "正在验证原始源码、版本与构建…" : "正在导入配置…"}</p> : null}
        {preview ? <section aria-label="配置导入预览">
          <p className="configuration-workbench__package-path">入口：{preview.entryFile ?? "JSON 配置"} · {preview.nodeCount} 个节点</p>
          {preview.sharedVersions.length ? <ul aria-label="固定共享版本">{preview.sharedVersions.map((row, index) => <li key={index}>{row.name} · 版本 {row.version}<span className="configuration-workbench__package-path"> · 目录：{row.mountPath || "根目录"}</span></li>)}</ul> : null}
          <ul aria-label="配置包文件">{preview.members.map(row => <li key={row.sourceName}><span className="configuration-workbench__package-path">{row.sourceName}</span> · {row.ownership === "shared" ? "共享只读" : "项目私有"}</li>)}</ul>
          {preview.diagnostics.map((row, index) => <p key={index}>{row.message}</p>)}
          <label>导入原因<Input value={reason} maxLength={2000} disabled={locked} onChange={event => setReason(event.target.value)} /></label>
        </section> : null}
        {error ? <p role="alert">{error}</p> : null}
        {diagnostics.length ? <ul aria-label="来源校验诊断">{diagnostics.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
      </div>
      <footer className="review-dialog__footer"><Button variant="outline" disabled={Boolean(pending)} onClick={onDismiss}>取消</Button>
        {preview ? <Button disabled={Boolean(pending) || !reason.trim()} onClick={() => void apply()}>{pending === "apply" ? "正在导入…" : mutation.current ? "重试同一操作" : "确认导入"}</Button>
          : <Button disabled={Boolean(pending) || !archive || !name.trim()} onClick={() => void inspect()}>{pending === "preview" ? "正在验证…" : "预览导入"}</Button>}</footer>
    </>}
  </ModalDialog>;
}

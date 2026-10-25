import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SharedDtsiDraft, SharedDtsiDraftInput, SharedDtsiResourceSummary } from "@wiseeff/dto-schemas";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SearchField } from "@/components/common/SearchField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkbenchDtsEditor, type WorkbenchDtsEditorHandle } from "@/components/project-configuration-workbench/WorkbenchDtsEditor";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import "./shared-dtsi.css";

type Props = { apiClient?: ApiClient; canWrite: boolean; search: string; onNavigate: (path: string) => void };
const empty: SharedDtsiDraftInput = { name: "", sourceName: "common.dtsi", content: "" };
const draftInput = (draft: SharedDtsiDraft): SharedDtsiDraftInput => ({ name: draft.name,
  sourceName: draft.members[0]!.sourceName, content: draft.members[0]!.content });
const message = (error: unknown) => error instanceof WiseEffApiError ? error.message : "请求失败，请重试。";

export function SharedDtsiPage({ apiClient, canWrite, search, onNavigate }: Props) {
  const client = useMemo(() => apiClient ? createSharedDtsiClient(apiClient) : null, [apiClient]);
  const selected = new URLSearchParams(search).get("resource") ?? "";
  const [rows, setRows] = useState<SharedDtsiResourceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<SharedDtsiDraft | null>(null);
  const [form, setForm] = useState(empty);
  const [editorDirty, setEditorDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const editor = useRef<WorkbenchDtsEditorHandle>(null);
  const upload = useRef<HTMLInputElement>(null);
  const base = draft ? draftInput(draft) : empty;
  const dirty = Boolean(selected) && canWrite && (editorDirty || JSON.stringify(form) !== JSON.stringify(base));
  const sessionKey = `shared-dtsi/${selected}/${draft?.revision ?? "new"}`;
  const path = useCallback((resourceId: string) => {
    const params = new URLSearchParams(search);
    if (resourceId) params.set("resource", resourceId); else params.delete("resource");
    return `/parameter-admin/sources${params.size ? `?${params}` : ""}`;
  }, [search]);
  const leave = (resourceId: string) => { flushSync(() => setLeaving(true)); onNavigate(path(resourceId)); };
  const navigate = async (resourceId: string) => { if (!pending && await requestSettingsLeave()) leave(resourceId); };

  useEffect(() => {
    let cancelled = false;
    setError(""); setConflict(false); setEditorDirty(false); setDraft(null); setLeaving(false);
    if (!client) { setLoading(false); return; }
    if (selected === "new") { setForm(empty); setLoading(false); return; }
    setLoading(true);
    void (selected ? client.get(selected).then(result => {
      if (!cancelled) { setDraft(result); setForm(draftInput(result)); }
    }) : client.list({ q: query, offset: (page - 1) * 20, limit: 20 }).then(result => {
      if (!cancelled) { setRows(result.items); setTotal(result.total); }
    })).catch(cause => { if (!cancelled) setError(message(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, selected, query, page, reload]);

  const save = async () => {
    if (!client || pending || !canWrite || !dirty || conflict) return;
    const input = { ...form, content: editor.current?.flush()?.text ?? form.content };
    setForm(input); setPending(true); setError(""); setSaved(null);
    try {
      const result = draft ? await client.save(draft.resourceId, { ...input, expectedRevision: draft.revision }) : await client.create(input);
      setDraft(result); setForm(draftInput(result)); setEditorDirty(false); setSaved(result.resourceId);
      if (selected === "new") leave(result.resourceId);
    } catch (cause) {
      setError(message(cause)); setConflict(cause instanceof WiseEffApiError && cause.code === "CONFLICT");
    } finally { setPending(false); }
  };
  const importFile = async (file?: File) => {
    if (!file || pending) return;
    try {
      if (!file.name.endsWith(".dtsi") || file.size > 2_097_152) { setError("请选择不超过 2 MiB 的 .dtsi 文件。"); return; }
      const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      setForm(current => ({ name: current.name || file.name.replace(/\.dtsi$/, ""), sourceName: file.name, content }));
      setEditorDirty(true); setSaved(null); setError(""); setReloadEditor(value => value + 1);
    } catch { setError("无法读取文件，请选择 UTF-8 编码的 DTSI 源码。"); }
  };
  const [reloadEditor, setReloadEditor] = useState(0);

  if (!client) return <section className="shared-dtsi-page"><h1>共享 DTSI</h1><p role="status">共享 DTSI 需要 API 模式和有效登录。</p></section>;
  if (!selected) return <div className="shared-dtsi-page"><AdminListPage label="共享 DTSI" headerContent={<h1>共享 DTSI</h1>}
    headerActions={canWrite ? <Button onClick={() => void navigate("new")}>导入资源</Button> : null}
    filterBar={<SearchField ariaLabel="搜索共享 DTSI" value={query} onValueChange={value => { setQuery(value); setPage(1); }} placeholder="搜索资源名称或路径" />}
    emptyState={{ title: query ? "没有匹配的资源" : "尚无共享 DTSI", message: query ? "请调整搜索条件。" : "导入公共源码后，可在这里管理草稿。" }}
    tableState={loading ? <SectionSkeleton label="正在加载共享 DTSI" /> : error ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : undefined}
    table={{ rows, rowKey: row => row.resourceId, pageSize: 20, page: 1, fluid: true,
      columns: [
        { key: "name", header: "资源名称", render: row => <Button variant="link" onClick={() => void navigate(row.resourceId)}>{row.name}</Button> },
        { key: "sourceName", header: "文件路径", render: row => <span title={row.sourceName}>{row.sourceName}</span> },
        { key: "state", header: "状态", render: () => "草稿" },
        { key: "updatedAt", header: "最后修改", render: row => formatAbsolute(row.updatedAt) }
      ] }} />
    {!loading && total > 20 ? <nav className="shared-dtsi-pagination" aria-label="共享 DTSI 分页"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span>{page} / {Math.ceil(total / 20)}</span><Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage(value => value + 1)}>下一页</Button></nav> : null}
  </div>;

  return <section className="shared-dtsi-page shared-dtsi-page--editor" aria-label="共享 DTSI 草稿" aria-busy={pending}>
    <header className="shared-dtsi-header"><div><Button variant="ghost" onClick={() => void navigate("")} disabled={pending}>返回资源列表</Button>
      <h1>{draft?.name ?? (selected === "new" ? "导入共享 DTSI" : "共享 DTSI")}</h1></div>
      <div className="shared-dtsi-actions">{draft && canWrite ? <Button variant="outline" disabled={pending || conflict} onClick={() => setDiscardOpen(true)}>丢弃草稿</Button> : null}
        {canWrite ? <Button disabled={loading || pending || !dirty || conflict || !form.name.trim() || !form.sourceName} onClick={() => void save()}>{pending ? "保存中…" : "保存草稿"}</Button> : null}</div>
    </header>
    {loading ? <SectionSkeleton label="正在加载共享 DTSI 草稿" /> : error && !draft && selected !== "new" ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : <>
      {error ? <div className="shared-dtsi-error" role="alert"><p>{error}</p>{conflict ? <Button variant="outline" onClick={() => setReloadOpen(true)}>重新载入</Button> : null}</div> : null}
      {saved === selected ? <p role="status">草稿已保存</p> : null}
      <div className="shared-dtsi-fields">
        <label>资源名称<Input aria-label="资源名称" value={form.name} maxLength={160} readOnly={!canWrite} disabled={pending} onChange={event => { setForm({ ...form, name: event.target.value }); setSaved(null); }} /></label>
        <label>文件路径<Input aria-label="文件路径" value={form.sourceName} maxLength={240} readOnly={!canWrite} disabled={pending} onChange={event => { setForm({ ...form, sourceName: event.target.value }); setSaved(null); }} /></label>
        {canWrite ? <><input ref={upload} type="file" accept=".dtsi" hidden onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
          <Button variant="outline" disabled={pending} onClick={() => upload.current?.click()}>选择 DTSI 文件</Button></> : null}
      </div>
      <div className="shared-dtsi-source"><WorkbenchDtsEditor ref={editor} sessionKey={sessionKey} text={form.content} baseText={base.content} resetKey={reloadEditor}
        ariaLabel="DTSI 源码" readOnly={!canWrite || pending} onDirtyChange={meta => { if (meta.sessionKey === sessionKey) { setEditorDirty(meta.dirty); if (meta.dirty) setSaved(null); } }}
        onChange={snapshot => { if (snapshot.sessionKey === sessionKey) setForm(current => ({ ...current, content: snapshot.text })); }} onSave={() => void save()} /></div>
    </>}
    <SettingsLeaveGuard dirty={dirty && !leaving} saving={pending} description="离开将放弃本页未保存的源码和名称，已保存的草稿不会受到影响。" />
    <ConfirmDialog open={reloadOpen} title="重新载入草稿？" description="本地未保存的修改将被当前服务端草稿替换。"
      confirmLabel="重新载入" cancelLabel="继续编辑" onCancel={() => setReloadOpen(false)}
      onConfirm={() => { setReloadOpen(false); setReload(value => value + 1); }} />
    <ConfirmDialog open={discardOpen} title="丢弃共享 DTSI 草稿？" description="这份未发布的资源及源码草稿将被移除。" confirmLabel="丢弃草稿" tone="danger" pending={pending} confirmDisabled={conflict} error={error}
      onCancel={() => { if (!pending) setDiscardOpen(false); }} onConfirm={() => { if (!client || !draft) return; setPending(true); setError("");
        void client.discard(draft.resourceId, draft.revision).then(() => { setDiscardOpen(false); setEditorDirty(false); leave(""); })
          .catch(cause => { setError(message(cause)); setConflict(cause instanceof WiseEffApiError && cause.code === "CONFLICT"); })
          .finally(() => setPending(false)); }} />
  </section>;
}

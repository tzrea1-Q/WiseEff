import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SharedDtsiDraft, SharedDtsiDraftInput, SharedDtsiResourceSummary, SharedDtsiResourceDetail,
  SharedDtsiVersion, SharedDtsiVersionSummary, SharedDtsiPublicationPreview } from "@wiseeff/dto-schemas";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { DataTable } from "@/components/admin/DataTable";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SearchField } from "@/components/common/SearchField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { WorkbenchDtsEditor, type WorkbenchDtsEditorHandle } from "@/components/project-configuration-workbench/WorkbenchDtsEditor";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { sharedDtsiImportLimits } from "@wiseeff/dto-schemas";
import "./shared-dtsi.css";

type Props = { apiClient?: ApiClient; canWrite: boolean; search: string; organizationId?: string; onNavigate: (path: string) => void };
type Scope = { key: string; client: ReturnType<typeof createSharedDtsiClient> | null; pending: boolean };
const empty: SharedDtsiDraftInput = { name: "", sourceName: "common.dtsi", content: "", changeDescription: "" };
const draftInput = (draft: SharedDtsiDraft): SharedDtsiDraftInput => ({ name: draft.name,
  sourceName: draft.members[0]!.sourceName, content: draft.members[0]!.content, changeDescription: draft.changeDescription,
  ...(draft.members.length>1?{members:draft.members}:{} ) });
const sourceMembers = (input:SharedDtsiDraftInput) => input.members ?? [{sourceName:input.sourceName,content:input.content}];
const withContent = (input:SharedDtsiDraftInput,index:number,content:string):SharedDtsiDraftInput => ({...input,content,
  ...(input.members?{members:input.members.map((member,at)=>at===index?{...member,content}:member)}:{})});
const comparable = (input:SharedDtsiDraftInput) => JSON.stringify({name:input.name,changeDescription:input.changeDescription,members:sourceMembers(input),archive:input.archive});
const message = (error: unknown) => error instanceof WiseEffApiError ? error.message : "请求失败，请重试。";

export function SharedDtsiPage({ apiClient, canWrite, search, organizationId, onNavigate }: Props) {
  const client = useMemo(() => apiClient ? createSharedDtsiClient(apiClient) : null, [apiClient]);
  const selected = new URLSearchParams(search).get("resource") ?? "";
  const selectedVersion = new URLSearchParams(search).get("version") ?? "";
  const tab = new URLSearchParams(search).get("tab") === "versions" ? "versions" : "source";
  const scopeKey = `${organizationId ?? ""}:${search}:${canWrite}`;
  const active = useRef<Scope>({ key: scopeKey, client, pending: false });
  if (active.current.key !== scopeKey || active.current.client !== client) active.current = { key: scopeKey, client, pending: false };
  const scope = active.current;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = useCallback((operation: Scope) => mounted.current && active.current === operation, []);
  const [loadedScope, setLoadedScope] = useState<Scope | null>(null);
  const [rows, setRows] = useState<SharedDtsiResourceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<SharedDtsiDraft | null>(null);
  const [detail, setDetail] = useState<SharedDtsiResourceDetail | null>(null);
  const [published, setPublished] = useState<SharedDtsiVersion | null>(null);
  const [versions, setVersions] = useState<SharedDtsiVersionSummary[]>([]);
  const [versionsTotal, setVersionsTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  useEffect(()=>setHistoryPage(1),[selected]);
  const [preview, setPreview] = useState<{ scope: Scope; data: SharedDtsiPublicationPreview; key: string } | null>(null);
  const [form, setForm] = useState(empty);
  const [memberIndex,setMemberIndex]=useState(0);
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
  const directoryUpload = useRef<HTMLInputElement>(null);
  const edits = useRef(0);
  const importSequence = useRef(0);
  const base = draft ? draftInput(draft) : empty;
  const dirty = Boolean(selected) && canWrite && !published && tab === "source" && (editorDirty || comparable(form) !== comparable(base));
  const busyLoading = loading || loadedScope !== scope;
  const currentPreview = preview?.scope === scope ? preview : null;
  const sessionKey = `shared-dtsi/${selected}/${draft?.revision ?? "new"}/${memberIndex}`;
  const path = useCallback((resourceId: string, options?: { version?: string; tab?: string }) => {
    const params = new URLSearchParams(search);
    if (resourceId !== selected) { params.delete("version"); params.delete("tab"); }
    if (resourceId) params.set("resource", resourceId); else params.delete("resource");
    if (options?.version !== undefined) { if (options.version) params.set("version", options.version); else params.delete("version"); }
    if (options?.tab !== undefined) { if (options.tab === "source") params.delete("tab"); else params.set("tab", options.tab); }
    return `/parameter-admin/sources${params.size ? `?${params}` : ""}`;
  }, [search, selected]);
  const leave = (resourceId: string, options?: { version?: string; tab?: string }) => { flushSync(() => setLeaving(true)); onNavigate(path(resourceId, options)); };
  const navigate = async (resourceId: string, options?: { version?: string; tab?: string }) => { if (!scope.pending && await requestSettingsLeave() && isCurrent(scope)) leave(resourceId, options); };

  useEffect(() => {
    let cancelled = false;
    setError(""); setConflict(false); setEditorDirty(false); setDraft(null); setPublished(null); setDetail(null); setPreview(null); setLeaving(false); setPending(false); setMemberIndex(0);
    if (!client) { setLoading(false); setLoadedScope(scope); return; }
    if (selected === "new") { setForm(empty); setLoading(false); setLoadedScope(scope); return; }
    setLoading(true);
    void (selected ? client.detail(selected).then(async metadata => {
      if (cancelled || !isCurrent(scope)) return;
      setDetail(metadata);
      if (tab === "versions") {
        const result = await client.versions(selected,(historyPage-1)*20);
        if (!cancelled && isCurrent(scope)) {setVersions(result.items);setVersionsTotal(result.total);}
      } else if (metadata.draftRevision && (selectedVersion === "draft" || !metadata.currentVersion)) {
        const result = await client.get(selected);
        if (!cancelled && isCurrent(scope)) { setDraft(result); setForm(draftInput(result)); }
      } else if (metadata.currentVersion) {
        const result = await client.version(selected, selectedVersion && selectedVersion !== "draft" ? selectedVersion : metadata.currentVersion.id);
        if (!cancelled && isCurrent(scope)) setPublished(result);
      } else throw new Error("资源没有可读取的源码。");
    }) : client.list({ q: query, offset: (page - 1) * 20, limit: 20 }).then(result => {
      if (!cancelled && isCurrent(scope)) { setRows(result.items); setTotal(result.total); }
    })).catch(cause => { if (!cancelled && isCurrent(scope)) setError(message(cause)); })
      .finally(() => { if (!cancelled && isCurrent(scope)) { setLoading(false); setLoadedScope(scope); } });
    return () => { cancelled = true; };
  }, [client, selected, selectedVersion, tab, query, page, historyPage, reload, scope, isCurrent]);

  const persist = async (operation: Scope) => {
    if (!client) throw new Error("API 不可用。");
    const input = withContent(form,memberIndex,editor.current?.flush()?.text ?? form.content);
    setForm(input);
    const result = draft ? await client.save(draft.resourceId, { ...input, expectedRevision: draft.revision }) : await client.create(input);
    if (isCurrent(operation)) { setDraft(result); setForm(draftInput(result)); setMemberIndex(0); setEditorDirty(false); setSaved(result.resourceId); }
    return result;
  };
  const save = async () => {
    if (!client || scope.pending || busyLoading || !canWrite || !dirty || conflict || published || (!draft && selected!=="new")) return;
    scope.pending = true; setPending(true); setError(""); setSaved(null); setPreview(null);
    try {
      const result = await persist(scope);
      if (isCurrent(scope) && selected === "new") leave(result.resourceId);
    } catch (cause) {
      if (isCurrent(scope)) { setError(message(cause)); setConflict(cause instanceof WiseEffApiError && cause.code === "CONFLICT"); }
    } finally { scope.pending = false; if (isCurrent(scope)) setPending(false); }
  };
  const preparePublication = async () => {
    if (!client || !draft || scope.pending || busyLoading || !canWrite || conflict || !form.changeDescription.trim()) return;
    scope.pending = true; setPending(true); setError(""); setPreview(null);
    try {
      const current = dirty ? await persist(scope) : draft;
      if (!isCurrent(scope)) return;
      const result = await client.preview(current.resourceId, current.revision);
      if (isCurrent(scope)) setPreview({ scope, data: result, key: crypto.randomUUID() });
    } catch (cause) {
      if (isCurrent(scope)) { setError(message(cause)); setConflict(cause instanceof WiseEffApiError && cause.code === "CONFLICT"); }
    } finally { scope.pending = false; if (isCurrent(scope)) setPending(false); }
  };
  const publish = async () => {
    if (!client || !currentPreview || !canWrite || scope.pending || busyLoading) return;
    scope.pending = true; setPending(true); setError("");
    try {
      const result = await client.publish(selected, currentPreview.data.id, currentPreview.key);
      if (isCurrent(scope)) { setPreview(null); leave(selected, { version: result.id, tab: "source" }); }
    } catch (cause) {
      if (isCurrent(scope)) {
        setError(message(cause));
        if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") { setPreview(null); setConflict(true); }
      }
    } finally { scope.pending = false; if (isCurrent(scope)) setPending(false); }
  };
  const createVersionDraft = async () => {
    if (!client || !detail?.currentVersion || !canWrite || scope.pending || busyLoading) return;
    scope.pending = true; setPending(true); setError("");
    try {
      await client.newVersionDraft(selected, detail.currentVersion.id);
      if (isCurrent(scope)) {setReload(value=>value+1);leave(selected, { version: "draft", tab: "source" });}
    } catch (cause) { if (isCurrent(scope)) setError(message(cause)); }
    finally { scope.pending = false; if (isCurrent(scope)) setPending(false); }
  };
  const importFiles = async (selectedFiles?: FileList | null) => {
    const files=Array.from(selectedFiles??[]);
    if (!files.length || scope.pending || published || busyLoading || !canWrite) return;
    const request = ++importSequence.current, edit = edits.current;
    try {
      const file=files[0]!;
      const isArchive=files.length===1 && file.name.endsWith(".zip");
      if (files.length>sharedDtsiImportLimits.maxFiles || files.reduce((size,value)=>size+value.size,0)>sharedDtsiImportLimits.maxTotalBytes
        || files.some(value=>value.size>(isArchive?sharedDtsiImportLimits.maxArchiveBytes:sharedDtsiImportLimits.maxFileBytes))) {
        setError("最多 128 个文件，单文件 2 MiB、源码共 16 MiB；ZIP 最大 8 MiB。");return;
      }
      const members=isArchive?undefined:await Promise.all(files.map(async value=>({sourceName:value.webkitRelativePath||value.name,
        content:new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await value.arrayBuffer())})));
      let archive:SharedDtsiDraftInput["archive"];
      if(isArchive) {
        const bytes=new Uint8Array(await file.arrayBuffer());let binary="";
        for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
        archive={name:file.name,contentBase64:btoa(binary)};
      }
      if (!isCurrent(scope) || request !== importSequence.current || edit !== edits.current || scope.pending) return;
      edits.current += 1;
      setForm(current => ({ ...current, name: current.name || file.name.replace(/\.(dtsi|zip)$/, ""),
        sourceName:members?.[0]?.sourceName??"common.dtsi",content:members?.[0]?.content??"",archive,
        members:members?.map(member=>({...member,...(current.members?.find(old=>old.sourceName===member.sourceName)?.id?{id:current.members.find(old=>old.sourceName===member.sourceName)!.id}:{})})) }));
      setMemberIndex(0);
      setEditorDirty(true); setSaved(null); setError(""); setReloadEditor(value => value + 1);
    } catch { if (isCurrent(scope) && request === importSequence.current && edit === edits.current && !scope.pending) setError("无法读取文件，请选择 UTF-8 编码的源码或 ZIP 归档。"); }
  };
  const [reloadEditor, setReloadEditor] = useState(0);
  const selectMember=(index:number)=>{
    if(scope.pending)return;
    const current=withContent(form,memberIndex,editor.current?.flush()?.text??form.content),member=sourceMembers(current)[index]!;
    setForm({...current,sourceName:member.sourceName,content:member.content});setMemberIndex(index);setEditorDirty(false);setReloadEditor(value=>value+1);
  };
  const memberNavigation=(members:{sourceName:string}[],select:(index:number)=>void)=>members.length>1?<nav aria-label="资源文件" className="shared-dtsi-members"><ul>
    {members.map((member,index)=><li key={index}><Button variant={index===memberIndex?"secondary":"ghost"} aria-current={index===memberIndex?"true":undefined}
      disabled={pending} onClick={()=>select(index)}>{member.sourceName}</Button></li>)}</ul></nav>:null;

  if (!client) return <section className="shared-dtsi-page"><h1>共享 DTSI</h1><p role="status">共享 DTSI 需要 API 模式和有效登录。</p></section>;
  if (!selected) return <div className="shared-dtsi-page"><AdminListPage label="共享 DTSI" headerContent={<h1>共享 DTSI</h1>}
    headerActions={canWrite ? <Button onClick={() => void navigate("new")}>导入资源</Button> : null}
    filterBar={<SearchField ariaLabel="搜索共享 DTSI" value={query} onValueChange={value => { setQuery(value); setPage(1); }} placeholder="搜索资源名称或路径" />}
    emptyState={{ title: query ? "没有匹配的资源" : "尚无共享 DTSI", message: query ? "请调整搜索条件。" : "导入公共源码后，可在这里保存草稿并发布共享版本。" }}
    tableState={busyLoading ? <SectionSkeleton label="正在加载共享 DTSI" /> : error ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : undefined}
    table={{ rows, rowKey: row => row.resourceId, pageSize: 20, page: 1, fluid: true,
      columns: [
        { key: "name", header: "资源名称", render: row => <Button variant="link" onClick={() => void navigate(row.resourceId)}>{row.name}</Button> },
        { key: "sourceName", header: "文件路径", render: row => <span title={row.sourceName}>{row.sourceName}</span> },
        { key: "state", header: "当前版本", render: row => row.currentVersion ? `v${row.currentVersion.version}${row.draftRevision ? " · 有草稿" : ""}` : "草稿" },
        { key: "updatedAt", header: "最后修改", render: row => formatAbsolute(row.updatedAt) }
      ] }} />
    {!loading && total > 20 ? <nav className="shared-dtsi-pagination" aria-label="共享 DTSI 分页"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span>{page} / {Math.ceil(total / 20)}</span><Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage(value => value + 1)}>下一页</Button></nav> : null}
  </div>;

  if (busyLoading) return <section className="shared-dtsi-page"><SectionSkeleton label="正在加载共享 DTSI" /></section>;

  if (currentPreview) return <section className="shared-dtsi-page shared-dtsi-page--editor" aria-label="共享 DTSI 发布预览" aria-busy={pending}>
    <header className="shared-dtsi-header"><div><Button variant="ghost" disabled={pending} onClick={() => setPreview(null)}>返回编辑</Button>
      <h1>发布 {currentPreview.data.name}</h1></div><Button disabled={pending} onClick={() => void publish()}>{pending ? "正在发布…" : "发布版本"}</Button></header>
    {error ? <p role="alert" className="shared-dtsi-error">{error}</p> : null}
    <p>发布共享版本，不会自动更新项目配置。</p>
    <dl className="shared-dtsi-metadata"><div><dt>文件</dt><dd>{currentPreview.data.manifest.members.length} 个 · 共享源码库</dd></div>
      <div><dt>变更说明</dt><dd>{currentPreview.data.changeDescription}</dd></div>
      {currentPreview.data.manifest.externalReferences.length ? <div><dt>项目需提供的引用</dt><dd>{currentPreview.data.manifest.externalReferences.join("、")}</dd></div> : null}</dl>
    <div className="shared-dtsi-workspace">{memberNavigation(sourceMembers(form),selectMember)}
      <div className="shared-dtsi-source"><WorkbenchDtsEditor sessionKey={`shared-dtsi-preview/${currentPreview.data.id}/${memberIndex}`} text={form.content}
      readOnly ariaLabel="待发布 DTSI 源码" /></div></div>
  </section>;

  if (published || tab === "versions") return <section className="shared-dtsi-page shared-dtsi-page--editor" aria-label="共享 DTSI 版本" aria-busy={pending}>
    <header className="shared-dtsi-header"><div><Button variant="ghost" onClick={() => void navigate("")} disabled={pending}>返回资源列表</Button>
      <h1>{published?.name ?? detail?.name ?? "共享 DTSI"}</h1></div>
      {canWrite && detail?.currentVersion ? <Button disabled={pending} onClick={() => detail.draftRevision ? void navigate(selected,{version:"draft",tab:"source"})
        : published && published.id!==detail.currentVersion!.id ? void navigate(selected,{version:detail.currentVersion!.id,tab:"source"}) : void createVersionDraft()}>
        {detail.draftRevision ? "继续编辑草稿" : published && published.id!==detail.currentVersion.id ? "查看最新版本" : "创建新版本"}</Button> : null}</header>
    {error ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : null}
    <ViewSwitch variant="tabs" ariaLabel="共享资源详情" value={tab} onValueChange={value => void navigate(selected,{tab:value})}
      items={[{value:"source",label:"源码",id:"shared-source-tab",panelId:"shared-source-panel"},
        {value:"versions",label:"版本",id:"shared-versions-tab",panelId:"shared-versions-panel"}]} />
    <TabPanel id="shared-source-panel" aria-labelledby="shared-source-tab" hidden={tab!=="source"} className="shared-dtsi-published-panel">
      {tab==="source" && published ? <><p role="status">v{published.version} · {published.id===detail?.currentVersion?.id?"已发布":"历史版本"}，只读</p>
        <dl className="shared-dtsi-metadata"><div><dt>文件路径</dt><dd>{published.members[memberIndex]?.sourceName}</dd></div>
          <div><dt>发布时间</dt><dd>{formatAbsolute(published.createdAt)}</dd></div>
          <div><dt>变更说明</dt><dd>{published.changeDescription}</dd></div></dl>
        <div className="shared-dtsi-workspace">{memberNavigation(published.members,setMemberIndex)}
          <div className="shared-dtsi-source"><WorkbenchDtsEditor sessionKey={`shared-dtsi-version/${published.id}/${memberIndex}`} text={published.members[memberIndex]?.content ?? ""}
          readOnly ariaLabel="已发布 DTSI 源码" /></div></div></> : null}
    </TabPanel>
    <TabPanel id="shared-versions-panel" aria-labelledby="shared-versions-tab" hidden={tab!=="versions"}>
      {tab==="versions" ? <DataTable rows={versions} rowKey={row=>row.id} fluid pageSize={20} columns={[
        {key:"version",header:"版本",render:row=><Button variant="link" onClick={()=>void navigate(selected,{version:row.id,tab:"source"})}>v{row.version}</Button>},
        {key:"createdAt",header:"发布时间",render:row=>formatAbsolute(row.createdAt)},
        {key:"changeDescription",header:"变更说明",render:row=><span className="shared-dtsi-description">{row.changeDescription}</span>}
      ]} emptyState={<SectionEmpty title="尚无已发布版本" message="发布草稿后，可在这里追溯版本。" />} /> : null}
      {tab==="versions" && versionsTotal>20 ? <nav className="shared-dtsi-pagination" aria-label="共享版本分页">
        <Button variant="outline" disabled={historyPage===1} onClick={()=>setHistoryPage(value=>value-1)}>上一页</Button>
        <span>{historyPage} / {Math.ceil(versionsTotal/20)}</span><Button variant="outline" disabled={historyPage*20>=versionsTotal} onClick={()=>setHistoryPage(value=>value+1)}>下一页</Button></nav> : null}
    </TabPanel>
  </section>;

  return <section className="shared-dtsi-page shared-dtsi-page--editor" aria-label="共享 DTSI 草稿" aria-busy={pending}>
    <header className="shared-dtsi-header"><div><Button variant="ghost" onClick={() => void navigate("")} disabled={pending}>返回资源列表</Button>
      {detail?.currentVersion ? <Button variant="ghost" disabled={pending} onClick={()=>void navigate(selected,{version:detail.currentVersion!.id,tab:"source"})}>查看已发布版本</Button> : null}
      <h1>{draft?.name ?? (selected === "new" ? "导入共享 DTSI" : "共享 DTSI")}{draft ? <span className="shared-dtsi-draft-label">草稿</span> : null}</h1></div>
      <div className="shared-dtsi-actions">{draft && canWrite ? <Button variant="outline" disabled={pending || conflict} onClick={() => setDiscardOpen(true)}>丢弃草稿</Button> : null}
        {canWrite && (draft || selected==="new") ? <Button variant={draft?"outline":"default"} disabled={pending || !dirty || conflict || !form.name.trim() || !form.sourceName} onClick={() => void save()}>{pending ? "保存中…" : "保存草稿"}</Button> : null}
        {draft && canWrite ? <Button aria-describedby={!form.changeDescription.trim()?"shared-publication-hint":undefined} disabled={pending || conflict || !form.changeDescription.trim()} onClick={()=>void preparePublication()}>预览发布</Button> : null}</div>
    </header>
    {loading ? <SectionSkeleton label="正在加载共享 DTSI 草稿" /> : error && !draft && selected !== "new" ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : <>
      {error ? <div className="shared-dtsi-error" role="alert"><p>{error}</p>{conflict ? <Button variant="outline" onClick={() => setReloadOpen(true)}>重新载入</Button> : null}</div> : null}
      {saved === selected ? <p role="status">草稿已保存</p> : null}
      <div className="shared-dtsi-fields">
        <label>资源名称<Input aria-label="资源名称" value={form.name} maxLength={160} readOnly={!canWrite} disabled={pending} onChange={event => { edits.current+=1; setForm({ ...form, name: event.target.value }); setSaved(null); }} /></label>
        {!form.archive?<label>文件路径<Input aria-label="文件路径" value={form.sourceName} maxLength={240} readOnly={!canWrite} disabled={pending} onChange={event => { edits.current+=1;
          setForm({ ...form, sourceName: event.target.value,...(form.members?{members:form.members.map((member,index)=>index===memberIndex?{...member,sourceName:event.target.value}:member)}:{}) }); setSaved(null); }} /></label>:null}
        {canWrite ? <><input ref={upload} type="file" accept=".dtsi,.h,.hpp,.zip" multiple hidden onChange={event => { void importFiles(event.target.files); event.target.value = ""; }} />
          <input ref={directoryUpload} type="file" multiple hidden {...{webkitdirectory:""}} onChange={event=>{void importFiles(event.target.files);event.target.value="";}} />
          <Button variant="outline" disabled={pending} onClick={() => upload.current?.click()}>选择源码或 ZIP</Button>
          <Button variant="outline" disabled={pending} onClick={() => directoryUpload.current?.click()}>选择目录</Button></> : null}
      </div>
      <label className="shared-dtsi-change-description">变更说明<Textarea aria-label="变更说明" value={form.changeDescription} maxLength={1000} rows={2}
        placeholder="说明此共享版本的变更" readOnly={!canWrite} disabled={pending} onChange={event=>{edits.current+=1;setForm({...form,changeDescription:event.target.value});setSaved(null);}} /></label>
      {draft && canWrite && !form.changeDescription.trim() ? <p id="shared-publication-hint" className="shared-dtsi-hint">发布前请填写变更说明。</p> : null}
      {form.archive?<p role="status">{form.archive.name} · 保存草稿后展开文件并检查路径。</p>:<div className="shared-dtsi-workspace">{memberNavigation(sourceMembers(form),selectMember)}
      <div className="shared-dtsi-source"><WorkbenchDtsEditor ref={editor} sessionKey={sessionKey} text={form.content} baseText={draft?.members[memberIndex]?.content??""} resetKey={reloadEditor}
        ariaLabel="DTSI 源码" readOnly={!canWrite || pending} onDirtyChange={meta => { if (meta.sessionKey === sessionKey && isCurrent(scope)) { if(meta.generation>0) edits.current+=1; setEditorDirty(meta.dirty); if (meta.dirty) setSaved(null); } }}
        onChange={snapshot => { if (snapshot.sessionKey === sessionKey && isCurrent(scope)) setForm(current => withContent(current,memberIndex,snapshot.text)); }} onSave={() => void save()} /></div></div>}
    </>}
    <SettingsLeaveGuard dirty={dirty && !leaving} saving={pending} description="离开将放弃本页未保存的源码和名称，已保存的草稿不会受到影响。" />
    <ConfirmDialog open={reloadOpen} title="重新载入草稿？" description="本地未保存的修改将被当前服务端草稿替换。"
      confirmLabel="重新载入" cancelLabel="继续编辑" onCancel={() => setReloadOpen(false)}
      onConfirm={() => { setReloadOpen(false); setReload(value => value + 1); }} />
    <ConfirmDialog open={discardOpen} title="丢弃共享 DTSI 草稿？" description={detail?.currentVersion?"仅丢弃尚未发布的修改，已发布版本和历史会保留。":"这份未发布的资源及源码草稿将被移除。"} confirmLabel="丢弃草稿" tone="danger" pending={pending} confirmDisabled={conflict} error={error}
      onCancel={() => { if (!pending) setDiscardOpen(false); }} onConfirm={() => { if (!client || !draft || scope.pending) return; scope.pending=true; setPending(true); setError("");
        void client.discard(draft.resourceId, draft.revision).then(() => { if(!isCurrent(scope))return; setDiscardOpen(false); setEditorDirty(false);
          if(detail?.currentVersion)leave(selected,{version:detail.currentVersion.id,tab:"source"});else leave(""); })
          .catch(cause => { if(isCurrent(scope)){setError(message(cause));setConflict(cause instanceof WiseEffApiError && cause.code === "CONFLICT");} })
          .finally(() => {scope.pending=false;if(isCurrent(scope))setPending(false);}); }} />
  </section>;
}

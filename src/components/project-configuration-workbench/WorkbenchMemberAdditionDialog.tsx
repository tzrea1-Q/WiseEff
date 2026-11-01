import { useEffect, useMemo, useRef, useState } from "react";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { createDefaultApiClient } from "@/infrastructure/http/defaultApiClient";
import type { SharedDtsiResourceSummary, SharedDtsiVersionSummary } from "@wiseeff/dto-schemas";
import { sharedSwitchConflictSchema, type SharedSwitchConflict } from "@wiseeff/dto-schemas";
import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { JsonRegistrationSelection } from "@/application/project-configuration/jsonRegistration";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkbenchJsonRegistrationFields } from "./WorkbenchJsonRegistrationFields";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { createCanonicalMemberAdditionClient, type MemberAdditionBody, type MemberAdditionPreview } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import "./workbench-member-addition-dialog.css";

const roleLabels = { base: "基础", overlay: "覆盖层", charging: "充电", thermal: "温控", misc: "其他 / include" };
export function WorkbenchMemberAdditionDialog({ projectId, configSets, initialConfigSetId, availableFiles, switchReference, removeReference, conversionSource, switchDraft, projectRoot, onSwitchDraftChange, onRecoverSwitch, client: suppliedClient, sharedClient: suppliedSharedClient, catalogRepository, fileRepository, onDismiss, onApplied, sharedOnly=false, existingReferences=[], targetProjectName, onUncertainDismiss, refreshExistingReferences }: {
  projectId: string; configSets: Array<{ id: string; name: string }>; initialConfigSetId: string;
  availableFiles: ProjectParameterFile[]; client?: ReturnType<typeof createCanonicalMemberAdditionClient>;
  switchReference?: {resourceId:string;versionId:string;version:number};
  conversionSource?:{configRevisionId:string;fileId:string;fileVersionId:string;sourceName:string};
  removeReference?: {resourceId:string;versionId:string;version:number};
  switchDraft?: {versionId:string;reason:string};
  projectRoot?:{fileId:string;sourceName:string};
  onSwitchDraftChange?: (draft:{versionId:string;reason:string})=>void;
  onRecoverSwitch?: (source:SharedSwitchConflict,draft:{versionId:string;reason:string})=>void;
  sharedClient?: Pick<ReturnType<typeof createSharedDtsiClient>, "list" | "versions">;
  catalogRepository?: Pick<ParameterCatalogRepository, "listSubjects" | "listSubjectDefinitions">;
  fileRepository?: Pick<ParameterFileRepository, "downloadVersion">;
  onDismiss: () => void; onApplied: (configSetId: string, fileId: string) => void;
  sharedOnly?: boolean; existingReferences?: Array<{resourceId:string;direct:boolean;requiredBy:Array<{resourceName:string}>}>;
  targetProjectName?: string;
  onUncertainDismiss?: () => void;
  refreshExistingReferences?: () => Promise<Array<{resourceId:string}>>;
}) {
  const reference=removeReference??switchReference;
  const client = useMemo(() => suppliedClient ?? createCanonicalMemberAdditionClient(), [suppliedClient]);
  const sharedClient = useMemo(() => suppliedSharedClient ?? createSharedDtsiClient(createDefaultApiClient()), [suppliedSharedClient]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selectionRef=useRef<HTMLDetailsElement>(null);
  const [configSetId, setConfigSetId] = useState(initialConfigSetId), [source, setSource] = useState(reference||conversionSource||sharedOnly?"shared":"upload");
  const [file, setFile] = useState<File | null>(null), [fileId, setFileId] = useState(availableFiles[0]?.id ?? "");
  const [candidate, setCandidate] = useState<{ id: string; fileName: string; format: "dts" | "json" } | null>(null);
  const [role, setRole] = useState<MemberAdditionBody["role"]>("misc"), [sortOrder, setSortOrder] = useState("0");
  const [registration, setRegistration] = useState<JsonRegistrationSelection>({ configurationSchemaId: "", mappings: [] });
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [preview, setPreview] = useState<MemberAdditionPreview | null>(null), [preparedBody, setPreparedBody] = useState<MemberAdditionBody | null>(null);
  const [reason, setReason] = useState(switchDraft?.reason??""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [switchConflicts,setSwitchConflicts]=useState<SharedSwitchConflict[]>([]);
  const [compositionError,setCompositionError]=useState<"dependency"|"stale"|null>(null);
  const [errorDiagnostics, setErrorDiagnostics] = useState<string[]>([]);
  const mutationId = useRef<string | null>(null);
  const mutationReason = useRef<string | null>(null);
  const [uncertain,setUncertain]=useState(false);
  const [refreshRequired,setRefreshRequired]=useState(false),[refreshingReferences,setRefreshingReferences]=useState(false);
  const [refreshError,setRefreshError]=useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [resources, setResources] = useState<SharedDtsiResourceSummary[]>([]), [versions, setVersions] = useState<SharedDtsiVersionSummary[]>([]);
  const [resourceId, setResourceId] = useState(reference?.resourceId??""), [versionId, setVersionId] = useState(switchDraft?.versionId??"");
  useEffect(()=>{if(reference)onSwitchDraftChange?.({versionId,reason});},[versionId,reason,reference,onSwitchDraftChange]);
  const [mountPath,setMountPath]=useState("");
  const [query, setQuery] = useState(""), [resourceOffset, setResourceOffset] = useState(0), [versionOffset, setVersionOffset] = useState(0);
  const [resourceTotal, setResourceTotal] = useState(0), [versionTotal, setVersionTotal] = useState(0);
  const [sharedLoading, setSharedLoading] = useState(false), [sharedError, setSharedError] = useState(""), [sharedRetry, setSharedRetry] = useState(0);
  useEffect(() => {
    if (source !== "shared"||removeReference) return;
    let active = true;
    setSharedLoading(true); setSharedError("");
    void (resourceId ? sharedClient.versions(resourceId, versionOffset).then(result => {
      if (active) { setVersions(result.items); setVersionTotal(result.total); }
    }) : sharedClient.list({ q: query, offset: resourceOffset, limit: 20, ...(sharedOnly?{eligible:"1" as const}:{}) }).then(result => {
      if (active) { setResources(result.items); setResourceTotal(result.total); }
    })).catch(failure => { if (active) setSharedError(presentError(failure, "无法读取共享资源，请重试。")); })
      .finally(() => { if (active) setSharedLoading(false); });
    return () => { active = false; };
  }, [source, sharedClient, resourceId, query, resourceOffset, versionOffset, sharedRetry,removeReference]);
  const format = source === "existing" ? availableFiles.find((item) => item.id === fileId)?.format : candidate?.format ?? (file?.name.toLowerCase().endsWith(".json") ? "json" : "dts");
  const invalidate = () => { setPreview(null); setPreparedBody(null); setError(""); setRefreshError(""); setErrorDiagnostics([]); setSwitchConflicts([]);setCompositionError(null); mutationId.current = null; mutationReason.current=null;setUncertain(false); };
  function showError(failure: unknown, fallback: string) {
    setError(presentError(failure, fallback));
    const cause=failure instanceof WiseEffApiError?failure.details.reason:null;
    setCompositionError(cause==="shared-removal-dependency"?"dependency":removeReference&&cause==="configuration-addition-stale"?"stale":null);
    const diagnostics = failure instanceof WiseEffApiError ? failure.details.diagnostics : null;
    const conflicts=sharedSwitchConflictSchema.array().safeParse(failure instanceof WiseEffApiError?failure.details.switchConflicts:null);
    setSwitchConflicts(conflicts.success?conflicts.data:[]);
    setErrorDiagnostics(Array.isArray(diagnostics) ? diagnostics.flatMap((item: unknown) =>
      item && typeof item === "object" && "message" in item && typeof item.message === "string" ? [item.message] : []) : []);
  }
  async function refreshReferences() {
    if(!refreshExistingReferences)return;
    setRefreshingReferences(true);setRefreshError("");
    try {
      const references=await refreshExistingReferences();
      if(mounted.current){
        if(references.some(ref=>ref.resourceId===resourceId)){setResourceId("");setVersionId("");setVersions([]);setError("配置已更新，请重新选择资源。");}
        setRefreshRequired(false);
      }
    } catch(failure) {
      if(mounted.current)setRefreshError(presentError(failure,"无法重新核对目标配置，请重试。"));
    } finally {if(mounted.current)setRefreshingReferences(false);}
  }
  async function prepare() {
    invalidate(); setBusy(true);
    try {
      let uploaded = candidate;
      if (source === "upload" && !uploaded) {
        if (!file) throw new Error("请选择要上传的 DTS/JSON 文件。");
        if (file.size > 2 * 1024 * 1024) throw new Error("来源文件不能超过 2 MB。");
        uploaded = await client.upload(projectId, file); if (!mounted.current) return; setCandidate(uploaded);
      }
      const registerJson = format === "json" && Boolean(registration.configurationSchemaId);
      const jsonMappings = !registerJson ? undefined : registration.fallbackMappings === undefined ? registration.mappings.map((row) => {
        if (!row.definitionId || row.pointer === null) throw new Error("请为每行选择参数定义和 JSON 字段。");
        return { definitionId: row.definitionId, pointer: row.pointer };
      }) : registration.fallbackMappings.split("\n").filter((line) => line.trim()).map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) throw new Error("每行字段映射应为 参数定义 ID = JSON Pointer。");
        return { definitionId: line.slice(0, separator).trim(), pointer: line.slice(separator + 1).trim() };
      });
      if (registerJson && !jsonMappings?.length) throw new Error("请至少添加一项字段映射。");
      const body: MemberAdditionBody = { ...(removeReference?{removeSharedReference:{resourceId:removeReference.resourceId,versionId:removeReference.versionId}}:source === "shared" ? { sharedReference: { resourceId, versionId,...(switchReference?{replaceVersionId:switchReference.versionId}:mountPath?{mountPath}:{}),
        ...(conversionSource?{convertPrivate:{fileId:conversionSource.fileId,fileVersionId:conversionSource.fileVersionId,configRevisionId:conversionSource.configRevisionId}}:{}) } }
        : source === "upload" ? { candidateId: uploaded!.id } : { fileId }), role: source === "shared" ? "misc" : role,
        sortOrder: Number(sortOrder), ...(registerJson ? { json: { configurationSchemaId: registration.configurationSchemaId, rootPointer: "", mappings: jsonMappings! } } : {}) };
      const result = await client.preview(projectId, configSetId, body);
      if (!mounted.current) return;
      setPreparedBody(body); setPreview(result); mutationId.current = crypto.randomUUID();
    } catch (failure) { if (mounted.current) {
      showError(failure, "无法预览文件组成，请检查文件后重试。");
      if(sharedOnly && refreshExistingReferences && failure instanceof WiseEffApiError && failure.code==="CONFLICT") {setRefreshRequired(true);await refreshReferences();}
    } } finally { if (mounted.current) setBusy(false); }
  }
  async function apply() {
    if (busy || !preview || !preparedBody || !mutationId.current || !reason.trim()) return;
    setBusy(true); setError(""); setErrorDiagnostics([]);
    mutationReason.current??=reason.trim();
    try {
      const result = await client.apply(projectId, configSetId, { ...preparedBody, proofToken: preview.proofToken, reason: mutationReason.current, clientMutationId: mutationId.current });
      if (mounted.current) onApplied(configSetId, result.fileId);
    } catch (failure) { if (mounted.current) {
      if(sharedOnly && (uncertain || !(failure instanceof WiseEffApiError && failure.status!==undefined && failure.status<500))){
        setUncertain(true);setError(uncertain && failure instanceof WiseEffApiError && failure.status!==undefined && failure.status<500
          ? "应用结果尚未确认，本次重试被拒绝。请返回列表核对项目配置，或稍后重试同一操作。"
          : "应用结果尚未确认。请重试同一操作，或返回列表核对项目配置。");
      }else{setPreview(null);setPreparedBody(null);mutationReason.current=null;showError(failure, "未能确认结果，请重新预览；选择与原因已保留。");
        if(sharedOnly && refreshExistingReferences && failure instanceof WiseEffApiError && failure.code==="CONFLICT") {setRefreshRequired(true);await refreshReferences();}}
    } } finally { if (mounted.current) setBusy(false); }
  }
  const dismiss=()=>{if(uncertain && onUncertainDismiss)onUncertainDismiss();else onDismiss();};
  return <ModalDialog open onDismiss={busy ? undefined : dismiss} initialFocusRef={closeRef} describedBy
    className="workbench-member-addition-dialog" backdropClassName="param-admin-modal-backdrop">
    {({ titleId, descriptionId }) => <>
      <header><div><h2 id={titleId}>{removeReference?"移除共享引用":conversionSource?"转换为共享引用":switchReference?"切换共享版本":sharedOnly?"添加资源包":"加入配置文件"}</h2><p id={descriptionId}>{sharedOnly?`${targetProjectName??projectId} · ${configSets.find(set=>set.id===configSetId)?.name==="default"?"默认配置":configSets.find(set=>set.id===configSetId)?.name}：选择已发布资源和固定版本。`:removeReference?"预览此项目的文件、节点、覆盖及参数来源变化；确认后创建新配置修订，历史来源保留。":conversionSource?"选择已发布版本。完整来源和生效配置一致后，确认转换所选私有源码及依赖。":switchReference?"选择新版本或旧版本，保留当前项目覆盖；确认后创建新配置修订。":source === "shared"
        ? "选择共享资源及固定版本，预览配置变化后确认引用。"
        : source === "upload" ? "上传仅保存候选；预览并确认后，文件组成及参数状态一起生效。" : "选择项目文件，预览配置变化后确认加入。"}</p></div>
        <Button ref={closeRef} type="button" variant="outline" disabled={busy} onClick={dismiss}>{uncertain?"返回列表核对":"关闭"}</Button></header>
      <div className="workbench-member-addition-dialog__body" aria-busy={busy}>
        <details ref={selectionRef} open={!preview} className="workbench-member-addition-dialog__selection"><summary>文件与目标配置</summary>
        <form onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
          <fieldset disabled={busy||uncertain||refreshingReferences} aria-label="文件与目标配置">
            <label>目标配置<SelectControl ariaLabel="目标配置" value={configSetId} disabled={busy||sharedOnly||Boolean(reference||conversionSource)}
              onValueChange={(value) => { setConfigSetId(value); invalidate(); }}
              options={configSets.map((set) => ({ value: set.id, label: set.name === "default" ? "默认配置" : set.name }))} /></label>
            {!reference&&!conversionSource&&!sharedOnly?<label>文件来源<SelectControl ariaLabel="文件来源" value={source} disabled={busy}
              onValueChange={(value) => { setSource(value); setRegistration({ configurationSchemaId: "", mappings: [] }); invalidate(); }}
              options={[{ value: "upload", label: "上传新文件" }, { value: "existing", label: "选择已有项目文件", disabled: !availableFiles.length }, { value: "shared", label: "引用共享 DTSI 固定版本" }]} /></label>:null}
            {source === "upload" ? <label>上传文件<Input aria-label="上传文件" type="file" accept=".dts,.dtsi,.dtso,.json"
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setCandidate(null); setRegistration({ configurationSchemaId: "", mappings: [] }); invalidate(); }} /></label>
              : source === "existing" ? <label>待加入文件<SelectControl ariaLabel="待加入文件" value={fileId} disabled={busy}
                onValueChange={(value) => { setFileId(value); setRegistration({ configurationSchemaId: "", mappings: [] }); invalidate(); }} options={availableFiles.map((item) => ({ value: item.id, label: item.fileName }))} /></label>
              : removeReference?<p>当前引用：版本 {removeReference.version}。共享资源及其他项目引用保留。</p>:<>
                <p>{conversionSource?`所选私有源码：${conversionSource.sourceName}。JSON、项目覆盖和其他项目保持原样；转换后的共享来源只读。`:switchReference?`当前固定：版本 ${switchReference.version}。项目自有源码和覆盖保持原样。`:"共享源码固定为选定版本并只读。先载入共享声明，再应用项目声明；发布新版本不会更改此项目。"}</p>
                {!switchReference?<><label>搜索共享资源<Input type="search" aria-label="搜索共享资源" value={query} onChange={event => {
                  setQuery(event.target.value); setResourceOffset(0); setResourceId(""); setVersionId(""); setResources([]); setVersions([]); invalidate();
                }} /></label>
                <label>共享资源<SelectControl ariaLabel="共享资源" value={resourceId} disabled={sharedLoading || busy} placeholder="选择资源"
                  options={resources.map(item => {const existing=existingReferences.find(ref=>ref.resourceId===item.resourceId);return { value: item.resourceId, label: `${item.name}${item.state==="retired"?" · 已停用":existing?.direct?" · 已引用":existing?` · 由 ${existing.requiredBy.map(ref=>ref.resourceName).join("、")} 引入`:""}`, disabled: item.state==="retired"||!item.currentVersion||Boolean(existing) };})}
                  onValueChange={value => { setResourceId(value); setVersionId(""); setVersions([]); setVersionOffset(0); invalidate(); }} /></label></>:null}
                {!resourceId && resourceTotal > 20 ? <div>
                  <Button type="button" variant="outline" disabled={busy || sharedLoading || resourceOffset === 0} onClick={() => { setResourceOffset(value => value - 20); invalidate(); }}>上一页资源</Button>
                  <Button type="button" variant="outline" disabled={busy || sharedLoading || resourceOffset + 20 >= resourceTotal} onClick={() => { setResourceOffset(value => value + 20); invalidate(); }}>下一页资源</Button>
                </div> : null}
                {resourceId ? <label>固定版本<SelectControl ariaLabel="固定版本" value={versionId} disabled={sharedLoading || busy} placeholder="明确选择已发布版本"
                  options={versions.map(item => ({ value: item.id, label: `版本 ${item.version} · ${item.changeDescription}`, disabled:item.id===switchReference?.versionId }))}
                  onValueChange={value => { setVersionId(value); invalidate(); }} /></label> : null}
                {resourceId && versionTotal > 20 ? <div>
                  <Button type="button" variant="outline" disabled={busy || sharedLoading || versionOffset === 0} onClick={() => { setVersionId(""); setVersionOffset(value => value - 20); invalidate(); }}>较新版本</Button>
                  <Button type="button" variant="outline" disabled={busy || sharedLoading || versionOffset + 20 >= versionTotal} onClick={() => { setVersionId(""); setVersionOffset(value => value + 20); invalidate(); }}>较早版本</Button>
                </div> : null}
                {sharedLoading ? <p role="status">正在读取共享版本…</p> : !resources.length && !resourceId && !sharedError ? <p>没有匹配的共享资源。请先创建并发布资源，或调整搜索。</p> : null}
                {sharedError ? <div role="alert"><p>{sharedError}</p><Button type="button" variant="outline" onClick={() => setSharedRetry(value => value + 1)}>重试共享资源</Button></div> : null}
                {!switchReference?<details><summary>挂载目录（按需）</summary><label>项目挂载目录<Input aria-label="项目挂载目录" value={mountPath} disabled={busy} placeholder="留空保留资源路径"
                  onChange={event=>{setMountPath(event.target.value);invalidate();}} /></label></details>:null}
              </>}
            {candidate && source === "upload" ? <p role="status">已保存候选：{candidate.fileName}；尚未加入配置。</p> : null}
            {!removeReference?<div className="workbench-member-addition-dialog__columns">
              {source !== "shared" ? <label>文件用途<SelectControl ariaLabel="文件用途" value={role} disabled={busy}
                onValueChange={(value) => { setRole(value); invalidate(); }}
                options={(Object.keys(roleLabels) as Array<MemberAdditionBody["role"]>).map((value) => ({ value, label: roleLabels[value] }))} /></label> : <p>{conversionSource?"文件用途、顺序和项目根入口保持原样。":"用途：共享 include（项目根入口保持不变）"}</p>}
              {source!=="shared"?<label>文件顺序<Input aria-label="文件顺序" type="number" required min="0" max="100000" step="1" value={sortOrder}
                onChange={(event) => { setSortOrder(event.target.value); invalidate(); }} /></label>:null}
            </div>:null}
            {source !== "shared" && format === "json" ? <details onToggle={(event) => setRegistrationOpen(event.currentTarget.open)}><summary>登记 JSON 字段为参数（可选）</summary>
              <p>留空将只加入已校验的 JSON 文件，预览会明确显示未登记的参数状态。</p>
              {registrationOpen ? <WorkbenchJsonRegistrationFields key={`${source}:${source === "upload" ? file?.name : fileId}`} projectId={projectId}
                file={source === "upload" ? file : null} existingFile={source === "existing" ? availableFiles.find((item) => item.id === fileId) : undefined}
                catalog={catalogRepository} files={fileRepository} value={registration} onChange={(value) => { setRegistration(value); invalidate(); }} /> : null}
            </details> : null}
            <Button type="submit" disabled={busy || refreshRequired || refreshingReferences || !configSetId || (!removeReference&&(source === "shared" ? !resourceId || !versionId || sharedLoading || Boolean(sharedError) : source === "existing" ? !fileId : !file && !candidate))}>{busy ? "正在核对…" : removeReference?"预览移除引用":conversionSource?"预览共享转换":switchReference?"预览版本切换":"预览加入配置"}</Button>
          </fieldset>
        </form></details>
        {error||refreshError ? <p role="alert">{reference&&switchConflicts.length?(removeReference?"移除引用未通过。":"版本切换未通过。"):error}{refreshError?`；重新核对失败：${refreshError}`:""}</p> : null}
        {refreshRequired&&!busy?<Button variant="outline" disabled={refreshingReferences} onClick={()=>void refreshReferences()}>{refreshingReferences?"正在核对配置…":"重新核对配置"}</Button>:null}
        {reference && error ? <section aria-label={removeReference?"移除引用冲突处理":"版本冲突处理"}>
          {switchConflicts.length?<ul>{switchConflicts.map((item,index)=><li key={index}>
            <p>{item.sourceName}{item.line?`:${item.line}`:""}{item.node?` · ${item.node}`:""}{item.property?` · ${item.property}`:""}</p>
            <p>{item.message}</p>
            {onRecoverSwitch && (item.fileId||item.resourceId)?<div className="workbench-member-addition-dialog__conflict-actions">
              <Button type="button" variant="outline" onClick={()=>{invalidate();onRecoverSwitch(item,{versionId,reason});}}>{item.resourceId?"核对共享来源":"修正项目源码"}</Button>
              {item.resourceId && item.projectCorrection && projectRoot?<Button type="button" variant="outline" onClick={()=>{invalidate();onRecoverSwitch({message:item.message,...projectRoot,node:item.node,property:item.property},{versionId,reason});}}>编辑项目根文件</Button>:null}
            </div>:null}
          </li>)}</ul>:<p>{compositionError==="dependency"?"请先在配置组成中移除或变更依赖此资源的直接引用。":compositionError==="stale"?"请重新核对配置组成后预览。":removeReference?"当前配置未改变；请修正项目源码后重新预览。":"当前配置未改变；请重新预览，或选择其他目标版本。"}</p>}
          <div className="workbench-member-addition-dialog__conflict-actions">
            {removeReference?!compositionError&&!switchConflicts.some(item=>item.fileId||item.projectCorrection)&&projectRoot&&onRecoverSwitch?<Button type="button" variant="outline" onClick={()=>{invalidate();onRecoverSwitch({message:error,...projectRoot},{versionId,reason});}}>编辑项目根文件</Button>:null:<Button type="button" variant="outline" onClick={()=>{invalidate();if(selectionRef.current){selectionRef.current.open=true;selectionRef.current.querySelector<HTMLButtonElement>('[aria-label="固定版本"]')?.focus();}}}>重选目标版本</Button>}
            <Button type="button" variant="outline" onClick={onDismiss}>{compositionError?"返回配置组成":removeReference?"取消移除引用":"取消版本切换"}</Button>
          </div>
        </section>:null}
        {!switchConflicts.length && errorDiagnostics.length ? <ul aria-label="来源校验诊断">{errorDiagnostics.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
        {preview ? <section aria-label={conversionSource?"共享转换预览":removeReference?"移除引用预览":switchReference?"版本切换预览":"加入配置预览"} className={preview.sharedSwitch?"workbench-member-addition-dialog__switch-preview":undefined}>
          {preview.sharedConversion?<>
            <p role="status" className="workbench-member-addition-dialog__switch-status">完整生效配置与构建校验通过，文件、节点及参数关联身份保留。</p>
            <details><summary>转换文件及来源证明</summary>
              <ul className="workbench-member-addition-dialog__members">{preview.sharedConversion.files.map(file=><li key={file.fileId}>{file.sourceName} · {roleLabels[file.role as keyof typeof roleLabels]??file.role} · 顺序 {file.sortOrder} · 原始版本保留</li>)}</ul>
              <p>入口、include、覆盖顺序、构建设置及原始字节一致。</p>
              <pre>{JSON.stringify({sourceEvidence:preview.sharedConversion.sourceEvidence,files:preview.sharedConversion.files,origins:preview.sharedConversion.origins},null,2)}</pre>
            </details>
          </>:null}
          <h3>{configSets.find(set => set.id === configSetId)?.name === "default" ? "默认配置" : configSets.find(set => set.id === configSetId)?.name} · {preview.sharedRemoval?`移除 ${preview.sharedRemoval.name} · 版本 ${preview.sharedRemoval.version}（确认后生效）`:preview.sharedSwitch?`版本 ${preview.sharedSwitch.beforeVersion} → 版本 ${preview.sharedSwitch.afterVersion}（确认后生效）`:"确认后的文件组成"}</h3>
          {preview.sharedSwitch?<>
            <p role="status" className="workbench-member-addition-dialog__switch-status">构建与参数约束校验通过。</p>
            <div className="workbench-member-addition-dialog__switch-effects">
            <h4>最终值、节点状态与来源变化</h4>
            {preview.sharedSwitch.effective.length?preview.sharedSwitch.effective.map(item=><details className="workbench-member-addition-dialog__switch-change" key={`${item.node}:${item.property}`}>
              <summary><span className="workbench-member-addition-dialog__switch-key">{item.node} · {item.property}</span>
                <span className="workbench-member-addition-dialog__switch-value">{item.localOverride&&item.before===item.after?item.after??"不存在":`${item.before??"不存在"} → ${item.after??"不存在"}`}
                  {item.localOverride?<span className="workbench-member-addition-dialog__switch-flag">保留本地覆盖</span>:null}</span></summary>
              <dl><dt>旧共享声明</dt><dd>{item.oldShared??"不存在"}</dd><dt>目标共享声明</dt><dd>{item.targetShared??"不存在"}</dd>
                <dt>{item.before===item.after?"项目最终值":"当前项目 → 应用后"}</dt><dd>{item.before===item.after?item.after??"不存在":`${item.before??"不存在"} → ${item.after??"不存在"}`}</dd>
                <dt>当前来源 → 应用后来源</dt><dd>{item.originBefore??"隐式状态"} → {item.originAfter??"隐式状态"}</dd></dl>
            </details>):<p>最终值、节点状态和来源无变化。</p>}
            </div>
            <div className="workbench-member-addition-dialog__switch-metadata">
            <details><summary>旧依赖与目标依赖</summary>
              <p>旧依赖：{preview.sharedSwitch.dependencies.before.map(item=>`${item.name} · 版本 ${item.version}${item.mountPath?` · ${item.mountPath}`:""}`).join("；")}</p>
              <p>目标依赖：{preview.sharedSwitch.dependencies.after.map(item=>`${item.name} · 版本 ${item.version}${item.mountPath?` · ${item.mountPath}`:""}`).join("；")}</p>
            </details>
            <details><summary>完整原始源码与项目差异</summary>
              {preview.sharedSwitch.sources.map(item=><details key={item.sourceName}><summary>{item.sourceName} · {item.projectOwned?"项目自有":"共享来源"}{item.before===item.after?" · 保留原文":" · 源码变化"}</summary>
                <h4>当前源码</h4><pre>{item.before??"不存在"}</pre><h4>应用后源码</h4><pre>{item.after??"不存在"}</pre>
              </details>)}
            </details>
            <details><summary>配置组成与构建设置</summary><p>入口：{preview.entryFile}</p><p>include 路径：{preview.sharedSwitch.build.includeSearchPaths.join("、")}</p>
              {preview.overlayOrder.length?<p>覆盖顺序：{preview.overlayOrder.join(" → ")}</p>:null}
              {preview.sharedComposition?.map(resource=><p key={resource.resourceId}>{resource.name} · {resource.direct?"直接引用":"间接依赖"}</p>)}
              <ul className="workbench-member-addition-dialog__members">{preview.members.map(member=><li key={member.fileId}>{member.sourceName} · {roleLabels[member.role as keyof typeof roleLabels]??member.role} · 顺序 {member.sortOrder}</li>)}</ul>
              <pre>{JSON.stringify(preview.sharedSwitch.build.defines,null,2)}</pre></details>
            </div>
          </>:null}
          {!preview.sharedSwitch?<>
          {preview.sharedComposition?.length?<>
            {preview.sharedComposition.map(resource=><div key={resource.resourceId}><p>{resource.name} · 版本 {resource.version} · {resource.direct?"直接引用":"间接依赖"}</p>
              <ul className="workbench-member-addition-dialog__members">{resource.sources.map(source=><li key={source.fileId}>{source.sourceName}</li>)}</ul></div>)}
            <details><summary>项目自有及已有来源</summary><ul className="workbench-member-addition-dialog__members">{preview.members.filter(member=>!preview.sharedComposition!.some(resource=>resource.sources.some(source=>source.fileId===member.fileId))).map(member=><li key={member.fileId}>{member.sourceName} · {roleLabels[member.role as keyof typeof roleLabels]??member.role}</li>)}</ul></details>
          </>:<ul className="workbench-member-addition-dialog__members">{preview.members.map((member) => <li key={member.fileId}><span>{member.sourceName}</span><span>{roleLabels[member.role as keyof typeof roleLabels] ?? member.role} · 顺序 {member.sortOrder}</span></li>)}</ul>}
          {preview.sharedReference ? <p>{conversionSource?`确认后固定引用版本 ${preview.sharedReference.version}；来源成员只读，其他项目不受影响。`:`确认后将固定引用版本 ${preview.sharedReference.version}；来源成员只读，其他项目不受影响。`}</p> : null}
          {preview.rootEdit && preview.rootEdit.before!==preview.rootEdit.after ? <details><summary>项目根文件 include 变更：{preview.rootEdit.sourceName}</summary>
            <h4>当前源码</h4><pre aria-label="当前根文件源码">{preview.rootEdit.before}</pre><h4>确认后源码</h4><pre aria-label="确认后根文件源码">{preview.rootEdit.after}</pre></details> : null}
          {preview.entryFile && !preview.rootEdit ? <p>入口：{preview.entryFile}</p> : null}
          {preview.includeSearchPaths.length && !preview.rootEdit ? <p>include 路径：{preview.includeSearchPaths.join("、")}</p> : null}
          {preview.overlayOrder.length ? <p>覆盖顺序：{preview.overlayOrder.join(" → ")}</p> : null}
          </>:null}
          <p>{[
            preview.impact.parameterChanges && `参数变化 ${preview.impact.parameterChanges} 项`,
            preview.impact.nodeAdditions && `新增节点 ${preview.impact.nodeAdditions} 个`,
            preview.impact.nodeRemovals && `移除节点 ${preview.impact.nodeRemovals} 个`
          ].filter(Boolean).join("；") || "参数及节点无变化"}。</p>
          {preview.impact.restoredParameters ? <p>恢复 {preview.impact.restoredParameters} 个已删除参数，保留原身份及历史。</p> : null}
          {preview.impact.retainedBindings ? <p>保留 {preview.impact.retainedBindings} 个参数关联及历史。</p> : null}
          {preview.impact.sourceReplacements ? <p>{preview.impact.sourceReplacements} 个参数将切换有效来源文件，关联身份及历史保留。</p> : null}
          {preview.diagnostics.map((item, index) => <p key={`${item.code}-${index}`}>{item.message}</p>)}
        </section> : null}
      </div>
      {preview || reference ? <footer role="group" aria-label={removeReference?"移除引用确认":switchReference?"版本切换确认":"加入配置确认"}>
        <label>{reference||conversionSource?"变更说明":"加入原因"}{removeReference?<Textarea aria-label="变更说明" rows={2} value={reason} disabled={busy||uncertain} maxLength={2000} onChange={event=>setReason(event.target.value)}/>:<Input aria-label={reference||conversionSource?"变更说明":"加入原因"} value={reason} disabled={busy||uncertain} maxLength={2000} onChange={(event) => setReason(event.target.value)} />}</label>
        {preview?<div>{!uncertain?<Button type="button" variant="outline" disabled={busy} onClick={invalidate}>取消本次预览</Button>:null}
        <Button type="button" disabled={busy || !reason.trim()} onClick={() => void apply()}>{busy ? "正在应用…" : uncertain?"重试同一操作":removeReference?"确认移除引用":conversionSource?"确认转换引用":switchReference?"确认切换版本":"确认加入配置"}</Button></div>:null}
      </footer> : null}
      {sharedOnly?<SettingsLeaveGuard dirty={busy} saving={busy} />:null}
    </>}
  </ModalDialog>;
}

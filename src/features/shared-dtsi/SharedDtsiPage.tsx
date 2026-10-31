import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft } from "lucide-react";
import type { SharedDtsiDraft, SharedDtsiDraftInput, SharedDtsiResourceSummary, SharedDtsiResourceDetail,
  SharedDtsiVersion, SharedDtsiVersionSummary, SharedDtsiPublicationPreview, SharedDtsiUsages } from "@wiseeff/dto-schemas";
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
import { WorkbenchDtsEditor, type WorkbenchDtsEditorHandle, type WorkbenchDtsEditorSessions } from "@/components/project-configuration-workbench/WorkbenchDtsEditor";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { dtsBuildInputsSchema, sharedDtsiDraftInputSchema, sharedDtsiImportLimits } from "@wiseeff/dto-schemas";
import "./shared-dtsi.css";
import { SharedDtsiDependencies } from "./SharedDtsiDependencies";
import { SharedDtsiRecognition } from "./SharedDtsiRecognition";
import { SharedDtsiComparison, SharedDtsiComparisonContent } from "./SharedDtsiComparison";
import { SharedDtsiLifecycle } from "./SharedDtsiLifecycle";

type Props = { apiClient?: ApiClient; canWrite: boolean; canCreateSubject?:boolean;canProposeSource?:boolean;canReviewSource?:boolean;search: string; organizationId?: string; onNavigate: (path: string) => void };
type Scope = { key: string; client: ReturnType<typeof createSharedDtsiClient> | null; pending: boolean };
const empty: SharedDtsiDraftInput = { name: "", sourceName: "common.dtsi", content: "", changeDescription: "",dependencies:[] };
const draftInput = (draft: SharedDtsiDraft): SharedDtsiDraftInput => ({ name: draft.name,
  sourceName: draft.members[0]!.sourceName, content: draft.members[0]!.content, changeDescription: draft.changeDescription,
  ...(draft.buildInputs ? { buildInputs: draft.buildInputs } : {}),
  dependencies:draft.dependencies??[],members:draft.members });
const sourceMembers = (input:SharedDtsiDraftInput) => input.members ?? [{sourceName:input.sourceName,content:input.content}];
const withContent = (input:SharedDtsiDraftInput,index:number,content:string):SharedDtsiDraftInput => ({...input,content,
  ...(input.members?{members:input.members.map((member,at)=>at===index?{...member,content}:member)}:{})});
const comparable = (input:SharedDtsiDraftInput) => JSON.stringify({name:input.name,changeDescription:input.changeDescription,members:sourceMembers(input),archive:input.archive,dependencies:input.dependencies??[],buildInputs:input.buildInputs});
const message = (error: unknown) => error instanceof WiseEffApiError ? error.message : "请求失败，请重试。";
const buildTexts = (input: SharedDtsiDraftInput["buildInputs"]) => ({ paths: input?.includeSearchPaths.join("\n") ?? "",
  defines: Object.entries(input?.defines ?? {}).map(([name, value]) => `${name}=${value}`).join("\n") });
function buildInputsFromText(paths: string, macros: string): SharedDtsiDraftInput["buildInputs"] {
  const entries = macros.split("\n").filter(line => line.trim()).map(line => {
    const at = line.indexOf("=");
    if (at < 1) throw new WiseEffApiError("VALIDATION_FAILED", "构建宏每行填写 NAME=value。", {}, "");
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const;
  });
  if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new WiseEffApiError("VALIDATION_FAILED", "构建宏名称重复，请保留一个明确的值。", {}, "");
  const parsed = dtsBuildInputsSchema.safeParse({ includeSearchPaths: paths.split("\n").map(path => path.trim()).filter(Boolean), defines: Object.fromEntries(entries) });
  if (!parsed.success) throw new WiseEffApiError("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "构建设置无效。", {}, "");
  return parsed.data.includeSearchPaths.length || Object.keys(parsed.data.defines).length ? parsed.data : undefined;
}
const fixedBuildInputs = (input: SharedDtsiVersion["manifest"]["buildInputs"]) => input.includeSearchPaths.length || Object.keys(input.defines ?? {}).length
  ? <details className="shared-dtsi-build-inputs"><summary>构建设置</summary><dl className="shared-dtsi-metadata">
    {input.includeSearchPaths.length ? <div><dt>Include 搜索目录</dt><dd>{input.includeSearchPaths.join("\n")}</dd></div> : null}
    {Object.keys(input.defines ?? {}).length ? <div><dt>构建宏</dt><dd>{buildTexts({ includeSearchPaths: [], defines: input.defines ?? {} }).defines}</dd></div> : null}
  </dl></details> : null;

export function SharedDtsiPage({ apiClient, canWrite, canCreateSubject=false,canProposeSource=false,canReviewSource=false,search, organizationId, onNavigate }: Props) {
  const client = useMemo(() => apiClient ? createSharedDtsiClient(apiClient) : null, [apiClient]);
  const selected = new URLSearchParams(search).get("resource") ?? "";
  const selectedVersion = new URLSearchParams(search).get("version") ?? "";
  const selectedMember = new URLSearchParams(search).get("member");
  const requestedLine = new URLSearchParams(search).get("line") ?? "";
  const projectContext = new URLSearchParams(search).get("projectContext") ?? "";
  const projectReturnPath = /^\/parameter-admin\/projects\/[^/?#]+\/configuration\?/.test(projectContext) ? projectContext : null;
  const requestedTab = new URLSearchParams(search).get("tab");
  const tab = requestedTab === "versions" || requestedTab === "recognition" || requestedTab === "usages" ? requestedTab : "source";
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
  const [chosenVersions,setChosenVersions]=useState<SharedDtsiVersionSummary[]>([]);
  const [comparing,setComparing]=useState(false);
  const [usages,setUsages]=useState<SharedDtsiUsages|null>(null),[usagePage,setUsagePage]=useState(1);
  useEffect(()=>{setHistoryPage(1);setUsagePage(1);setChosenVersions([]);setComparing(false);},[selected,organizationId,client,canWrite]);
  const [preview, setPreview] = useState<{ scope: Scope; data: SharedDtsiPublicationPreview; key: string } | null>(null);
  const [form, setForm] = useState(empty);
  const [buildText, setBuildText] = useState(buildTexts(undefined));
  const [memberIndex,setMemberIndex]=useState(0);
  const [sourceReady,setSourceReady]=useState(false);
  const [editorVersion,setEditorVersion]=useState(0);
  const [importing,setImporting]=useState(false);
  const [ignoredFiles,setIgnoredFiles]=useState<string[]>([]);
  const [replacement,setReplacement]=useState<{members: NonNullable<SharedDtsiDraftInput["members"]>;name:string;ignored:string[];edit:number}|null>(null);
  const [addition,setAddition]=useState<NonNullable<typeof replacement>|null>(null);
  const [removeOpen,setRemoveOpen]=useState(false);
  const [newFileOpen,setNewFileOpen]=useState(false),[newFilePath,setNewFilePath]=useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [postSaveChanged,setPostSaveChanged]=useState(false);
  const [leaving, setLeaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const editor = useRef<WorkbenchDtsEditorHandle>(null);
  const editorSessions=useRef<WorkbenchDtsEditorSessions>(new Map());
  const memberKeys=useRef<string[]>([crypto.randomUUID()]);
  const resume=useRef<{resourceId:string;revision:number;members:{id:string;content:string;key:string}[];activeId:string}|null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const directoryUpload = useRef<HTMLInputElement>(null);
  const additionalUpload = useRef<HTMLInputElement>(null);
  const additionalDirectory = useRef<HTMLInputElement>(null);
  const edits = useRef(0);
  const importSequence = useRef(0);
  const nameTouched = useRef(false);
  const editorEpoch = useRef(0);
  const base = draft ? draftInput(draft) : empty;
  const members=sourceMembers(form);
  const memberPathError=(index:number)=>{
    const name=members[index]?.sourceName??"";
    const parsed=sharedDtsiDraftInputSchema.shape.sourceName.safeParse(name);
    if(!parsed.success)return parsed.error.issues[0]?.message??"文件路径无效。";
    return members.some((member,at)=>at!==index && member.sourceName.normalize("NFC")===name.normalize("NFC"))?"文件路径已存在。":"";
  };
  const invalidMembers=members.some((_,index)=>Boolean(memberPathError(index)));
  const missingSource=members.length>0 && !members.some(member=>/\.dtsi?$/u.test(member.sourceName));
  const atMemberLimit=members.length>=sharedDtsiImportLimits.maxFiles;
  const newFileError=!sharedDtsiDraftInputSchema.shape.sourceName.safeParse(newFilePath).success?"请输入有效的资源内源码路径。":members.some(member=>member.sourceName.normalize("NFC")===newFilePath.normalize("NFC"))?"文件路径已存在。":"";
  const dirty = Boolean(selected) && canWrite && !published && tab === "source" && (editorDirty || comparable(form) !== comparable(base)
    || JSON.stringify(buildText) !== JSON.stringify(buildTexts(base.buildInputs)));
  const busyLoading = loading || loadedScope !== scope;
  const currentPreview = preview?.scope === scope ? preview : null;
  const sessionKey = memberKeys.current[memberIndex] ?? "shared-dtsi-empty";
  const path = useCallback((resourceId: string, options?: { version?: string; tab?: string }) => {
    const params = new URLSearchParams(search);
    if (resourceId !== selected || options?.version!==undefined && options.version!==selectedVersion) { params.delete("member");params.delete("line"); }
    if (resourceId !== selected) { params.delete("version"); params.delete("tab");params.delete("projectContext"); }
    if (resourceId) params.set("resource", resourceId); else params.delete("resource");
    if (options?.version !== undefined) { if (options.version) params.set("version", options.version); else params.delete("version"); }
    if (options?.tab !== undefined) { if (options.tab === "source") params.delete("tab"); else params.set("tab", options.tab); }
    return `/parameter-admin/sources${params.size ? `?${params}` : ""}`;
  }, [search, selected,selectedVersion]);
  const leave = (resourceId: string, options?: { version?: string; tab?: string }) => { flushSync(() => setLeaving(true)); onNavigate(path(resourceId, options)); };
  const navigate = async (resourceId: string, options?: { version?: string; tab?: string }) => { if (!scope.pending && await requestSettingsLeave() && isCurrent(scope)) leave(resourceId, options); };

  useEffect(() => {
    let cancelled = false;
    const carry=resume.current?.resourceId===selected?resume.current:null;
    resume.current=null;
    if(!carry){editorSessions.current.clear();memberKeys.current=[crypto.randomUUID()];}
    setError(""); setConflict(false);setPostSaveChanged(false); setEditorDirty(false); setDraft(null); setPublished(null); setDetail(null); setPreview(null); setLeaving(false); setPending(false); setMemberIndex(0);
    setSourceReady(selected !== "new"); setImporting(false); setIgnoredFiles([]); setReplacement(null); setAddition(null);setRemoveOpen(false);setNewFileOpen(false);nameTouched.current=false; setEditorVersion(++editorEpoch.current);
    if (!client) { setLoading(false); setLoadedScope(scope); return; }
    if (selected === "new") { setForm(empty); setBuildText(buildTexts(undefined)); setLoading(false); setLoadedScope(scope); return; }
    setLoading(true);
    void (selected ? client.detail(selected).then(async metadata => {
      if (cancelled || !isCurrent(scope)) return;
      setDetail(metadata);
      if (tab === "versions") {
        const result = await client.versions(selected,(historyPage-1)*20);
        if (!cancelled && isCurrent(scope)) {setVersions(result.items);setVersionsTotal(result.total);}
      } else if(tab === "usages") {
        const result=await client.usages(selected,(usagePage-1)*20);
        if(!cancelled&&isCurrent(scope))setUsages(result);
      } else if (metadata.draftRevision && (selectedVersion === "draft" || !metadata.currentVersion)) {
        const result = await client.get(selected);
        if (!cancelled && isCurrent(scope)) {
          const index=carry?Math.max(0,result.members.findIndex(member=>member.id===carry.activeId)):0;
          memberKeys.current=result.members.map(member=>{const old=carry?.members.find(value=>value.id===member.id && value.content===member.content);return old?.key??crypto.randomUUID();});
          if(carry){for(const old of carry.members)if(!memberKeys.current.includes(old.key))editorSessions.current.delete(old.key);if(carry.revision!==result.revision){setSaved(null);setPostSaveChanged(true);}}
          setDraft(result);setForm({...draftInput(result),sourceName:result.members[index]!.sourceName,content:result.members[index]!.content});setMemberIndex(index);setBuildText(buildTexts(result.buildInputs));
        }
      } else if (metadata.currentVersion) {
        const result = await client.version(selected, selectedVersion && selectedVersion !== "draft" ? selectedVersion : metadata.currentVersion.id);
        if (!cancelled && isCurrent(scope)) {
          setMemberIndex(Math.max(0, result.members.findIndex(member => member.id === selectedMember)));
          setPublished(result);
        }
      } else throw new Error("资源没有可读取的源码。");
    }) : client.list({ q: query, offset: (page - 1) * 20, limit: 20 }).then(result => {
      if (!cancelled && isCurrent(scope)) { setRows(result.items); setTotal(result.total); }
    })).catch(cause => { if (!cancelled && isCurrent(scope)) setError(message(cause)); })
      .finally(() => { if (!cancelled && isCurrent(scope)) { setLoading(false); setLoadedScope(scope); } });
    return () => { cancelled = true; };
  }, [client, selected, selectedVersion, tab, query, page, historyPage,usagePage, reload, scope, isCurrent]);

  const persist = async (operation: Scope) => {
    if (!client) throw new Error("API 不可用。");
    const input = { ...withContent(form,memberIndex,editor.current?.flush()?.text ?? form.content), buildInputs: buildInputsFromText(buildText.paths, buildText.defines) };
    const submitted=sourceMembers(input),keys=memberKeys.current,activeKey=keys[memberIndex];
    setForm(input);
    const result = draft ? await client.save(draft.resourceId, { ...input, expectedRevision: draft.revision }) : await client.create(input);
    if (isCurrent(operation)) {
      const nextKeys=result.members.map(member=>{const index=submitted.findIndex(old=>old.id ? old.id===member.id : old.sourceName===member.sourceName);return keys[index]??crypto.randomUUID();});
      const index=Math.max(0,nextKeys.indexOf(activeKey!));memberKeys.current=nextKeys;
      if(selected==="new")resume.current={resourceId:result.resourceId,revision:result.revision,members:result.members.map((member,at)=>({id:member.id,content:member.content,key:nextKeys[at]!})),activeId:result.members[index]!.id};
      setDraft(result);setForm({...draftInput(result),sourceName:result.members[index]!.sourceName,content:result.members[index]!.content});setBuildText(buildTexts(result.buildInputs));setMemberIndex(index);setEditorDirty(false);setSaved(result.resourceId);
    }
    return result;
  };
  const save = async () => {
    if (!client || scope.pending || busyLoading || !canWrite || !dirty || conflict || published || !members.length || invalidMembers || missingSource || (!draft && selected!=="new")) return;
    importSequence.current+=1;setImporting(false);scope.pending = true; setPending(true); setError(""); setSaved(null);setPostSaveChanged(false); setPreview(null);
    try {
      const result = await persist(scope);
      if (isCurrent(scope) && selected === "new") leave(result.resourceId);
    } catch (cause) {
      if (isCurrent(scope)) { setError(message(cause)); setConflict(cause instanceof WiseEffApiError && cause.code === "CONFLICT"); }
    } finally { scope.pending = false; if (isCurrent(scope)) setPending(false); }
  };
  const preparePublication = async () => {
    if (!client || !draft || scope.pending || busyLoading || !canWrite || conflict || !form.changeDescription.trim() || !members.length || invalidMembers || missingSource) return;
    importSequence.current+=1;setImporting(false);scope.pending = true; setPending(true); setError(""); setPreview(null);
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
  const applyImport = (choice:NonNullable<typeof replacement>) => {
    if (!isCurrent(scope) || choice.edit !== edits.current || scope.pending) return;
    setEditorVersion(++editorEpoch.current); edits.current += 1;memberKeys.current=choice.members.map(()=>crypto.randomUUID());
    setForm(current => ({...current,name:nameTouched.current||draft||sourceReady&&current.name?current.name:choice.name,
      sourceName:choice.members[0]!.sourceName,content:choice.members[0]!.content,archive:undefined,
      members:choice.members.map(member=>({...member,...(current.members?.find(old=>old.sourceName===member.sourceName)?.id
        ? {id:current.members.find(old=>old.sourceName===member.sourceName)!.id} : {})}))}));
    setMemberIndex(0);setSourceReady(true);setIgnoredFiles(choice.ignored);setReplacement(null);
    setEditorDirty(true);setSaved(null);setError("");setReloadEditor(value=>value+1);
  };
  const applyAddition = (choice:NonNullable<typeof addition>) => {
    if (!isCurrent(scope) || choice.edit !== edits.current || scope.pending) return;
    const current=withContent(form,memberIndex,editor.current?.flush()?.text??form.content);
    const previous=sourceMembers(current);
    const merged=previous.map(old=>{const next=choice.members.find(member=>member.sourceName.normalize("NFC")===old.sourceName.normalize("NFC"));return next?{...old,content:next.content}:old;});
    merged.push(...choice.members.filter(member=>!previous.some(old=>old.sourceName.normalize("NFC")===member.sourceName.normalize("NFC"))));
    const checked=sharedDtsiDraftInputSchema.safeParse({name:"导入预览",sourceName:merged[memberIndex]?.sourceName??merged[0]?.sourceName,content:merged[memberIndex]?.content??merged[0]?.content,members:merged});
    if(!checked.success || merged.reduce((size,member)=>size+new TextEncoder().encode(member.content).length,0)>sharedDtsiImportLimits.maxTotalBytes){setError(checked.success?"资源源码总量不能超过 16 MiB。":checked.error.issues[0]?.message??"文件数量或大小超出限制。");setAddition(null);return;}
    const activeChanged=previous[memberIndex]?.content!==merged[memberIndex]?.content;
    memberKeys.current=merged.map((member,index)=>index>=previous.length||member.content!==previous[index]?.content?crypto.randomUUID():memberKeys.current[index]!);
    if(activeChanged)setEditorVersion(++editorEpoch.current);
    edits.current+=1;setForm({...current,sourceName:merged[memberIndex]!.sourceName,content:merged[memberIndex]!.content,members:merged});setEditorDirty(true);setSaved(null);setIgnoredFiles(choice.ignored);setAddition(null);setError("");
  };
  const importFiles = async (selectedFiles?: FileList | null, directory=false, adding=false) => {
    const files=Array.from(selectedFiles??[]);
    if (!files.length || scope.pending || published || busyLoading || !canWrite) return;
    const request = ++importSequence.current, edit = edits.current;
    setImporting(true);setError("");
    try {
      const file=files[0]!;
      const isArchive=files.length===1 && file.name.endsWith(".zip");
      if (files.length>sharedDtsiImportLimits.maxFiles || files.reduce((size,value)=>size+value.size,0)>sharedDtsiImportLimits.maxTotalBytes
        || files.some(value=>value.size>(isArchive?sharedDtsiImportLimits.maxArchiveBytes:sharedDtsiImportLimits.maxFileBytes))) {
        setError("最多 128 个文件，单文件 2 MiB、源码共 16 MiB；ZIP 最大 8 MiB。");return;
      }
      let members:NonNullable<SharedDtsiDraftInput["members"]>,ignored:string[]=[];
      if(isArchive) {
        const bytes=new Uint8Array(await file.arrayBuffer());let binary="";
        for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
        const result=await client!.inspectArchive({name:file.name,contentBase64:btoa(binary)});
        members=result.members;ignored=result.ignored;
      } else {
        if(files.some(value=>/\.zip$/iu.test(value.name))) throw new WiseEffApiError("VALIDATION_FAILED","请单独选择 ZIP 归档。",{},"");
        const paths=files.map(value=>value.webkitRelativePath||value.name);
        if(new Set(paths).size!==paths.length) throw new WiseEffApiError("VALIDATION_FAILED","选择的文件包含重复路径，请调整后重试。",{},"");
        for(const path of paths) {
          const checked=sharedDtsiDraftInputSchema.shape.sourceName.safeParse(/\.(dts|dtsi|h|hpp)$/u.test(path)?path:`${path}.dtsi`);
          if(!checked.success) throw new WiseEffApiError("VALIDATION_FAILED",`${path}：${checked.error.issues[0]?.message}`,{},"");
        }
        const sources=files.filter(value=>/\.(dts|dtsi|h|hpp)$/u.test(value.name));
        ignored=files.filter(value=>!sources.includes(value)).map(value=>value.webkitRelativePath||value.name);
        if(!sources.length) throw new WiseEffApiError("VALIDATION_FAILED","未找到支持的源码文件，请选择 .dts、.dtsi、.h 或 .hpp 文件。",{},"");
        members=await Promise.all(sources.map(async value=>{
          const sourceName=value.webkitRelativePath||value.name;
          try {return {sourceName,content:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await value.arrayBuffer())};}
          catch {throw new WiseEffApiError("VALIDATION_FAILED",`${sourceName}：源码必须采用 UTF-8 编码。`,{},"");}
        }));
      }
      const parsed=sharedDtsiDraftInputSchema.safeParse({name:"导入预览",members});
      if(!parsed.success) {
        const issue=parsed.error.issues[0]!;const index=issue.path[1];
        throw new WiseEffApiError("VALIDATION_FAILED",`${typeof index==="number"?members[index]?.sourceName+"：":""}${issue.message}`,{},"");
      }
      if(new Set(members.map(member=>member.sourceName.normalize("NFC"))).size!==members.length)
        throw new WiseEffApiError("VALIDATION_FAILED","选择的文件包含重复路径，请调整后重试。",{},"");
      if(!adding && !members.some(member=>/\.dtsi?$/u.test(member.sourceName)))
        throw new WiseEffApiError("VALIDATION_FAILED","资源至少需要一个 .dts 或 .dtsi 源码文件。",{},"");
      if (!isCurrent(scope) || request !== importSequence.current || edit !== edits.current || scope.pending) return;
      const name=directory&&file.webkitRelativePath ? file.webkitRelativePath.split("/")[0]! : file.name.replace(/\.(dts|dtsi|h|hpp|zip)$/u,"");
      const choice={members,name,ignored,edit};
      if(adding) {
        if(members.some(member=>sourceMembers(form).some(old=>old.sourceName.normalize("NFC")===member.sourceName.normalize("NFC")))) setAddition(choice);
        else applyAddition(choice);
        return;
      }
      if(sourceReady && (draft || editorDirty || form.members?.length || form.content)) setReplacement(choice); else applyImport(choice);
    } catch (cause) { if (isCurrent(scope) && request === importSequence.current && edit === edits.current && !scope.pending) setError(cause instanceof WiseEffApiError?cause.message:"无法读取文件，请重试。"); }
    finally {if(isCurrent(scope)&&request===importSequence.current)setImporting(false);}
  };
  const [reloadEditor, setReloadEditor] = useState(0);
  const selectMember=(index:number)=>{
    if(scope.pending)return;
    const current=withContent(form,memberIndex,editor.current?.flush()?.text??form.content),member=sourceMembers(current)[index]!;
    edits.current+=1;setForm({...current,sourceName:member.sourceName,content:member.content});setMemberIndex(index);setEditorDirty(false);
  };
  const removeMember=()=>{
    const current=withContent(form,memberIndex,editor.current?.flush()?.text??form.content);
    const members=sourceMembers(current).filter((_,index)=>index!==memberIndex);
    memberKeys.current=memberKeys.current.filter((_,index)=>index!==memberIndex);
    const next=Math.min(memberIndex,Math.max(0,members.length-1));
    setEditorVersion(++editorEpoch.current);edits.current+=1;
    setForm({...current,sourceName:members[next]?.sourceName??"",content:members[next]?.content??"",members});
    setMemberIndex(next);setEditorDirty(true);setSaved(null);setRemoveOpen(false);
  };
  const createMember=()=>{
    if(newFileError || scope.pending || atMemberLimit)return;
    const current=withContent(form,memberIndex,editor.current?.flush()?.text??form.content);
    const previous=sourceMembers(current);memberKeys.current=[...memberKeys.current,crypto.randomUUID()];
    edits.current+=1;setForm({...current,sourceName:newFilePath,content:"",members:[...previous,{sourceName:newFilePath,content:""}]});
    setMemberIndex(previous.length);setEditorDirty(true);setSaved(null);setNewFileOpen(false);
  };
  const memberNavigation=(items:{sourceName:string}[],select:(index:number)=>void,editable=false)=>items.length?<nav aria-label="资源文件" className="shared-dtsi-members"><ul>
    {items.map((member,index)=><li key={index}><Button variant="outline" aria-current={index===memberIndex?"true":undefined} aria-describedby={editable && index!==memberIndex && memberPathError(index)?`shared-member-error-${index}`:undefined}
      disabled={pending} onClick={()=>select(index)}>{member.sourceName}</Button>{editable && index!==memberIndex && memberPathError(index)?<span className="shared-dtsi-member-error" id={`shared-member-error-${index}`}>{memberPathError(index)}</span>:null}</li>)}</ul></nav>:null;
  const importControls=<>
    <input ref={upload} type="file" accept=".dts,.dtsi,.h,.hpp,.zip" multiple hidden onChange={event=>{void importFiles(event.target.files);event.target.value="";}} />
    <input ref={directoryUpload} type="file" multiple hidden {...{webkitdirectory:""}} onChange={event=>{void importFiles(event.target.files,true);event.target.value="";}} />
    <input ref={additionalUpload} aria-label="添加源码文件" type="file" accept=".dts,.dtsi,.h,.hpp,.zip" multiple hidden onChange={event=>{void importFiles(event.target.files,false,true);event.target.value="";}} />
    <input ref={additionalDirectory} aria-label="添加源码目录" type="file" multiple hidden {...{webkitdirectory:""}} onChange={event=>{void importFiles(event.target.files,true,true);event.target.value="";}} />
    {sourceReady?<Button variant="outline" disabled={pending} onClick={()=>additionalUpload.current?.click()}>添加文件</Button>:null}
    {sourceReady?<Button variant="outline" disabled={pending} onClick={()=>additionalDirectory.current?.click()}>添加目录</Button>:null}
    <Button variant={sourceReady?"outline":"default"} disabled={pending} onClick={()=>upload.current?.click()}>{sourceReady?"替换源码":"选择文件"}</Button>
    <Button variant="outline" disabled={pending} onClick={()=>directoryUpload.current?.click()}>{sourceReady?"替换为目录":"选择目录"}</Button>
  </>;

  if (!client) return <section className="shared-dtsi-page"><h1>共享 DTSI</h1><p role="status">共享 DTSI 需要 API 模式和有效登录。</p></section>;
  if (!selected) return <div className="shared-dtsi-page"><AdminListPage label="共享 DTSI" headerContent={<h1>共享 DTSI</h1>}
    headerActions={canWrite ? <Button onClick={() => void navigate("new")}>导入资源</Button> : null}
    filterBar={<SearchField ariaLabel="搜索共享 DTSI" value={query} onValueChange={value => { setQuery(value); setPage(1); }} placeholder="搜索名称、路径或已验证 compatible 标识" />}
    emptyState={{ title: query ? "没有匹配的资源" : "尚无共享 DTSI", message: query ? "请调整搜索条件。" : "导入公共源码后，可在这里保存草稿并发布共享版本。" }}
    tableState={busyLoading ? <SectionSkeleton label="正在加载共享 DTSI" /> : error ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : undefined}
    table={{ rows, rowKey: row => row.resourceId, pageSize: 20, page: 1, fluid: true,
      columns: [
        { key: "name", header: "资源名称", render: row => <Button variant="link" onClick={() => void navigate(row.resourceId)}>{row.name}</Button> },
        { key: "sourceName", header: "文件路径", render: row => <span title={row.sourceName}>{row.sourceName}</span> },
        { key: "state", header: "当前版本", render: row => `${row.state==="retired"?"已停用 · ":""}${row.currentVersion ? `v${row.currentVersion.version}${row.draftRevision ? " · 有草稿" : ""}` : "草稿"}` },
        { key: "updatedAt", header: "最后修改", render: row => formatAbsolute(row.updatedAt) }
      ] }} />
    {!loading && total > 20 ? <nav className="shared-dtsi-pagination" aria-label="共享 DTSI 分页"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span>{page} / {Math.ceil(total / 20)}</span><Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage(value => value + 1)}>下一页</Button></nav> : null}
  </div>;

  const lifecycleControls=client&&detail?<SharedDtsiLifecycle key={scopeKey} client={client} resource={detail} canWrite={canWrite} pending={pending}
    onPending={value=>{scope.pending=value;if(isCurrent(scope))setPending(value);}} onChanged={value=>{if(isCurrent(scope))setDetail(value);}} />:null;
  if (busyLoading) return <section className="shared-dtsi-page"><SectionSkeleton label="正在加载共享 DTSI" /></section>;

  if (selected === "new" && !sourceReady) return <section className="shared-dtsi-page shared-dtsi-page--editor" aria-label="导入共享 DTSI">
    <header className="shared-dtsi-header shared-dtsi-header--resource"><div className="shared-dtsi-heading"><Button variant="outline" size="sm" aria-label="返回资源列表" title="返回资源列表" onClick={()=>void navigate("")}><ArrowLeft aria-hidden="true" />返回</Button><h1>导入共享 DTSI</h1></div></header>
    <p className="shared-dtsi-hint">导入可供项目复用的源码，发布后可在项目配置中引用。</p>
    <div className="shared-dtsi-actions">{importControls}<Button variant="outline" onClick={()=>setSourceReady(true)}>新建源码</Button></div>
    <p className="shared-dtsi-hint">支持 .dts、.dtsi、.h、.hpp 和 ZIP；最多 128 个文件，单文件 2 MiB、源码共 16 MiB，ZIP 最大 8 MiB。</p>
    {importing?<div role="status">正在检查文件… <Button variant="ghost" onClick={()=>{importSequence.current++;setImporting(false);}}>取消</Button></div>:null}
    {error?<p className="shared-dtsi-error" role="alert">{error}</p>:null}
  </section>;

  if (currentPreview) return <section className="shared-dtsi-page shared-dtsi-page--editor" aria-label="共享 DTSI 发布预览" aria-busy={pending}>
    <header className="shared-dtsi-header"><div><Button variant="ghost" disabled={pending} onClick={() => setPreview(null)}>返回编辑</Button>
      <h1>发布 {currentPreview.data.name}</h1></div><Button disabled={pending} onClick={() => void publish()}>{pending ? "正在发布…" : "发布版本"}</Button></header>
    {error ? <p role="alert" className="shared-dtsi-error">{error}</p> : null}
    <p>本组织有查看权限的用户可读取完整源码；发布不会自动更新项目配置。</p>
    <dl className="shared-dtsi-metadata"><div><dt>文件</dt><dd>{currentPreview.data.manifest.members.length} 个 · 共享源码库</dd></div>
      <div><dt>变更说明</dt><dd>{currentPreview.data.changeDescription}</dd></div>
      {currentPreview.data.manifest.externalReferences.length ? <div><dt>项目需提供的引用</dt><dd>{currentPreview.data.manifest.externalReferences.join("、")}</dd></div> : null}</dl>
    {fixedBuildInputs(currentPreview.data.manifest.buildInputs)}
    {currentPreview.data.manifest.dependencyClosure?.length?<details><summary>完整固定依赖（{currentPreview.data.manifest.dependencyClosure.length}）</summary>
      <ul>{currentPreview.data.manifest.dependencyClosure.map(pin=><li key={pin.resourceId}>{pin.name} · 版本 {pin.version} · {pin.mountPath||"资源根目录"} <a
        href={path(pin.resourceId,{version:pin.versionId,tab:"source"})} target="_blank" rel="noreferrer">查看源码</a></li>)}</ul></details>:null}
    <SharedDtsiComparisonContent key={currentPreview.data.id} result={currentPreview.data.comparison} resourceId={selected}
      beforeLabel={currentPreview.data.comparison.before?`v${currentPreview.data.comparison.before.version}`:"首次发布"} afterLabel="待发布版本" />
  </section>;

  if (published || tab === "versions" || tab === "usages") return <section className="shared-dtsi-page shared-dtsi-page--editor shared-dtsi-page--resource" aria-label="共享 DTSI 版本" aria-busy={pending}>
    <header className="shared-dtsi-header shared-dtsi-header--resource"><div className="shared-dtsi-heading"><Button variant="outline" size="sm" aria-label="返回资源列表" title="返回资源列表" onClick={() => void navigate("")} disabled={pending}><ArrowLeft aria-hidden="true" />返回</Button>
      <h1>{published?.name ?? detail?.name ?? "共享 DTSI"}</h1>
      {projectReturnPath ? <a href={projectReturnPath} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(projectReturnPath); } }}>返回项目节点</a> : null}</div>
      {canWrite && detail?.state!=="retired" && detail?.currentVersion ? <Button disabled={pending} onClick={() => detail.draftRevision ? void navigate(selected,{version:"draft",tab:"source"})
        : published && published.id!==detail.currentVersion!.id ? void navigate(selected,{version:detail.currentVersion!.id,tab:"source"}) : void createVersionDraft()}>
        {detail.draftRevision ? "继续编辑草稿" : published && published.id!==detail.currentVersion.id ? "查看最新版本" : "创建新版本"}</Button> : null}</header>
    <div className="shared-dtsi-resource-body">
    {error ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : null}
    {lifecycleControls}
    <ViewSwitch variant="tabs" ariaLabel="共享资源详情" value={tab} onValueChange={value => void navigate(selected,{tab:value})}
      items={[{value:"source",label:"源码",id:"shared-source-tab",panelId:"shared-source-panel"},
        {value:"recognition",label:"来源识别",id:"shared-recognition-tab",panelId:"shared-recognition-panel"},
        {value:"versions",label:"版本",id:"shared-versions-tab",panelId:"shared-versions-panel"},
        {value:"usages",label:"使用情况",id:"shared-usages-tab",panelId:"shared-usages-panel"}]} />
    <TabPanel id="shared-recognition-panel" aria-labelledby="shared-recognition-tab" hidden={tab!=="recognition"}>
      {tab==="recognition" && published ? <SharedDtsiRecognition client={client} resourceId={selected} versionId={published.id}
        canWrite={canWrite} canCreateSubject={canCreateSubject} canProposeSource={canProposeSource} canReviewSource={canReviewSource} returnPath={path(selected,{version:published.id,tab:"recognition"})} organizationId={organizationId} onNavigate={onNavigate} /> : null}
    </TabPanel>
    <TabPanel id="shared-source-panel" aria-labelledby="shared-source-tab" hidden={tab!=="source"} className="shared-dtsi-published-panel">
      {tab==="source" && published ? <><p role="status">v{published.version} · {published.id===detail?.currentVersion?.id?"已发布":"历史版本"}，只读</p>
        <dl className="shared-dtsi-metadata"><div><dt>文件路径</dt><dd>{published.members[memberIndex]?.sourceName}</dd></div>
          <div><dt>发布时间</dt><dd>{formatAbsolute(published.createdAt)}</dd></div>
          <div><dt>发布者</dt><dd>{published.createdByName??published.createdByUserId}</dd></div>
          <div><dt>变更说明</dt><dd>{published.changeDescription}</dd></div></dl>
        {fixedBuildInputs(published.manifest.buildInputs)}
        {published.manifest.dependencyClosure?.length?<details><summary>完整固定依赖（{published.manifest.dependencyClosure.length}）</summary>
          <ul>{published.manifest.dependencyClosure.map(pin=><li key={pin.resourceId}>{pin.name} · 版本 {pin.version} · {pin.mountPath||"资源根目录"} <a
            href={path(pin.resourceId,{version:pin.versionId,tab:"source"})} target="_blank" rel="noreferrer">查看源码</a></li>)}</ul></details>:null}
        <div className="shared-dtsi-workspace">{memberNavigation(published.members,setMemberIndex)}
          <div className="shared-dtsi-source"><WorkbenchDtsEditor sessionKey={`shared-dtsi-version/${published.id}/${memberIndex}`} text={published.members[memberIndex]?.content ?? ""}
          readOnly focusLine={published.members[memberIndex]?.id === selectedMember && /^[1-9]\d*$/.test(requestedLine) ? Number(requestedLine) : null}
          ariaLabel="已发布 DTSI 源码" /></div></div></> : null}
    </TabPanel>
    <TabPanel id="shared-versions-panel" aria-labelledby="shared-versions-tab" hidden={tab!=="versions"}>
      {tab==="versions" && !error ? <><div className="shared-dtsi-version-actions">
        {chosenVersions.length?<p>{chosenVersions.map(version=>`v${version.version}`).join(" → ")}</p>:null}
        {versionsTotal>1?<><Button variant="outline" aria-describedby={chosenVersions.length!==2?"shared-comparison-hint":undefined} disabled={chosenVersions.length!==2} onClick={()=>setComparing(value=>!value)}>{comparing?"返回版本记录":"比较所选版本"}</Button>
          {chosenVersions.length!==2?<p id="shared-comparison-hint">选择两个已发布版本进行比较。</p>:null}</>:null}
      </div>
      {comparing&&chosenVersions.length===2?<SharedDtsiComparison key={chosenVersions.map(version=>version.id).join("/")} client={client} resourceId={selected}
        before={chosenVersions[0]!.id} after={chosenVersions[1]!.id} />:<DataTable rows={versions} rowKey={row=>row.id} fluid pageSize={20} columns={[
        ...(versionsTotal>1?[{key:"select",header:"比较",render:(row:SharedDtsiVersionSummary)=><input type="checkbox" aria-label={`选择版本 v${row.version}`} checked={chosenVersions.some(item=>item.id===row.id)}
          disabled={chosenVersions.length===2&&!chosenVersions.some(item=>item.id===row.id)} onChange={event=>{setComparing(false);setChosenVersions(current=>event.target.checked?[...current,row].sort((a,b)=>a.version-b.version):current.filter(item=>item.id!==row.id));}} />}]:[]),
        {key:"version",header:"版本",render:row=><Button variant="link" onClick={()=>void navigate(selected,{version:row.id,tab:"source"})}>v{row.version}</Button>},
        {key:"createdAt",header:"发布时间",render:row=>formatAbsolute(row.createdAt)},
        {key:"actor",header:"发布者",render:row=>row.createdByName??row.createdByUserId},
        {key:"changeDescription",header:"变更说明",render:row=><span className="shared-dtsi-description">{row.changeDescription}</span>}
      ]} emptyState={<SectionEmpty title="尚无已发布版本" message="发布草稿后，可在这里追溯版本。" />} />}</>:null}
      {tab==="versions" && !comparing && versionsTotal>20 ? <nav className="shared-dtsi-pagination" aria-label="共享版本分页">
        <Button variant="outline" disabled={historyPage===1} onClick={()=>setHistoryPage(value=>value-1)}>上一页</Button>
        <span>{historyPage} / {Math.ceil(versionsTotal/20)}</span><Button variant="outline" disabled={historyPage*20>=versionsTotal} onClick={()=>setHistoryPage(value=>value+1)}>下一页</Button></nav> : null}
    </TabPanel>
    <TabPanel id="shared-usages-panel" aria-labelledby="shared-usages-tab" hidden={tab!=="usages"}>
      {tab==="usages" && !error && usages ? <>
        <p>{usages.visibility==="authorized-projects"?"仅显示当前有权访问的项目配置。":"当前组织的项目配置。"} 共 {usages.total} 个授权使用。</p>
        <DataTable rows={usages.items} rowKey={row=>`${row.projectId}/${row.configSetId}`} fluid pageSize={20} columns={[
          {key:"project",header:"项目 / 配置",render:row=>{const params=new URLSearchParams({...(organizationId?{organization:organizationId}:{}),configSet:row.configSetId,tab:"effective"});
            const target=`/parameter-admin/projects/${encodeURIComponent(row.projectId)}/configuration?${params}`;
            return <a href={target} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(target);}}}>{row.projectName} / {row.configSetName}</a>;}},
          {key:"pin",header:"固定版本",render:row=><Button variant="link" onClick={()=>void navigate(selected,{version:row.versionId,tab:"source"})}>v{row.version}</Button>},
          {key:"origin",header:"引用来源",render:row=>row.direct?"直接引用":"传递依赖"},
          {key:"upgrade",header:"版本状态",render:row=>row.upgradeAvailable?"有新版本 · 未评估":"已固定最新版本 · 未评估"}
        ]} emptyState={<SectionEmpty title="没有可显示的项目使用" message="项目引用已发布版本后，可在这里查看有权访问的固定引用。" />} />
        {usages.total>20?<nav className="shared-dtsi-pagination" aria-label="共享使用分页"><Button variant="outline" disabled={usagePage===1} onClick={()=>setUsagePage(value=>value-1)}>上一页</Button>
          <span>{usagePage} / {Math.ceil(usages.total/20)}</span><Button variant="outline" disabled={usagePage*20>=usages.total} onClick={()=>setUsagePage(value=>value+1)}>下一页</Button></nav>:null}
      </>:null}
    </TabPanel>
    </div>
  </section>;

  return <section className="shared-dtsi-page shared-dtsi-page--editor shared-dtsi-page--resource" aria-label="共享 DTSI 草稿" aria-busy={pending}>
    <header className="shared-dtsi-header shared-dtsi-header--resource"><div className="shared-dtsi-heading"><Button variant="outline" size="sm" aria-label="返回资源列表" title="返回资源列表" onClick={() => void navigate("")} disabled={pending}><ArrowLeft aria-hidden="true" />返回</Button>
      <h1>{draft?.name ?? (selected === "new" ? "导入共享 DTSI" : "共享 DTSI")}{draft ? <span className="shared-dtsi-draft-label">草稿</span> : null}</h1>
      {detail?.currentVersion ? <Button variant="ghost" disabled={pending} onClick={()=>void navigate(selected,{version:detail.currentVersion!.id,tab:"source"})}>查看已发布版本</Button> : null}</div>
      <div className="shared-dtsi-actions">{saved === selected ? <span role="status">草稿已保存</span> : null}{draft && canWrite ? <Button variant="outline" disabled={pending || conflict} onClick={() => setDiscardOpen(true)}>丢弃草稿</Button> : null}
        {canWrite && (draft || selected==="new") ? <Button variant={draft?"outline":"default"} disabled={pending || !dirty || conflict || !form.name.trim() || !members.length || invalidMembers || missingSource} onClick={() => void save()}>{pending ? "保存中…" : "保存草稿"}</Button> : null}
        {draft && canWrite && detail?.state!=="retired" ? <Button aria-describedby={!form.changeDescription.trim()?"shared-publication-hint":undefined} disabled={pending || conflict || !form.changeDescription.trim() || !members.length || invalidMembers || missingSource} onClick={()=>void preparePublication()}>预览发布</Button> : null}</div>
    </header>
    <div className="shared-dtsi-resource-body">
    {lifecycleControls}
    {loading ? <SectionSkeleton label="正在加载共享 DTSI 草稿" /> : error && !draft && selected !== "new" ? <SectionError message={error} onRetry={() => setReload(value => value + 1)} /> : <>
      {error ? <div className="shared-dtsi-error" role="alert"><p>{error}</p>{conflict ? <Button variant="outline" onClick={() => setReloadOpen(true)}>重新载入</Button> : null}</div> : null}
      {postSaveChanged?<p role="status">草稿在保存后已更新，已载入最新版本。</p>:null}
      {draft?.sourceEvidence ? <p className="shared-dtsi-hint">已复制所选私有源码及依赖。本组织有查看权限的用户可读取草稿与发布版本；来源项目配置保持不变。</p> : null}
      <div className="shared-dtsi-fields">
        <label>资源名称<Input aria-label="资源名称" value={form.name} maxLength={160} readOnly={!canWrite} disabled={pending} onChange={event => { nameTouched.current=true; edits.current+=1; setForm({ ...form, name: event.target.value }); setSaved(null); }} /></label>
        {canWrite ? importControls : null}
      </div>
      {importing?<div role="status">正在检查文件… <Button variant="ghost" onClick={()=>{importSequence.current++;setImporting(false);}}>取消</Button></div>:null}
      {ignoredFiles.length?<details className="shared-dtsi-ignored"><summary>已忽略 {ignoredFiles.length} 个非源码文件</summary><ul>{ignoredFiles.map(name=><li key={name}>{name}：不支持的文件类型</li>)}</ul></details>:null}
      {canWrite?<SharedDtsiDependencies client={client} value={form.dependencies??[]} resourceId={draft?.resourceId} disabled={pending}
        sourceHref={(resourceId,versionId)=>path(resourceId,{version:versionId,tab:"source"})}
        onChange={dependencies=>{edits.current+=1;setForm(current=>({...current,dependencies}));setPreview(null);setSaved(null);}} />:null}
      <label className="shared-dtsi-change-description">变更说明<Textarea aria-label="变更说明" value={form.changeDescription} maxLength={1000} rows={2}
        placeholder="说明此共享版本的变更" readOnly={!canWrite} disabled={pending} onChange={event=>{edits.current+=1;setForm({...form,changeDescription:event.target.value});setSaved(null);}} /></label>
      <details className="shared-dtsi-build-inputs"><summary>构建设置</summary><div className="shared-dtsi-fields">
        <label>Include 搜索目录<Textarea aria-label="Include 搜索目录" rows={2} value={buildText.paths} placeholder="每行一个资源内目录，例如 include" readOnly={!canWrite} disabled={pending}
          onChange={event => { edits.current += 1; setBuildText({ ...buildText, paths: event.target.value }); setSaved(null); setPreview(null); }} /></label>
        <label>构建宏<Textarea aria-label="构建宏" rows={2} value={buildText.defines} placeholder="每行 NAME=value，例如 ENABLED=1" readOnly={!canWrite} disabled={pending}
          onChange={event => { edits.current += 1; setBuildText({ ...buildText, defines: event.target.value }); setSaved(null); setPreview(null); }} /></label>
      </div></details>
      {draft && canWrite && !form.changeDescription.trim() ? <p id="shared-publication-hint" className="shared-dtsi-hint">发布前请填写变更说明。</p> : null}
      {missingSource?<p className="shared-dtsi-error" role="status">请至少保留一个 .dts 或 .dtsi 文件。</p>:null}
      {members.length?<div className="shared-dtsi-fields"><label>文件路径<Input aria-label="文件路径" aria-invalid={Boolean(memberPathError(memberIndex))} aria-describedby={memberPathError(memberIndex)?"shared-member-path-error":undefined} value={form.sourceName} maxLength={240} readOnly={!canWrite} disabled={pending} onChange={event => { edits.current+=1;
          setForm({ ...form, sourceName: event.target.value,...(form.members?{members:form.members.map((member,index)=>index===memberIndex?{...member,sourceName:event.target.value}:member)}:{}) }); setSaved(null); }} />{memberPathError(memberIndex)?<span id="shared-member-path-error" role="alert">{memberPathError(memberIndex)}</span>:null}</label>
        {canWrite?<><Button variant="outline" disabled={pending || atMemberLimit} aria-describedby={atMemberLimit?"shared-member-limit":undefined} onClick={()=>{setNewFilePath("");setNewFileOpen(true);}}>新建源码</Button><Button variant="outline" onClick={()=>setRemoveOpen(true)} disabled={pending}>移除当前文件</Button></>:null}</div>:null}
      {canWrite && atMemberLimit?<p id="shared-member-limit" className="shared-dtsi-hint">最多 128 个文件，请先移除文件。</p>:null}
      {!members.length?<div><p role="status">暂无源码文件，请添加文件或新建源码。</p>{canWrite?<Button variant="outline" onClick={()=>{memberKeys.current=[crypto.randomUUID()];edits.current+=1;setForm(current=>({...current,sourceName:"common.dtsi",content:"",members:[{sourceName:"common.dtsi",content:""}]}));setEditorDirty(true);setSaved(null);}}>新建源码</Button>:null}</div>:form.archive?<p role="status">{form.archive.name} · 保存草稿后展开文件并检查路径。</p>:<div className="shared-dtsi-workspace">{memberNavigation(members,selectMember,true)}
      <div className="shared-dtsi-source"><WorkbenchDtsEditor ref={editor} sessions={editorSessions.current} sessionKey={sessionKey} text={form.content} baseText={draft?.members.find(member=>member.id===members[memberIndex]?.id)?.content??""} baselineRevision={draft?.revision} resetKey={reloadEditor}
        ariaLabel="DTSI 源码" readOnly={!canWrite || pending} onDirtyChange={meta => { if (editorVersion===editorEpoch.current && meta.sessionKey === sessionKey && isCurrent(scope)) { if(meta.generation>0) edits.current+=1; setEditorDirty(meta.dirty); if (meta.dirty) setSaved(null); } }}
        onChange={snapshot => { if (editorVersion===editorEpoch.current && snapshot.sessionKey === sessionKey && isCurrent(scope)) setForm(current => withContent(current,memberIndex,snapshot.text)); }} onSave={() => void save()} /></div></div>}
    </>}
    </div>
    <SettingsLeaveGuard dirty={dirty && !leaving} saving={pending} description="离开将放弃本页未保存的修改，已保存的草稿不会受到影响。" />
    <ConfirmDialog open={newFileOpen} title="新建源码" description="输入资源内相对路径。" extra={<label>文件路径<Input aria-label="文件路径" value={newFilePath} onChange={event=>setNewFilePath(event.target.value)} aria-invalid={Boolean(newFilePath && newFileError)} />{newFilePath && newFileError?<span role="alert">{newFileError}</span>:null}</label>} confirmLabel="创建文件" confirmDisabled={Boolean(newFileError) || atMemberLimit} onCancel={()=>setNewFileOpen(false)} onConfirm={createMember} />
    <ConfirmDialog open={removeOpen} title="移除文件？" description={`将从当前草稿中移除 ${form.sourceName}。`} confirmLabel="移除文件" onCancel={()=>setRemoveOpen(false)} onConfirm={removeMember} />
    <ConfirmDialog open={Boolean(addition)} title="替换重名文件？" description={`以下文件路径已存在，将替换其源码：${addition?.members.filter(member=>sourceMembers(form).some(old=>old.sourceName.normalize("NFC")===member.sourceName.normalize("NFC"))).map(member=>member.sourceName).join("、")??""}。其他文件会保留。`}
      confirmLabel="替换重名文件" onCancel={()=>setAddition(null)} onConfirm={()=>{if(addition)applyAddition(addition);}} />
    <ConfirmDialog open={Boolean(replacement)} title="替换全部源码？" description={`将替换当前 ${sourceMembers(form).length} 个文件及未保存的源码修改，资源名称和设置会保留。`}
      confirmLabel="替换源码" onCancel={()=>setReplacement(null)} onConfirm={()=>{if(replacement)applyImport(replacement);}} />
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

import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { configSetPackageLimits, type ConfigSetImportBody, type ConfigSetImportPreview, type ConfigSetImportResult } from "@wiseeff/dto-schemas";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const [sourceFiles,setSourceFiles]=useState<Array<{sourceName:string;format:"dts"|"json"}>|null>(null);
  const [entryFile,setEntryFile]=useState(""),[overlays,setOverlays]=useState<string[]>([]),[includePaths,setIncludePaths]=useState(""),[defines,setDefines]=useState("");
  const [diagnostics, setDiagnostics] = useState<string[]>([]), [pending, setPending] = useState<"file" | "preview" | "apply" | null>(null);
  const first = useRef<HTMLInputElement>(null), directoryInput=useRef<HTMLInputElement>(null), generation = useRef(0), fileGeneration=useRef(0);
  const mutation = useRef<{ proofToken: string; reason: string; clientMutationId: string } | null>(null);
  function invalidate() { generation.current += 1; setPending(current=>current==="file"?current:null); setPreview(null); setError(""); setDiagnostics([]); mutation.current = null; }
  function showError(cause: unknown, unknownResult = false) {
    const message = presentError(cause, unknownResult ? "文件和输入已保留。" : "配置预览失败，文件和输入已保留。");
    setError(unknownResult ? `未能确认导入结果，请重试同一操作。${message}` : message);
    const rows = cause instanceof WiseEffApiError ? cause.details.diagnostics : null;
    setDiagnostics(Array.isArray(rows) ? rows.flatMap(row => row && typeof row === "object" && "message" in row && typeof row.message === "string" ? [row.message] : []) : []);
  }
  async function chooseFiles(files: FileList | null) {
    invalidate(); const selected=++fileGeneration.current; setPending(null);setArchive(null);setSourceFiles(null);setEntryFile("");setOverlays([]);setIncludePaths("");setDefines("");
    if (!files?.length) return;
    const selectedFiles=Array.from(files),zipInput=selectedFiles.length===1&&selectedFiles[0]!.name.toLowerCase().endsWith(".zip");
    if (zipInput?selectedFiles[0]!.size>configSetPackageLimits.maxArchiveBytes:selectedFiles.length>configSetPackageLimits.maxFiles||selectedFiles.some(file=>file.size>configSetPackageLimits.maxFileBytes||!/\.(dts|dtsi|dtso|h|hpp|json)$/u.test(file.name))||selectedFiles.reduce((sum,file)=>sum+file.size,0)>configSetPackageLimits.maxTotalBytes) {setError("请选择一个不超过 17 MiB 的 ZIP，或最多 128 个 DTS、DTSI、头文件及 JSON（单文件 2 MiB，合计 16 MiB）。");return;}
    setPending("file");
    try {
      let bytes:Uint8Array;
      if(zipInput)bytes=new Uint8Array(await selectedFiles[0]!.arrayBuffer());
      else {const zip=new JSZip(),paths=new Set<string>();for(const file of selectedFiles){const path=file.webkitRelativePath||file.name,key=path.normalize("NFC");if(paths.has(key))throw new Error(`${path}：重复文件路径。`);paths.add(key);zip.file(path,await file.arrayBuffer(),{createFolders:false});}bytes=await zip.generateAsync({type:"uint8array"});}
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      if (selected !== fileGeneration.current) return;
      const sourceName=zipInput?selectedFiles[0]!.name:"project-sources.zip";
      setArchive({ name: sourceName, contentBase64: btoa(binary) });
      setName(current => current || (zipInput?sourceName.replace(/(?:-export)?\.zip$/iu, ""):selectedFiles[0]!.webkitRelativePath.split("/")[0]||"项目配置"));
    } catch (cause) { if (selected === fileGeneration.current) showError(cause); }
    finally { if (selected === fileGeneration.current) setPending(null); }
  }
  async function inspect() {
    if (!archive || !name.trim() || pending) return;
    invalidate(); setPending("preview"); const selected = generation.current;
    try { const result = await client.preview(projectId, body()); if (selected === generation.current) {
      if("kind" in result){setSourceFiles(result.members);setOwnership("private");}else setPreview(result);
    } }
    catch (cause) { if (selected === generation.current) showError(cause); }
    finally { if (selected === generation.current) setPending(null); }
  }
  function body():ConfigSetImportBody {
    const buildDefines:Record<string,string>=Object.create(null);
    for(const line of defines.split("\n").map(value=>value.trim()).filter(Boolean)){const index=line.indexOf("=");if(index<1)throw new Error("构建宏请每行填写 NAME=VALUE。");const key=line.slice(0,index).trim();if(Object.hasOwn(buildDefines,key))throw new Error(`构建宏 ${key} 重复。`);buildDefines[key]=line.slice(index+1).trim();}
    return {name:name.trim(),ownership,archive:archive!,...(sourceFiles?{sourceConfiguration:{entryFile:entryFile||null,overlayOrder:overlays,buildInputs:{includeSearchPaths:includePaths.split("\n").map(value=>value.trim()).filter(Boolean),defines:buildDefines}}}:{})};
  }
  async function apply() {
    if (!archive || !preview || !reason.trim() || pending) return;
    setPending("apply"); setError("");
    mutation.current ??= { proofToken: preview.proofToken, reason: reason.trim(), clientMutationId: crypto.randomUUID() };
    try { await onApplied(await client.apply(projectId, { ...body(), ...mutation.current })); }
    catch (cause) {
      if (cause instanceof WiseEffApiError && ["CONFLICT", "VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND"].includes(cause.code)) { mutation.current = null; setPreview(null); }
      showError(cause, Boolean(mutation.current));
    } finally { setPending(null); }
  }
  const locked = pending === "apply" || Boolean(mutation.current);
  return <ModalDialog open onDismiss={pending ? undefined : onDismiss} initialFocusRef={first} describedBy
    className="review-dialog submission-dialog configuration-workbench__package-import" backdropClassName="param-admin-modal-backdrop">
    {({ titleId, descriptionId }) => <>
      <header><h2 id={titleId}>导入完整配置</h2><p id={descriptionId}>导入项目原始文件、目录或 ZIP；也可重现 WiseEff 导出包。项目文件与参数身份将重新生成。</p></header>
      <div className="review-dialog__body" aria-busy={Boolean(pending)}>
        <label>配置包<Input ref={first} type="file" multiple accept=".zip,.dts,.dtsi,.dtso,.h,.hpp,.json" disabled={Boolean(pending) || locked}
          onChange={event => { if(directoryInput.current)directoryInput.current.value="";void chooseFiles(event.target.files); }} /></label>
        <label>源码目录<Input ref={directoryInput} type="file" multiple {...{webkitdirectory:""}} disabled={Boolean(pending)||locked} onChange={event=>{if(first.current)first.current.value="";void chooseFiles(event.target.files);}} /></label>
        <label>配置名称<Input value={name} maxLength={120} disabled={locked} onChange={event => { invalidate(); setName(event.target.value); }} /></label>
        {!sourceFiles?<label>源码归属<SelectControl ariaLabel="源码归属" value={ownership} disabled={locked} onValueChange={value => { invalidate(); setOwnership(value); }}
          options={[{value:"reuse",label:"复用精确共享版本"},{value:"private",label:"全部作为项目私有源码"}]} /></label>
        :<section aria-label="原始源码构建选择">
          <label>入口 DTS<SelectControl ariaLabel="入口 DTS" value={entryFile} disabled={locked} onValueChange={value=>{invalidate();setEntryFile(value);setOverlays(current=>current.filter(path=>path!==value));}} options={[{value:"",label:sourceFiles.some(file=>file.format==="dts")?"选择项目入口":"JSON 配置（无需 DTS 入口）"},...sourceFiles.filter(file=>/\.(dts|dtsi)$/u.test(file.sourceName)).map(file=>({value:file.sourceName,label:file.sourceName}))]} /></label>
          {sourceFiles.some(file=>/\.(dts|dtsi|dtso)$/u.test(file.sourceName)&&file.sourceName!==entryFile)?<fieldset disabled={locked}><legend>覆盖文件（可选，按顺序应用）</legend>
            {[...overlays,...sourceFiles.filter(file=>/\.(dts|dtsi|dtso)$/u.test(file.sourceName)&&file.sourceName!==entryFile&&!overlays.includes(file.sourceName)).map(file=>file.sourceName)].map((path,index)=><div className="configuration-workbench__package-overlay" key={path}>
              <label><input type="checkbox" aria-label={`覆盖文件 ${path}`} checked={overlays.includes(path)} onChange={event=>{invalidate();setOverlays(current=>event.target.checked?[...current,path]:current.filter(value=>value!==path));}} />{index<overlays.length?`${index+1}. `:null}<span>{path}</span></label>
              {overlays.length>1&&index<overlays.length?<Button variant="ghost" aria-label={`上移 ${path}`} disabled={index===0} onClick={()=>{invalidate();setOverlays(current=>{const next=[...current];[next[index-1],next[index]]=[next[index]!,next[index-1]!];return next;});}}>上移</Button>:null}
            </div>)}</fieldset>:null}
          <details><summary>构建设置</summary><label>include 搜索目录（每行一个）<Textarea value={includePaths} disabled={locked} onChange={event=>{invalidate();setIncludePaths(event.target.value);}} /></label><label>构建宏（每行 NAME=VALUE）<Textarea value={defines} disabled={locked} onChange={event=>{invalidate();setDefines(event.target.value);}} /></label></details>
        </section>}
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
          : <Button disabled={Boolean(pending) || !archive || !name.trim()||Boolean(sourceFiles?.some(file=>file.format==="dts")&&!entryFile)} onClick={() => void inspect()}>{pending === "preview" ? "正在验证…" : "预览导入"}</Button>}</footer>
    </>}
  </ModalDialog>;
}

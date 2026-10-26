import { useEffect, useState } from "react";
import type { SharedDtsiDraftInput, SharedDtsiResourceSummary, SharedDtsiVersionSummary } from "@wiseeff/dto-schemas";
import type { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { presentError } from "@/infrastructure/http/presentError";

export function SharedDtsiDependencies({client,value,onChange,resourceId,disabled,sourceHref}:{client:ReturnType<typeof createSharedDtsiClient>;
  value:NonNullable<SharedDtsiDraftInput["dependencies"]>;onChange:(value:NonNullable<SharedDtsiDraftInput["dependencies"]>)=>void;resourceId?:string;disabled:boolean;
  sourceHref?:(resourceId:string,versionId:string)=>string}) {
  const [open,setOpen]=useState(value.length>0),[query,setQuery]=useState(""),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
  const [resources,setResources]=useState<SharedDtsiResourceSummary[]>([]),[versions,setVersions]=useState<SharedDtsiVersionSummary[]>([]);
  const [selected,setSelected]=useState(""),[versionId,setVersionId]=useState(""),[mountPath,setMountPath]=useState("");
  const [versionOffset,setVersionOffset]=useState(0),[versionTotal,setVersionTotal]=useState(0),[labels,setLabels]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!open)return;
    let active=true;setBusy(true);setError("");
    void (selected?client.versions(selected,versionOffset).then(result=>{if(active){setVersions(result.items);setVersionTotal(result.total);setLabels(current=>({...current,...Object.fromEntries(result.items.map(item=>[item.id,`${item.name} · 版本 ${item.version}`]))}));}})
      :client.list({q:query,offset,limit:20}).then(result=>{if(active){setResources(result.items);setTotal(result.total);setLabels(current=>({...current,...Object.fromEntries(result.items.map(item=>[item.resourceId,item.name]))}));}}))
      .catch(failure=>{if(active)setError(presentError(failure,"无法加载固定依赖。"));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[client,open,selected,versionOffset,query,offset,retry]);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      // Read one exact revision at a time; discard source bytes after retaining its label.
      for(const pin of value)if(!labels[pin.versionId]) {
        try {const item=await client.version(pin.resourceId,pin.versionId);if(!active)return;
          setLabels(current=>({...current,[item.id]:`${item.name} · 版本 ${item.version}`}));}
        catch(failure){if(active)setError(presentError(failure,"固定依赖不可读取，请移除后重新选择。"));}
      }
    })();
    return()=>{active=false;};
  },[client,value,labels]);
  return <details open={open} onToggle={event=>setOpen(event.currentTarget.open)} className="shared-dtsi-dependencies"><summary>固定资源依赖{value.length?`（${value.length}）`:"（按需）"}</summary>
    <p>仅选择明确发布的版本。挂载目录中的路径可由本资源 include；预览会检查完整传递依赖。</p>
    {value.length?<ul>{value.map((pin,index)=><li key={pin.resourceId}><span>{labels[pin.versionId]??labels[pin.resourceId]??`固定依赖 ${index+1}`} · {pin.mountPath||"资源根目录"}</span>
      {sourceHref?<a href={sourceHref(pin.resourceId,pin.versionId)} target="_blank" rel="noreferrer" aria-label={`查看固定依赖 ${index+1} 源码`}>查看源码</a>:null}
      <Button variant="ghost" disabled={disabled} onClick={()=>onChange(value.filter((_,at)=>at!==index))}>移除依赖 {index+1}</Button></li>)}</ul>:<p>尚未选择固定资源依赖。</p>}
    <div className="shared-dtsi-fields">
      <label>搜索依赖资源<Input aria-label="搜索依赖资源" value={query} disabled={disabled} onChange={event=>{setQuery(event.target.value);setSelected("");setVersionId("");setOffset(0);}} /></label>
      <label>依赖资源<SelectControl ariaLabel="依赖资源" value={selected} disabled={disabled||busy} placeholder="选择已发布资源"
        options={resources.filter(item=>item.resourceId!==resourceId).map(item=>({value:item.resourceId,label:`${item.name}${item.state==="retired"?" · 已停用":""}`,disabled:item.state==="retired"||!item.currentVersion||value.some(pin=>pin.resourceId===item.resourceId)}))}
        onValueChange={id=>{setSelected(id);setVersionId("");setVersionOffset(0);}} /></label>
      {selected?<label>依赖固定版本<SelectControl ariaLabel="依赖固定版本" value={versionId} disabled={disabled||busy} placeholder="明确选择版本"
        options={versions.map(item=>({value:item.id,label:`版本 ${item.version} · ${item.changeDescription}`}))} onValueChange={setVersionId} /></label>:null}
      <label>依赖挂载目录<Input aria-label="依赖挂载目录" value={mountPath} placeholder="例如 vendor/common；留空使用资源根目录" disabled={disabled} onChange={event=>setMountPath(event.target.value)} /></label>
      <Button variant="outline" disabled={disabled||busy||!versionId||value.length>=32} onClick={()=>{onChange([...value,{resourceId:selected,versionId,mountPath}]);setSelected("");setVersionId("");setMountPath("");}}>添加固定依赖</Button>
    </div>
    {selected&&versionTotal>20?<div><Button variant="outline" disabled={disabled||busy||!versionOffset} onClick={()=>{setVersionId("");setVersionOffset(at=>at-20);}}>较新依赖版本</Button>
      <Button variant="outline" disabled={disabled||busy||versionOffset+20>=versionTotal} onClick={()=>{setVersionId("");setVersionOffset(at=>at+20);}}>较早依赖版本</Button></div>:null}
    {!selected&&total>20?<div><Button variant="outline" disabled={disabled||busy||!offset} onClick={()=>setOffset(at=>at-20)}>上一页依赖</Button>
      <Button variant="outline" disabled={disabled||busy||offset+20>=total} onClick={()=>setOffset(at=>at+20)}>下一页依赖</Button></div>:null}
    {busy?<p role="status">正在加载固定依赖…</p>:!resources.length&&!error?<p>没有匹配的已发布依赖，请调整搜索或先发布资源。</p>:null}
    {error?<div role="alert"><p>{error}</p><Button variant="outline" onClick={()=>setRetry(at=>at+1)}>重试固定依赖</Button></div>:null}
  </details>;
}

import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import type { SharedDtsiDraftInput, SharedDtsiResourceSummary, SharedDtsiVersionSummary } from "@wiseeff/dto-schemas";
import type { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/common/SearchField";
import { presentError } from "@/infrastructure/http/presentError";

export function SharedDtsiDependencies({client,value,onChange,resourceId,disabled,sourceHref}:{client:ReturnType<typeof createSharedDtsiClient>;
  value:NonNullable<SharedDtsiDraftInput["dependencies"]>;onChange:(value:NonNullable<SharedDtsiDraftInput["dependencies"]>)=>void;resourceId?:string;disabled:boolean;
  sourceHref?:(resourceId:string,versionId:string)=>string}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
  const [resources,setResources]=useState<SharedDtsiResourceSummary[]>([]),[versions,setVersions]=useState<SharedDtsiVersionSummary[]>([]);
  const [selected,setSelected]=useState(""),[versionId,setVersionId]=useState(""),[mountPath,setMountPath]=useState("");
  const [versionOffset,setVersionOffset]=useState(0),[versionTotal,setVersionTotal]=useState(0),[labels,setLabels]=useState<Record<string,string>>({});
  const [pickerOpen,setPickerOpen]=useState(false),[busy,setBusy]=useState(false),[versionsBusy,setVersionsBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [listError,setListError]=useState(""),[listRetry,setListRetry]=useState(0);
  const [pinErrors,setPinErrors]=useState<Record<string,string>>({});
  const excluded=[resourceId,...value.map(pin=>pin.resourceId)].filter(Boolean).join(",");
  useEffect(()=>{
    if(!open || !pickerOpen)return;
    let active=true;setBusy(true);setListError("");
    void client.list({q:query,offset,limit:20,eligible:"1",exclude:excluded}).then(result=>{if(active){setResources(result.items);setTotal(result.total);setLabels(current=>({...current,...Object.fromEntries(result.items.map(item=>[item.resourceId,item.name]))}));}})
      .catch(failure=>{if(active)setListError(presentError(failure,"无法加载共享资源。"));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[client,open,pickerOpen,query,offset,listRetry,excluded]);
  useEffect(()=>{
    if(!open||!selected)return;
    let active=true;setVersionsBusy(true);setError("");
    void client.versions(selected,versionOffset).then(result=>{if(active){setVersions(result.items);setVersionTotal(result.total);setLabels(current=>({...current,...Object.fromEntries(result.items.map(item=>[item.id,`${item.name} · 版本 ${item.version}`]))}));}})
      .catch(failure=>{if(active)setError(presentError(failure,"无法加载版本。"));}).finally(()=>{if(active)setVersionsBusy(false);});
    return()=>{active=false;};
  },[client,open,selected,versionOffset,retry]);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      // Read one exact revision at a time; discard source bytes after retaining its label.
      for(const pin of value)if(!labels[pin.versionId]&&!pinErrors[pin.versionId]) {
        if(!active)return;
        try {const item=await client.version(pin.resourceId,pin.versionId);if(!active)return;
          setLabels(current=>({...current,[item.id]:`${item.name} · 版本 ${item.version}`}));}
        catch(failure){if(!active)return;setPinErrors(current=>({...current,[pin.versionId]:presentError(failure,"固定依赖不可读取，请移除后重新选择。")}));}
        return;
      }
    })();
    return()=>{active=false;};
  },[client,value,labels,pinErrors]);
  const pinError=value.map(pin=>labels[pin.versionId]?undefined:pinErrors[pin.versionId]).find(Boolean);
  const available=resources.filter(item=>item.resourceId!==resourceId&&item.state!=="retired"&&item.currentVersion&&!value.some(pin=>pin.resourceId===item.resourceId));
  const pinLabel=(pin:typeof value[number],index:number)=>labels[pin.versionId]??labels[pin.resourceId]??`固定依赖 ${index+1}`;
  return <details open={open} onToggle={event=>setOpen(event.currentTarget.open)} className="shared-dtsi-dependencies"><summary><span>引用其他共享资源</span>{!open&&value.length?<span className="shared-dtsi-dependency-summary">{value.map((pin,index)=>`${pinLabel(pin,index)} · ${pin.mountPath||"资源根目录"}`).join("；")}</span>:null}</summary>
    {value.length?<ul>{value.map((pin,index)=>{const label=pinLabel(pin,index),path=pin.mountPath||"资源根目录";
      // ponytail: scans at most 32 references; use a count map if this bound is raised.
      const duplicate=value.some((other,at)=>at!==index&&pinLabel(other,at)===label&&(other.mountPath||"资源根目录")===path);
      const accessible=`${label} · ${path}${duplicate?` · 第 ${index+1} 项`:""}`;
      return <li key={pin.resourceId}><span>{label} · {path}</span>
      {sourceHref?<a href={sourceHref(pin.resourceId,pin.versionId)} target="_blank" rel="noreferrer" aria-label={`查看 ${accessible} 源码`}>查看源码</a>:null}
      <Button variant="outline" aria-label={`移除 ${accessible}`} disabled={disabled} onClick={()=>{setOffset(0);onChange(value.filter((_,at)=>at!==index));}}>移除</Button></li>;})}</ul>:null}
    <div className="shared-dtsi-fields">
      <div className="shared-dtsi-resource-picker"><Popover.Root open={pickerOpen&&!disabled} onOpenChange={next=>{if(next)setBusy(true);setPickerOpen(next);}}>
        <Popover.Trigger asChild><Button variant="outline" disabled={disabled} aria-label={selected?`共享资源：${labels[selected]??"已选择"}`:"选择共享资源"}>{selected?labels[selected]??"选择共享资源":"选择共享资源"}</Button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="shared-dtsi-resource-menu" align="start" sideOffset={4} aria-label="选择共享资源">
          <SearchField ariaLabel="搜索共享资源" placeholder="搜索共享资源" value={query} onValueChange={value=>{if(value!==query||offset!==0)setBusy(true);setQuery(value);setOffset(0);}} />
          <div className="shared-dtsi-resource-options" aria-label="可引用的共享资源">{!busy&&!listError&&available.map(item=><Button key={item.resourceId} variant="ghost" onClick={()=>{if(item.resourceId!==selected){setVersions([]);setVersionTotal(0);setSelected(item.resourceId);setVersionId("");setVersionOffset(0);}setPickerOpen(false);}}>{item.name}</Button>)}</div>
          {busy?<p role="status">正在加载共享资源…</p>:!available.length&&!listError?<p role="status">{total>20?"本页没有可引用的资源。":query?"没有匹配的可引用资源。":"暂无可引用的已发布资源。"}</p>:null}
          {!listError&&total>20?<div className="shared-dtsi-resource-pagination"><Button variant="outline" disabled={busy||!offset} onClick={()=>{setBusy(true);setOffset(at=>at-20);}}>上一页</Button><span>{Math.floor(offset/20)+1} / {Math.ceil(total/20)}</span><Button variant="outline" disabled={busy||offset+20>=total} onClick={()=>{setBusy(true);setOffset(at=>at+20);}}>下一页</Button></div>:null}
          {!busy&&listError?<div role="alert"><p>{listError}</p><Button variant="outline" onClick={()=>{setBusy(true);setListRetry(at=>at+1);}}>重试</Button></div>:null}
        </Popover.Content></Popover.Portal></Popover.Root></div>
      {selected?<label>版本<SelectControl ariaLabel="版本" value={versionId} disabled={disabled||versionsBusy} placeholder="选择版本"
        options={versions.map(item=>({value:item.id,label:`版本 ${item.version} · ${item.changeDescription}`}))} onValueChange={setVersionId} /></label>:null}
      {selected?<details className="shared-dtsi-reference-path"><summary tabIndex={0}>引用目录（可选）</summary><label><Input aria-label="引用目录" aria-describedby="shared-dtsi-reference-path-hint" value={mountPath} placeholder="留空使用资源根目录" disabled={disabled} onChange={event=>setMountPath(event.target.value)} /><span id="shared-dtsi-reference-path-hint">例如 vendor，源码使用 vendor/clocks.dtsi。</span></label></details>:null}
      {selected?<Button variant="outline" disabled={disabled||versionsBusy||!versionId||value.length>=32} onClick={()=>{onChange([...value,{resourceId:selected,versionId,mountPath}]);setOffset(0);setSelected("");setVersionId("");setMountPath("");}}>添加引用</Button>:null}
    </div>
    {selected&&versionTotal>20?<div><Button variant="outline" disabled={disabled||versionsBusy||!versionOffset} onClick={()=>{setVersions([]);setVersionId("");setVersionOffset(at=>at-20);}}>较新版本</Button>
      <Button variant="outline" disabled={disabled||versionsBusy||versionOffset+20>=versionTotal} onClick={()=>{setVersions([]);setVersionId("");setVersionOffset(at=>at+20);}}>较早版本</Button></div>:null}
    {!pickerOpen&&error?<div role="alert"><p>{error}</p><Button variant="outline" onClick={()=>setRetry(at=>at+1)}>重试</Button></div>:null}
    {!pickerOpen&&pinError?<div role="alert"><p>{pinError}</p><Button variant="outline" onClick={()=>setPinErrors({})}>重试引用</Button></div>:null}
  </details>;
}

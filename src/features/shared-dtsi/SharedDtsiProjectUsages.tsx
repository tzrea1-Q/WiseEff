import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { sharedDtsiProjectUsagesSchema, type SharedDtsiProjectUsages } from "@wiseeff/dto-schemas";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SearchField } from "@/components/common/SearchField";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import { ModalDialog } from "@/components/common/ModalDialog";
import { WorkbenchMemberAdditionDialog } from "@/components/project-configuration-workbench/WorkbenchMemberAdditionDialog";
import { createCanonicalMemberAdditionClient } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";

type Result=SharedDtsiProjectUsages;
type Row=Result["items"][number];

export function SharedDtsiProjectUsages({apiClient,organizationId,canWrite,search,onNavigate,header}:{
  apiClient:ApiClient;organizationId?:string;canWrite:boolean;search:string;onNavigate:(path:string)=>void;header:ReactNode;
}) {
  const params=new URLSearchParams(search),query=params.get("usageQuery")??"",requestedStatus=params.get("usageStatus"),
    status=requestedStatus==="referenced"||requestedStatus==="unreferenced"?requestedStatus:"all";
  const pageValue=Number(params.get("usagePage")??"1"),page=Number.isSafeInteger(pageValue)&&pageValue>0&&pageValue<=5001?pageValue:1;
  const [reload,setReload]=useState(0);
  const [selected,setSelected]=useState<{row:Row;adding:boolean;scope:string;client:ApiClient;canWrite:boolean;instance:string;organizationId?:string}|null>(null);
  const [appliedNotice,setAppliedNotice]=useState(false);
  const [uncertainNotice,setUncertainNotice]=useState(false);
  const [unavailableTargets,setUnavailableTargets]=useState<Set<string>>(()=>new Set());
  const [rechecking,setRechecking]=useState<string|null>(null),[recheckError,setRecheckError]=useState("");
  const trigger=useRef<HTMLElement|null>(null);
  const scopeEpoch=useRef(0),targetEpoch=useRef(new Map<string,number>());
  const additionClient=useMemo(()=>createCanonicalMemberAdditionClient(apiClient),[apiClient]);
  const sharedClient=useMemo(()=>createSharedDtsiClient(apiClient),[apiClient]);
  useEffect(()=>()=>{scopeEpoch.current++;setSelected(null);setRechecking(null);setRecheckError("");},[apiClient,organizationId,canWrite,search]);
  const [loaded,setLoaded]=useState<{key:string;client:ApiClient;canWrite:boolean;result?:Result;error?:string}|null>(null);
  const key=JSON.stringify([organizationId,query,status,page,reload]);
  const selection=selected?.scope===search&&selected.client===apiClient&&selected.canWrite===canWrite&&selected.organizationId===organizationId?selected:null;
  const selectionInstance=useRef<string|null>(null);
  selectionInstance.current=selection?.instance??null;
  const current=loaded?.key===key&&loaded.client===apiClient&&loaded.canWrite===canWrite?loaded:null;
  const targetKey=(row:Row)=>JSON.stringify([organizationId,row.projectId,row.configSetId]);
  const close=()=>{setSelected(null);requestAnimationFrame(()=>{if(trigger.current?.isConnected)trigger.current.focus();else document.querySelector<HTMLInputElement>('[aria-label="搜索项目使用"]')?.focus();});};
  const readTarget=async(row:Row)=>{
    if(!row.configSetId)throw new Error("目标配置不存在，请返回列表核对。");
    const request=new URLSearchParams({projectId:row.projectId,configSetId:row.configSetId,status:"all",limit:"1"});
    if(organizationId)request.set("organizationId",organizationId);
    const result=sharedDtsiProjectUsagesSchema.parse(await apiClient.get<unknown>(`/api/v2/shared-dtsi/project-usages?${request}`));
    return result.items.find(item=>item.projectId===row.projectId&&item.configSetId===row.configSetId);
  };
  const refreshTarget=async(row:Row,instance:string)=>{
    const invalidateTarget=()=>{
      if(selectionInstance.current!==instance)return;
      const target=targetKey(row);targetEpoch.current.set(target,(targetEpoch.current.get(target)??0)+1);
      setUnavailableTargets(previous=>new Set(previous).add(targetKey(row)));setReload(value=>value+1);
    };
    let updated:Row|undefined;
    try{updated=await readTarget(row);}
    catch(failure){if(failure instanceof WiseEffApiError && [401,403,404].includes(failure.status??0))invalidateTarget();throw failure;}
    if(!updated || !updated.canConfigure || !updated.configurationReady){invalidateTarget();throw new Error("配置不可用或权限已变化，请返回列表核对。");}
    if(selectionInstance.current!==instance)return updated.references;
    setUnavailableTargets(previous=>{const next=new Set(previous);next.delete(targetKey(row));return next;});
    setSelected(previous=>previous?.instance===instance&&previous.client===apiClient&&previous.organizationId===organizationId&&previous.scope===search&&previous.row.projectId===row.projectId&&previous.row.configSetId===row.configSetId
      ? {...previous,row:updated}:previous);
    setReload(value=>value+1);
    return updated.references;
  };
  const recheckTarget=async(row:Row)=>{
    const target=targetKey(row),scope=scopeEpoch.current,epoch=(targetEpoch.current.get(target)??0)+1;
    targetEpoch.current.set(target,epoch);setRechecking(target);setRecheckError("");
    const isCurrent=()=>scopeEpoch.current===scope&&targetEpoch.current.get(target)===epoch;
    try{
      const updated=await readTarget(row);
      if(!isCurrent())return;
      if(!updated||!updated.canConfigure||!updated.configurationReady){setRecheckError("配置仍不可用，请核对权限或初始化状态。");return;}
      setUnavailableTargets(previous=>{const next=new Set(previous);next.delete(target);return next;});setReload(value=>value+1);
    }catch{if(isCurrent())setRecheckError("无法重新核对配置，请稍后重试。");}
    finally{if(isCurrent())setRechecking(null);}
  };
  useEffect(()=>{
    let cancelled=false;
    const request=new URLSearchParams({q:query,status,offset:String((page-1)*20),limit:"20"});
    if(organizationId)request.set("organizationId",organizationId);
    void apiClient.get<unknown>(`/api/v2/shared-dtsi/project-usages?${request}`).then(value=>{
      const result=sharedDtsiProjectUsagesSchema.parse(value);
      if(!cancelled)setLoaded({key,client:apiClient,canWrite,result});
    }).catch(error=>{if(!cancelled)setLoaded({key,client:apiClient,canWrite,error:error instanceof WiseEffApiError?error.message:"无法读取项目使用情况，请重试。"});});
    return()=>{cancelled=true;};
  },[apiClient,canWrite,key,organizationId,page,query,status]);
  const update=(changes:Record<string,string>)=>{
    const next=new URLSearchParams(search);
    for(const [name,value] of Object.entries(changes)){if(value)next.set(name,value);else next.delete(name);}
    onNavigate(`/parameter-admin/sources?${next}`);
  };
  const follow=(event:MouseEvent<HTMLAnchorElement>,target:string)=>{
    if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();onNavigate(target);}
  };
  const usageReturn=`/parameter-admin/sources?${params}`;
  const sourcePath=(resourceId:string,versionId:string)=>{
    const target=new URLSearchParams(search);target.set("resource",resourceId);target.set("version",versionId);target.delete("tab");
    return `/parameter-admin/sources?${target}`;
  };
  const projectPath=(row:Row)=>{
    const target=new URLSearchParams({returnTo:usageReturn});
    if(organizationId)target.set("organization",organizationId);
    if(row.configSetId){target.set("configSet",row.configSetId);target.set("tab","effective");}
    return `/parameter-admin/projects/${encodeURIComponent(row.projectId)}/configuration?${target}`;
  };
  const resource=(ref:Row["references"][number])=>{
    const target=sourcePath(ref.resourceId,ref.versionId);
    return <span className="shared-dtsi-usage-resource" key={ref.resourceId}><a href={target} onClick={event=>follow(event,target)}>{ref.resourceName} · v{ref.version}</a>
      {ref.state==="retired"?<span>已停用</span>:null}{ref.upgradeAvailable?<span>有新版本</span>:null}</span>;
  };
  return <div className="shared-dtsi-page"><AdminListPage label="共享 DTSI" headerContent={header} headerActions={null}
    filterBar={<><SearchField className="shared-dtsi-list-search" ariaLabel="搜索项目使用" placeholder="搜索项目、配置或资源包" maxLength={160} value={query}
      onValueChange={value=>update({usageQuery:value,usagePage:""})} />
      <SelectControl ariaLabel="引用状态" size="filter" value={status} onValueChange={value=>update({usageStatus:value==="all"?"":value,usagePage:""})}
        options={[{value:"all",label:"全部引用状态"},{value:"referenced",label:"已引用"},{value:"unreferenced",label:"未引用"}]} /></>}
    notice={current?.result?.visibility==="authorized-projects"?<p>仅显示当前有权访问的项目配置。</p>:undefined}
    emptyState={{title:"没有匹配的项目配置",message:"请调整搜索或筛选条件。"}}
    tableState={!current?<SectionSkeleton label="正在加载项目使用情况" />:current.error?<SectionError message={appliedNotice?"资源包已加入配置，但列表刷新失败，请重试。":uncertainNotice?"应用结果尚未确认，列表刷新失败，请重试。":current.error} onRetry={()=>setReload(value=>value+1)} />:undefined}
    table={{rows:current?.result?.items??[],rowKey:row=>`${row.projectId}/${row.configSetId??""}`,pageSize:20,page:1,fluid:true,ariaLabel:"项目使用",tableClassName:"shared-dtsi-usage-table",
      columns:[
        {key:"project",header:"项目",render:row=><span className="shared-dtsi-usage-name">{row.projectName}</span>},
        {key:"configuration",header:"配置",render:row=>row.configSetName===null?"暂无配置":row.configSetName==="default"?"默认配置":row.configSetName},
        {key:"references",header:"已引用资源包",render:row=>{const direct=row.references.filter(ref=>ref.direct),dependencies=row.references.filter(ref=>!ref.direct||ref.requiredBy.length>0);
          return <div className="shared-dtsi-usage-references">{direct.length?direct.map(resource):<span>未引用共享资源包</span>}
            {dependencies.length?<details><summary>依赖关系（{dependencies.length}）</summary><ul>{dependencies.map(ref=><li key={ref.resourceId}>{resource(ref)}
              {ref.requiredBy.length?<span> · 由 {ref.requiredBy.map(item=>item.resourceName).join("、")} 引入</span>:null}</li>)}</ul></details>:null}</div>;}},
        {key:"action",header:"操作",render:row=>{const target=projectPath(row);return <div className="shared-dtsi-usage-action">
          {!row.configSetId?<span>请先创建配置</span>:!row.configurationReady?<span>请先完成配置初始化</span>:null}
          {unavailableTargets.has(targetKey(row))?<><span>配置不可用，请核对权限或初始化状态</span><Button variant="outline" size="sm" disabled={rechecking===targetKey(row)} onClick={()=>void recheckTarget(row)}>{rechecking===targetKey(row)?"正在核对…":"重新核对"}</Button></>:null}
          {row.configSetId && row.configurationReady && row.canConfigure&&!unavailableTargets.has(targetKey(row))?<Button variant="outline" size="sm" onClick={event=>{trigger.current=event.currentTarget;setAppliedNotice(false);setUncertainNotice(false);setSelected({row,adding:false,scope:search,client:apiClient,canWrite,organizationId,instance:crypto.randomUUID()});}}>配置资源包</Button>:null}
          <a href={target} onClick={event=>follow(event,target)}>{row.configSetId&&row.configurationReady?"查看生效配置":"前往配置工作台"}</a></div>;}}
      ]}} />
    {current?.result && current.result.total>20?<nav className="shared-dtsi-pagination" aria-label="项目使用分页">
      <Button variant="outline" disabled={page===1} onClick={()=>update({usagePage:page===2?"":String(page-1)})}>上一页</Button>
      <span>{page} / {Math.ceil(current.result.total/20)}</span><Button variant="outline" disabled={page*20>=current.result.total} onClick={()=>update({usagePage:String(page+1)})}>下一页</Button>
    </nav>:null}
    {appliedNotice?<p role="status">资源包已加入配置。</p>:uncertainNotice?<p role="status">应用结果尚未确认，请核对项目配置后再操作。</p>:null}
    {recheckError?<p role="alert">{recheckError}</p>:null}
    {selection&&!selection.adding?<ModalDialog open className="workbench-member-addition-dialog" backdropClassName="param-admin-modal-backdrop" onDismiss={close}>
      {({titleId})=><><header><div><h2 id={titleId}>配置资源包</h2><p>{selection.row.projectName} · {selection.row.configSetName==="default"?"默认配置":selection.row.configSetName}</p></div>
        <Button variant="outline" onClick={close}>关闭</Button></header>
        <div className="workbench-member-addition-dialog__body"><h3>已引用资源包</h3>
          {selection.row.references.some(ref=>ref.direct)?<ul>{selection.row.references.filter(ref=>ref.direct).map(ref=><li key={ref.resourceId}>{ref.resourceName} · v{ref.version}</li>)}</ul>:<p>未引用共享资源包</p>}
          <Button onClick={()=>setSelected({...selection,adding:true})}>添加资源包</Button></div></>}
    </ModalDialog>:null}
    {selection?.adding&&selection.row.configSetId?<WorkbenchMemberAdditionDialog projectId={selection.row.projectId}
      configSets={[{id:selection.row.configSetId,name:selection.row.configSetName??""}]} initialConfigSetId={selection.row.configSetId} availableFiles={[]}
      client={additionClient} sharedClient={sharedClient} sharedOnly existingReferences={selection.row.references} targetProjectName={selection.row.projectName}
      refreshExistingReferences={()=>refreshTarget(selection.row,selection.instance)}
      onDismiss={()=>{if(unavailableTargets.has(targetKey(selection.row)))close();else setSelected({...selection,adding:false});}} onUncertainDismiss={()=>{setUncertainNotice(true);close();setReload(value=>value+1);}}
      onApplied={()=>{setAppliedNotice(true);close();setReload(value=>value+1);}} />:null}
  </div>;
}

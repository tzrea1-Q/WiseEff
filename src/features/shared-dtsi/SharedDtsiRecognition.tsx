import { useEffect, useState } from "react";
import type { SharedDtsiRecognition as Recognition } from "@wiseeff/dto-schemas";
import type { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { buildCatalogHref, CATALOG_READ_PAGE_PATH, EMPTY_CATALOG_URL_ANCHOR, serializeCatalogUrlAnchor } from "@/application/parameter-catalog/urlAnchor";

export function sharedRecognitionSourceHref(source: Recognition["items"][number]["source"], organizationId?: string,projectContext?:string|null) {
  const params=new URLSearchParams({resource:source.resourceId,version:source.versionId,member:source.memberId,line:String(source.line),tab:"source"});
  if(organizationId)params.set("organizationId",organizationId);
  if(projectContext && /^\/parameter-admin\/projects\/[^/?#]+\/configuration\?/.test(projectContext))params.set("projectContext",projectContext);
  return `/parameter-admin/sources?${params}`;
}

export function SharedDtsiRecognition({client,resourceId,versionId,canWrite,canCreateSubject,canProposeSource,canReviewSource,returnPath,organizationId,onNavigate}: {
  client:ReturnType<typeof createSharedDtsiClient>;resourceId:string;versionId:string;canWrite:boolean;canCreateSubject:boolean;canProposeSource:boolean;canReviewSource:boolean;returnPath:string;organizationId?:string;onNavigate:(href:string)=>void;
}) {
  const [state,setState]=useState<{key:string;data?:Recognition;error?:string}>({key:""});
  const [retry,setRetry]=useState(0);
  const key=`${resourceId}:${versionId}`;
  useEffect(()=>{
    let cancelled=false;setState({key});
    void client.recognition(resourceId,versionId).then(data=>{if(!cancelled)setState({key,data});})
      .catch(error=>{if(!cancelled)setState({key,error:presentError(error,"来源识别暂不可用。")});});
    return()=>{cancelled=true;};
  },[client,resourceId,versionId,key,retry]);
  if(state.key!==key || !state.data&&!state.error)return <SectionSkeleton label="正在读取固定版本的来源识别" />;
  if(state.error)return <SectionError message={state.error} onRetry={()=>setRetry(value=>value+1)} />;
  const data=state.data!;
  const projectContext=new URLSearchParams(returnPath.split("?")[1]).get("projectContext");
  const follow=(href:string)=>(event:React.MouseEvent<HTMLAnchorElement>)=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(href);}};
  return <section className="shared-dtsi-recognition" aria-label="固定版本来源识别">
    <p className="shared-dtsi-hint">compatible 标识用于匹配正式主体；节点标签仅表示源码定位。源码值不会自动成为参数定义。</p>
    {!data.catalogReleaseId?<p role="status">正式目录暂不可用，仍可查看固定版本的来源证据。</p>:null}
    {!data.items.length?<SectionEmpty message="此固定版本没有 compatible 声明。可继续查看源码及项目配置。" />:<ul>{data.items.map((item,index)=><li key={`${item.nodeLocator}:${index}`}>
      <h3><code>{item.nodeLocator}</code>{item.unresolved?<span> · 待项目补充上下文</span>:null}</h3>
      {item.candidate.status==="ambiguous"?<p>此节点的多个 compatible 标识匹配不同主体，需核对识别依据。</p>:null}
      {item.labels.length?<p>节点标签：{item.labels.join("、")}</p>:null}
      <a href={sharedRecognitionSourceHref(item.source,organizationId,projectContext)} onClick={follow(sharedRecognitionSourceHref(item.source,organizationId,projectContext))}>{item.source.sourceName}:{item.source.line} · v{item.source.version}</a>
      <ul>{item.compatibles.map((entry,entryIndex)=>{
        const createParams=new URLSearchParams({createSubject:"1",sourceResource:resourceId,sourceVersion:versionId,sourceNode:item.nodeLocator,compatible:entry.compatible});
        createParams.set("sourceReturn",returnPath);
        if(organizationId)createParams.set("organizationId",organizationId);
        const createHref=`/parameter-admin/modules?${createParams}`;
        return <li key={entry.compatible}><code>{entry.compatible}</code><span>{{recognized:"已匹配正式主体",unknown:"尚未识别",ambiguous:"存在多个候选，需复核",retired:"主体已停用",unavailable:"等待正式目录恢复"}[entry.status]}</span>
          {entry.subjectIds.map(subjectId=>{
            const anchor={...EMPTY_CATALOG_URL_ANCHOR,subjectId,catalogReleaseId:data.catalogReleaseId};
            const href=(canWrite?buildCatalogHref(anchor):`${CATALOG_READ_PAGE_PATH}${serializeCatalogUrlAnchor(anchor)}`);
            const params=new URLSearchParams(href.split("?")[1]);if(organizationId)params.set("organizationId",organizationId);
            params.set("sourceReturn",returnPath);
            const target=`${href.split("?")[0]}?${params}`;
            return <a key={subjectId} href={target} onClick={follow(target)}>{entry.status==="recognized"?"查看主体与定义":"查看候选主体"}</a>;
          })}
          {canCreateSubject && item.candidate.status==="unknown" && entry.status==="unknown"?<a href={createHref} onClick={follow(createHref)}>识别并创建主体</a>:null}
          {(canProposeSource||canReviewSource) && entryIndex===0 && (item.candidate.status==="ambiguous"||item.candidate.status==="retired")?<a href={`${createHref}&sourceProposal=1`} onClick={follow(`${createHref}&sourceProposal=1`)}>{canProposeSource?"记录识别修订":"查看识别修订"}</a>:null}
        </li>;
      })}</ul>
    </li>)}</ul>}
  </section>;
}

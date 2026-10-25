import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { PublicationDialog, type PublicationDialogProps } from "@/features/parameter-catalog-governance/PublicationDialog";
import { sharedRecognitionSourceHref } from "./SharedDtsiRecognition";

/** URL values select evidence to re-read; they never themselves become trusted source facts. */
export function SharedDtsiSubjectCreation({apiClient,sourceQuery,publicationProps}: {
  apiClient?:ApiClient;sourceQuery:string|null;publicationProps:PublicationDialogProps;
}) {
  const client=useMemo(()=>apiClient?createSharedDtsiClient(apiClient):null,[apiClient]);
  const [state,setState]=useState<{key:string;source?:PublicationDialogProps["sourcePrefill"];error?:string}>({key:""});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(sourceQuery===null)return;
    let cancelled=false;setState({key:sourceQuery});
    const params=new URLSearchParams(sourceQuery);
    const resource=params.get("sourceResource"),version=params.get("sourceVersion"),node=params.get("sourceNode"),compatible=params.get("compatible");
    if(!client || !resource || !version || !node || !compatible){setState({key:sourceQuery,error:"来源上下文不完整，请返回共享版本重新进入。"});return;}
    void client.recognition(resource,version).then(result=>{
      const item=result.items.find(item=>item.nodeLocator===node && item.compatibles.some(entry=>entry.compatible===compatible));
      if(!item)throw new Error("来源与 compatible 标识不匹配，请返回固定版本重新识别。");
      const match=item.compatibles.find(entry=>entry.compatible===compatible)!;
      if(match.status!=="unknown")throw new Error("识别结果已变化，请返回来源核对正式主体或候选。");
      if(!cancelled)setState({key:sourceQuery,source:{compatible,label:`${item.source.sourceName}:${item.source.line} · v${item.source.version} · ${item.nodeLocator}`,
        href:sharedRecognitionSourceHref(item.source,params.get("organizationId")??undefined)}});
    }).catch(error=>{if(!cancelled)setState({key:sourceQuery,error:error instanceof Error?error.message:presentError(error,"无法核对来源，请重试。")});});
    return()=>{cancelled=true;};
  },[client,sourceQuery,retry]);
  if(sourceQuery===null)return <PublicationDialog {...publicationProps}/>;
  if(state.key!==sourceQuery || !state.source&&!state.error)return <SectionSkeleton label="正在核对固定版本来源"/>;
  if(state.error)return <SectionError message={state.error} onRetry={()=>setRetry(value=>value+1)}/>;
  return <PublicationDialog {...publicationProps} sourcePrefill={state.source}/>;
}

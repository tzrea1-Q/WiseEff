import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { PublicationDialog, type PublicationDialogProps } from "@/features/parameter-catalog-governance/PublicationDialog";
import { sharedRecognitionSourceHref } from "./SharedDtsiRecognition";
import { ProposalPanel } from "@/features/parameter-catalog-governance/ProposalPanel";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { Button } from "@/components/ui/button";

/** URL values select evidence to re-read; they never themselves become trusted source facts. */
export function SharedDtsiSubjectCreation({apiClient,sourceQuery,publicationProps}: {
  apiClient?:ApiClient;sourceQuery:string|null;publicationProps:PublicationDialogProps;
}) {
  const client=useMemo(()=>apiClient?createSharedDtsiClient(apiClient):null,[apiClient]);
  const [state,setState]=useState<{key:string;source?:PublicationDialogProps["sourcePrefill"];error?:string}>({key:""});
  const [retry,setRetry]=useState(0);
  const [dirty,setDirty]=useState(false);
  const [pending,setPending]=useState(false);
  const key=`${publicationProps.organizationId}:${sourceQuery??""}`;
  useEffect(()=>{
    if(sourceQuery===null)return;
    let cancelled=false;setState({key});
    const params=new URLSearchParams(sourceQuery);
    const resource=params.get("sourceResource"),version=params.get("sourceVersion"),node=params.get("sourceNode"),compatible=params.get("compatible");
    if(!client || !resource || !version || !node || !compatible){setState({key,error:"来源上下文不完整，请返回共享版本重新进入。"});return;}
    void client.recognition(resource,version).then(result=>{
      const item=result.items.find(item=>item.nodeLocator===node && item.compatibles.some(entry=>entry.compatible===compatible));
      if(!item)throw new Error("来源与 compatible 标识不匹配，请返回固定版本重新识别。");
      const match=item.compatibles.find(entry=>entry.compatible===compatible)!;
      if(params.get("sourceProposal")!=="1" && item.candidate.status!=="unknown")throw new Error("识别结果已变化，请返回来源核对正式主体或候选。");
      if(match.status==="unavailable")throw new Error("正式目录暂不可用，请稍后重试。");
      const projectContext=new URLSearchParams(params.get("sourceReturn")?.split("?")[1]).get("projectContext");
      if(!cancelled)setState({key,source:{compatible,reference:{resourceId:resource,versionId:version,nodeLocator:node,compatible},label:`${item.source.sourceName}:${item.source.line} · v${item.source.version} · ${item.nodeLocator}`,
        href:sharedRecognitionSourceHref(item.source,params.get("organizationId")??undefined,projectContext)}});
    }).catch(error=>{if(!cancelled)setState({key,error:error instanceof Error?error.message:presentError(error,"无法核对来源，请重试。")});});
    return()=>{cancelled=true;};
  },[client,sourceQuery,key,retry]);
  if(sourceQuery===null)return <PublicationDialog {...publicationProps}/>;
  if(state.key!==key || !state.source&&!state.error)return <SectionSkeleton label="正在核对固定版本来源"/>;
  if(state.error)return <><SectionError message={state.error} onRetry={()=>setRetry(value=>value+1)}/><Button variant="outline" onClick={()=>publicationProps.onOpenChange(false)}>返回来源识别</Button></>;
  const close=()=>{void (async()=>{if(await requestSettingsLeave())publicationProps.onOpenChange(false);})();};
  if(new URLSearchParams(sourceQuery).get("sourceProposal")==="1")return <><ModalDialog open className="confirm-dialog governance-confirm-dialog" onDismiss={pending?undefined:close}>
    {({titleId})=><><h2 id={titleId}>来源识别修订</h2><div className="confirm-dialog__scroll">
    <ProposalPanel actor={publicationProps.actor} domainState={publicationProps.domainState} repository={publicationProps.governance}
      catalogReleaseId={publicationProps.catalogReleaseId} currentPersonId={publicationProps.currentPersonId} source={state.source} onDirtyChange={setDirty} onPendingChange={setPending}/>
    </div><div className="confirm-dialog__actions"><Button variant="outline" disabled={pending} onClick={close}>返回来源识别</Button></div></>}
  </ModalDialog><SettingsLeaveGuard dirty={dirty} saving={pending} description="离开将放弃尚未保存的识别修订说明。"/></>;
  return <PublicationDialog {...publicationProps} sourcePrefill={state.source}/>;
}

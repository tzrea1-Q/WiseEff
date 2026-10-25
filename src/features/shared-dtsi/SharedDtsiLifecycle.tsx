import { useState } from "react";
import type { SharedDtsiLifecycleInput, SharedDtsiResourceDetail } from "@wiseeff/dto-schemas";
import type { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";

export function SharedDtsiLifecycle({ client, resource, canWrite, pending, onPending, onChanged }: {
  client: ReturnType<typeof createSharedDtsiClient>; resource: SharedDtsiResourceDetail; canWrite: boolean; pending: boolean;
  onPending: (value: boolean) => void; onChanged: (resource: SharedDtsiResourceDetail) => void;
}) {
  const [request,setRequest]=useState<SharedDtsiLifecycleInput|null>(null),[error,setError]=useState("");
  const [stale,setStale]=useState(false),[restored,setRestored]=useState(false);
  const retired=resource.state==="retired",label=retired?"恢复资源":"停用资源";
  async function confirm() {
    if(!request||pending)return;
    onPending(true);setError("");
    try {onChanged(await client.lifecycle(resource.resourceId,request));setRestored(request.state==="active");setRequest(null);}
    catch(cause){setError(presentError(cause,"未能确认资源状态，请重试。"));setStale(cause instanceof WiseEffApiError&&cause.code==="CONFLICT");}
    finally{onPending(false);}
  }
  async function reload() {
    onPending(true);setError("");
    try{onChanged(await client.detail(resource.resourceId));setRequest(null);setStale(false);}
    catch(cause){setError(presentError(cause,"无法载入资源状态，请重试。"));}
    finally{onPending(false);}
  }
  return <>
    {retired?<p role="status">资源已停用 · 既有固定引用与历史版本可继续读取，不能新增直接或传递引用。</p>:null}
    {!retired&&restored?<p role="status">资源已恢复，可再次建立新引用。</p>:null}
    {canWrite?<div className="shared-dtsi-version-actions"><Button variant="outline" disabled={pending} onClick={()=>{
      setError("");setStale(false);setRequest({state:retired?"active":"retired",expectedLifecycleRevision:resource.lifecycleRevision,idempotencyKey:crypto.randomUUID()});
    }}>{label}</Button></div>:null}
    <ConfirmDialog open={Boolean(request)} title={`${label}？`} description={retired
      ?"恢复后可再次新增直接和传递引用，沿用同一资源身份及已发布版本。"
      :"停用后不能新增直接或传递引用，也不能用于新的共享发布。既有项目固定引用、历史导出及合法快照恢复会保留。此操作不移除 Catalog 组织登记，也不禁用项目节点。"}
      confirmLabel={label} cancelLabel="取消" tone={retired?"primary":"danger"} pending={pending} confirmDisabled={stale} error={error}
      onCancel={()=>{if(!pending)setRequest(null);}} onConfirm={()=>void confirm()}
      extra={stale?<Button variant="outline" disabled={pending} onClick={()=>void reload()}>重新载入状态</Button>:null} />
  </>;
}

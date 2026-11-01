import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import type { createMemberAdditionIntentClient, MemberAdditionIntent } from "@/infrastructure/http/memberAdditionIntentClient";
import { currentSharedOperationSession } from "@/application/project-configuration/sharedOperationSession";
import "./workbench-member-addition-dialog.css";

export function SharedMemberPendingOperations({client,scope,refresh,onResolved,focus,onClearFocus}:{client:ReturnType<typeof createMemberAdditionIntentClient>;scope:string;refresh:number;onResolved:()=>void;focus?:{projectId:string;configSetId:string};onClearFocus?:()=>void}){
  const focusKey=JSON.stringify(focus??null);
  const [page,setPage]=useState(0),[reload,setReload]=useState(0),[loaded,setLoaded]=useState<{scope:string;focusKey:string;page:number;items:MemberAdditionIntent[];total:number}|null>(null);
  const [error,setError]=useState(""),[selected,setSelected]=useState<MemberAdditionIntent|null>(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState("");
  const viewKey=JSON.stringify([scope,focusKey,page]);
  const active=useRef(viewKey);active.current=viewKey;
  useEffect(()=>{let current=true;const session=currentSharedOperationSession();setError("");const request=focus?client.target(focus.projectId,focus.configSetId):client.list(page*50);void request.then(result=>{if(current&&session===currentSharedOperationSession()){if(!focus&&page>0&&result.items.length===0)setPage(Math.max(0,Math.ceil(result.total/50)-1));else setLoaded({scope,focusKey,page,...result});}}).catch(()=>{if(current&&session===currentSharedOperationSession())setError("无法读取待核对操作，请重试。");});return()=>{current=false;};},[client,scope,page,reload,refresh,focus,focusKey]);
  useEffect(()=>{setSelected(null);setBusy(false);setActionError("");},[viewKey]);
  useEffect(()=>{setPage(0);},[scope]);
  const list=loaded?.scope===scope&&loaded.focusKey===focusKey&&loaded.page===page?loaded:null;
  if(error)return <section className="shared-member-pending" aria-label="待核对操作"><p role="alert">{error}</p><Button variant="outline" onClick={()=>setReload(value=>value+1)}>重试</Button></section>;
  if(!list?.items.length)return focus&&list?<section className="shared-member-pending" aria-label="待核对操作"><p>此配置没有待核对操作。</p><Button variant="outline" onClick={onClearFocus}>查看全部</Button></section>:null;
  const act=async(item:MemberAdditionIntent,action:"stop"|"ack")=>{
    if(busy)return;const started=viewKey,session=currentSharedOperationSession();setBusy(true);setActionError("");
    try{
      const result=action==="stop"?await client.stop(item):await client.acknowledge(item);
      if(active.current!==started||session!==currentSharedOperationSession())return;
      if(action==="stop")setSelected(result);else setSelected(null);
      setReload(value=>value+1);onResolved();
    }catch{if(active.current===started&&session===currentSharedOperationSession())setActionError("无法确认操作结果，请稍后重试。");}
    finally{if(active.current===started&&session===currentSharedOperationSession())setBusy(false);}
  };
  return <section className="shared-member-pending" aria-label="待核对操作"><h2>待核对操作</h2>{focus?<Button size="sm" variant="outline" onClick={onClearFocus}>查看全部</Button>:null}<ul>{list.items.map(item=><li key={item.id}>
    <span>{item.projectName} · {item.configSetName==="default"?"默认配置":item.configSetName}：</span>
    <span>{item.status==="pending"?"结果尚未确认":item.status==="applied"?"已应用":"已停止"}</span>{" "}
    <Button size="sm" variant="outline" onClick={()=>{setActionError("");setSelected(item);}}>核对</Button>
  </li>)}</ul>{!focus&&list.total>50?<nav aria-label="待核对操作分页"><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(value=>value-1)}>上一页</Button><span>{page+1} / {Math.ceil(list.total/50)}</span><Button variant="outline" size="sm" disabled={(page+1)*50>=list.total} onClick={()=>setPage(value=>value+1)}>下一页</Button></nav>:null}
  {selected?<ModalDialog open className="workbench-member-addition-dialog" backdropClassName="param-admin-modal-backdrop" onDismiss={busy?undefined:()=>setSelected(null)}>{({titleId})=><>
    <header><div><h2 id={titleId}>核对操作</h2><p>{selected.projectName} · {selected.configSetName==="default"?"默认配置":selected.configSetName}</p></div><Button variant="outline" disabled={busy} onClick={()=>setSelected(null)}>关闭</Button></header>
    <div className="workbench-member-addition-dialog__body"><p>{selected.status==="pending"?"操作结果尚未确认。停止后，即使原请求仍在途中，也不会再执行；如果已经应用，会显示实际结果。":selected.status==="applied"?"操作已应用。":"操作已停止，不会再执行。"}</p>{actionError?<p role="alert">{actionError}</p>:null}</div>
    <footer><Button disabled={busy} onClick={()=>void act(selected,selected.status==="pending"?"stop":"ack")}>{busy?"正在核对…":selected.status==="pending"?"确认停止":"知道了"}</Button></footer>
  </>}</ModalDialog>:null}</section>;
}

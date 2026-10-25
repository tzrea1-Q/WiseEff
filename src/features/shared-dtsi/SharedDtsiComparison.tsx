import { useEffect, useState } from "react";
import type { SharedDtsiComparison as Comparison } from "@wiseeff/dto-schemas";
import type { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { SectionError, SectionSkeleton, SectionEmpty } from "@/components/common/SectionState";
import { SelectControl } from "@/components/common/SelectControl";
import { ReviewSourceDiff } from "@/features/parameter-review/ReviewSourceDiff";
import { ViewSwitch } from "@/components/ui/view-switch";
import { presentError } from "@/infrastructure/http/presentError";
import "@/features/parameter-review/parameter-review.css";

export function SharedDtsiComparison({client,resourceId,before,after}:{client:ReturnType<typeof createSharedDtsiClient>;resourceId:string;before:string;after:string}) {
  const [result,setResult]=useState<Comparison|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [view,setView]=useState("source"),[file,setFile]=useState("0");
  useEffect(()=>{
    let active=true;setResult(null);setError("");
    void client.compare(resourceId,before,after).then(value=>{if(active)setResult(value);})
      .catch(cause=>{if(active)setError(presentError(cause,"无法比较所选版本。"));});
    return()=>{active=false;};
  },[client,resourceId,before,after,retry]);
  if(error)return <SectionError message={error} onRetry={()=>setRetry(value=>value+1)} />;
  if(!result)return <SectionSkeleton label="正在比较所选版本" />;
  const source=result.sources[Number(file)];
  return <section className="shared-dtsi-comparison" aria-label={`比较 v${result.before.version} 与 v${result.after.version}`}>
    {JSON.stringify(result.dependencies.before)!==JSON.stringify(result.dependencies.after)?<details><summary>固定依赖变化</summary>
      {(["before","after"] as const).map(side=><div key={side}><h3>{side==="before"?`v${result.before.version}`:`v${result.after.version}`}</h3>
        {result.dependencies[side].length?<ul>{result.dependencies[side].map(pin=><li key={pin.resourceId}>{pin.name} · v{pin.version} · {pin.mountPath||"资源根目录"}</li>)}</ul>:<p>没有固定资源依赖。</p>}</div>)}
    </details>:null}
    <ViewSwitch variant="toggle" ariaLabel="版本差异类型" value={view} onValueChange={setView} items={[{value:"source",label:"原始源码"},{value:"semantic",label:"语义声明"}]} />
    {view==="source" ? result.sources.length ? <>
      <label className="shared-dtsi-compare-file">变更文件<SelectControl ariaLabel="比较文件" value={file} onValueChange={setFile}
        options={result.sources.map((item,index)=>({value:String(index),label:`${item.resourceId===resourceId?"":`${item.resourceName} · `}${item.before?.sourceName===item.after?.sourceName?item.after?.sourceName:`${item.before?.sourceName??"新增"} → ${item.after?.sourceName??"移除"}`}`}))} /></label>
      {source?<ReviewSourceDiff before={source.before?.content??""} after={source.after?.content??""} label="共享原始源码" virtualized />:null}
    </>:<SectionEmpty title="原始源码没有变化" message="所选版本的文件内容和路径一致。" />
      :<><p>按真实 include 和声明顺序比较节点、标签、类型化属性值和删除操作；忽略注释与数值写法。项目最终效果与兼容性尚未评估。</p>
        {result.semantic.externalReferences.length?<p>项目需提供的外部引用：{result.semantic.externalReferences.join("、")}</p>:null}
        <ReviewSourceDiff before={result.semantic.before} after={result.semantic.after} label="有序语义声明" unchangedMessage="语义声明没有变化。" virtualized /></>}
  </section>;
}

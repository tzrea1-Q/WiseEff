import { useEffect, useState } from "react";
import type { SharedDtsiComparison as Comparison, SharedDtsiPendingComparison } from "@wiseeff/dto-schemas";
import type { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { SectionError, SectionSkeleton, SectionEmpty } from "@/components/common/SectionState";
import { SelectControl } from "@/components/common/SelectControl";
import { ReviewSourceDiff } from "@/features/parameter-review/ReviewSourceDiff";
import { ViewSwitch } from "@/components/ui/view-switch";
import { presentError } from "@/infrastructure/http/presentError";
import "@/features/parameter-review/parameter-review.css";

export function SharedDtsiComparison({client,resourceId,before,after,showVersionLabel=true}:{client:ReturnType<typeof createSharedDtsiClient>;resourceId:string;before:string;after:string;showVersionLabel?:boolean}) {
  const [result,setResult]=useState<Comparison|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;setResult(null);setError("");
    void client.compare(resourceId,before,after).then(value=>{if(active)setResult(value);})
      .catch(cause=>{if(active)setError(presentError(cause,"无法比较所选版本。"));});
    return()=>{active=false;};
  },[client,resourceId,before,after,retry]);
  if(error)return <SectionError message={error} onRetry={()=>setRetry(value=>value+1)} />;
  if(!result)return <SectionSkeleton label="正在比较所选版本" />;
  return <SharedDtsiComparisonContent result={result} resourceId={resourceId} beforeLabel={`v${result.before.version}`} afterLabel={`v${result.after.version}`} showVersionLabel={showVersionLabel} />;
}

export function SharedDtsiComparisonContent({result,resourceId,beforeLabel,afterLabel,initialPublication=false,currentExternalReferences,showVersionLabel=true}:{result:Pick<Comparison,"sources"|"buildInputs"|"dependencies"|"semantic">|SharedDtsiPendingComparison;resourceId:string;beforeLabel:string;afterLabel:string;initialPublication?:boolean;currentExternalReferences?:string[];showVersionLabel?:boolean}) {
  const [view,setView]=useState("source"),[file,setFile]=useState("0");
  const labels={before:beforeLabel,after:afterLabel};
  const source=result.sources[Number(file)];
  const previousReferences=currentExternalReferences===undefined?[]:result.semantic.externalReferences.filter(reference=>!currentExternalReferences.includes(reference));
  const fileLabel=(item:typeof result.sources[number])=>`${item.resourceId===resourceId?"":`${item.resourceName} · `}${!item.before&&!item.after?"文件不可用":!item.before?`新增 ${item.after!.sourceName}`:!item.after?`移除 ${item.before.sourceName}`:item.before.sourceName===item.after.sourceName?item.after.sourceName:`${item.before.sourceName} → ${item.after.sourceName}`}`;
  const buildInputsChanged=JSON.stringify(result.buildInputs.before.includeSearchPaths)!==JSON.stringify(result.buildInputs.after.includeSearchPaths)
    || Object.keys({...result.buildInputs.before.defines,...result.buildInputs.after.defines}).some(name=>result.buildInputs.before.defines[name]!==result.buildInputs.after.defines[name]);
  return <section className="shared-dtsi-comparison" aria-label={showVersionLabel?`${beforeLabel} → ${afterLabel}`:"变更对比"}>
    <div className="shared-dtsi-comparison-heading"><h2>变更对比</h2>{showVersionLabel?<span>{initialPublication?"首次发布":`${beforeLabel} → ${afterLabel}`}</span>:null}</div>
    {!initialPublication&&buildInputsChanged?<details><summary>构建设置变化</summary>
      {(["before","after"] as const).map(side=><div key={side}><h3>{labels[side]}</h3><dl className="shared-dtsi-metadata">
        <div><dt>搜索目录</dt><dd>{result.buildInputs[side].includeSearchPaths.join("、")||"资源目录"}</dd></div>
        <div><dt>预处理宏</dt><dd>{Object.entries(result.buildInputs[side].defines).map(([name,value])=>`${name}=${value}`).join("\n")||"未声明"}</dd></div>
      </dl></div>)}
    </details>:null}
    {!initialPublication&&JSON.stringify(result.dependencies.before)!==JSON.stringify(result.dependencies.after)?<details><summary>固定依赖变化</summary>
      {(["before","after"] as const).map(side=><div key={side}><h3>{labels[side]}</h3>
        {result.dependencies[side].length?<ul>{result.dependencies[side].map(pin=><li key={pin.resourceId}>{pin.name} · v{pin.version} · {pin.mountPath||"资源根目录"}</li>)}</ul>:<p>没有固定资源依赖。</p>}</div>)}
    </details>:null}
    <ViewSwitch variant="toggle-outline" ariaLabel="版本差异类型" value={view} onValueChange={setView} items={[{value:"source",label:"原始源码"},{value:"semantic",label:"语义声明"}]} />
    {view==="source" ? result.sources.length ? <>
      {result.sources.length>1?<label className="shared-dtsi-compare-file">变更文件<SelectControl ariaLabel="比较文件" value={file} onValueChange={setFile}
        options={result.sources.map((item,index)=>({value:String(index),label:fileLabel(item)}))} /></label>:source?<p className="shared-dtsi-compare-single"><span>变更文件</span><code>{fileLabel(source)}</code></p>:null}
      {source?.before||source?.after?<ReviewSourceDiff before={source.before?.content??""} after={source.after?.content??""} beforeMissing={!source.before} afterMissing={!source.after} label="共享原始源码" legendLabel="源码差异" virtualized />:source?<p role="alert">文件信息不完整，无法显示差异。</p>:null}
    </>:<SectionEmpty title="原始源码没有变化" message="所选版本的文件内容和路径一致。" />
      :<><p>按真实 include 和声明顺序比较节点、标签、类型化属性值和删除操作；忽略注释与数值写法。项目最终效果与兼容性尚未评估。</p>
        {currentExternalReferences===undefined&&result.semantic.externalReferences.length?<p>两个版本涉及的外部引用：{result.semantic.externalReferences.join("、")}</p>:null}
        {previousReferences.length?<p>仅旧版本中的引用：{previousReferences.join("、")}</p>:null}
        <ReviewSourceDiff before={result.semantic.before} after={result.semantic.after} beforeMissing={initialPublication} label="有序语义声明" legendLabel="声明差异" unchangedMessage="语义声明没有变化。" virtualized /></>}
  </section>;
}

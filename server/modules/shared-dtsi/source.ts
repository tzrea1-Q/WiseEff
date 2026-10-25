import { createHash } from "node:crypto";
import { ApiError } from "../../shared/http/errors";
import { lexDts, offsetToLineColumn, parseDts, parseDtsValue, type DtsNodeCst } from "../dts";
import { expandDtsIncludes, resolveIncludeTarget } from "../dts/configSetResolver";
import { dtsReferencePath } from "../../../src/domain/dts/reference";
import type { SharedDtsiDraft, SharedDtsiManifest } from "../contracts/dtoSchemas/sharedDtsi";

export function sharedDtsiPublicationSource(draft: SharedDtsiDraft) {
  if (!draft.changeDescription.trim()) throw new ApiError("VALIDATION_FAILED","请填写变更说明后再预览发布。");
  const byName = new Map(draft.members.map(member=>[member.sourceName,member]));
  const files = new Map(draft.members.map(member=>[member.sourceName,{content:member.content,fileVersionId:member.id}]));
  const reject=(sourceName:string,offset:number,message:string):never=>{
    const location=offsetToLineColumn(byName.get(sourceName)!.content,offset);
    throw new ApiError("VALIDATION_FAILED",`${sourceName}:${location.line}:${location.column}：${message}`,
      {diagnostics:[{sourceName,...location,message}]});
  };
  const graph: SharedDtsiManifest["includeGraph"] = [], included = new Set<string>();
  for (const member of draft.members.filter(value=>/\.dtsi?$/u.test(value.sourceName))) {
    let tokens;
    try { tokens=lexDts(member.content); }
    catch (error) { const message=error instanceof Error?error.message:"设备树语法无效。";reject(member.sourceName,Number(/offset (\d+)/u.exec(message)?.[1]??0),message); }
    for (let i=0;i<tokens!.length;i++) {
      const token=tokens![i]!,next=tokens![i+1];
      const directive=token.value==="#" && next?.kind==="ident"?`#${next.value}`:token.value;
      if (token.kind==="ident" && /^#(?:include|include_next|define|undef|if|ifdef|ifndef|elif|else|endif|pragma|line|error|warning|embed)$/u.test(directive))
        reject(member.sourceName,token.span.start,"此源码需要尚未接入的 C 预处理，不能直接发布。");
      if (token.kind!=="directive") continue;
      if (token.value==="/include/") {
        if (next?.kind!=="string") reject(member.sourceName,token.span.start,"include 需要双引号中的相对路径。");
        const requested=next!.value.slice(1,-1), target=resolveIncludeTarget(member.sourceName,requested,[],files);
        if (!target.ok) reject(member.sourceName,token.span.start,target.code==="path-escape"?`依赖路径 ${requested} 逃逸资源目录。`:`缺少依赖文件 ${requested}。`);
        if (!target.ok) continue;
        if (!/\.dtsi?$/u.test(target.fileName)) reject(member.sourceName,token.span.start,`头文件 ${target.fileName} 需要 C 预处理，不能作为普通 DTSI 解析。`);
        graph.push({sourceName:member.sourceName,target:target.fileName,...offsetToLineColumn(member.content,token.span.start)});
        included.add(target.fileName);
      } else if (!["/dts-v1/","/delete-node/","/delete-property/","/bits/","/omit-if-no-ref/"].includes(token.value))
        reject(member.sourceName,token.span.start,`当前共享发布不支持 ${token.value} 指令。`);
    }
  }
  const depths=new Map<string,number>();
  const visitGraph=(sourceName:string,stack:string[]):number=>{
    const known=depths.get(sourceName);if(known!==undefined)return known;
    let depth=1;
    for (const edge of graph.filter(value=>value.sourceName===sourceName)) {
      const cycle=stack.includes(edge.target);
      const childDepth=cycle?0:visitGraph(edge.target,[...stack,edge.target]);
      if (cycle || childDepth>=16) {
        const lines=byName.get(sourceName)!.content.split("\n");
        const offset=lines.slice(0,edge.line-1).reduce((total,line)=>total+line.length+1,0)+edge.column-1;
        reject(sourceName,offset,cycle?`include 循环：${[...stack,edge.target].join(" → ")}。`:"include 嵌套超过 16 层。");
      }
      depth=Math.max(depth,childDepth+1);
    }
    depths.set(sourceName,depth);return depth;
  };
  for (const member of draft.members) visitGraph(member.sourceName,[member.sourceName]);
  const labels=new Set<string>(),references=new Set<string>(),paths=new Set<string>();
  const roots=draft.members.filter(member=>/\.dtsi?$/u.test(member.sourceName) && !included.has(member.sourceName));
  let declarations=0,expandedBytes=0;
  for (const root of roots) {
    let expanded:ReturnType<typeof expandDtsIncludes>;
    try {expanded=expandDtsIncludes({entryFile:root.sourceName,files,includeSearchPaths:[]});}
    catch {return reject(root.sourceName,0,"include 展开源码超过 32 MiB 安全上限。");}
    const fail=(offset:number,message:string):never=>{const origin=expanded.originAt(offset);return reject(origin.fileName,origin.offset,message);};
    expandedBytes+=Buffer.byteLength(expanded.text);
    if (expandedBytes>32*1024*1024) fail(0,"include 展开源码超过 32 MiB。");
    try {
      const tokens=lexDts(expanded.text);
      for (const token of tokens.entries()) {
        const [index,value]=token;
        if(value.kind==="path-ref")references.add(`&${value.value}`);
        if (value.kind==="amp") {
          const next=tokens[index+1];
          if (next?.kind==="ident") references.add(next.value);
        }
      }
      const document=parseDts(expanded.text);
      declarations+=document.topLevel.length;
      const visit=(node:DtsNodeCst,parentPath:string|null="")=>{
        const path=node.refTarget?dtsReferencePath(node.refTarget):node.isOverlayRoot?"/":parentPath===null?null
          :`${parentPath==="/"?"":parentPath}/${node.name}${node.unitAddress!==undefined?`@${node.unitAddress}`:""}`;
        if(path!==null && !node.refTarget)paths.add(path);
        for (const label of node.labels) {if(labels.has(label))fail(node.span.start,`节点标签 ${label} 重复。`);labels.add(label);}
        for (const child of node.children) {
          if (child.kind==="node")visit(child,path);
          else if(child.kind==="property") {
            try {parseDtsValue(child.name,child.rawText);}
            catch {fail(child.span.start,`属性 ${child.name} 的值需要补充依赖或使用当前支持的 DTS 值语法。`);}
          }
        }
      };
      document.topLevel.forEach(node=>visit(node));
    } catch(error) {
      if(error instanceof ApiError)throw error;
      const message=error instanceof Error?error.message:"设备树语法无效。";
      fail(Number(/(?:offset|at) (\d+)/u.exec(message)?.[1]??0),message);
    }
  }
  if(!declarations)reject(roots[0]?.sourceName??draft.members[0]!.sourceName,0,"源码中没有可发布的设备树声明。");
  const members=draft.members.map(member=>({...member,checksum:`sha256:${createHash("sha256").update(member.content).digest("hex")}`,sizeBytes:Buffer.byteLength(member.content)}));
  const manifest:SharedDtsiManifest={schemaVersion:"shared-dtsi/v1",...(draft.sourceEvidence ? {sourceEvidence:draft.sourceEvidence}:{}),members:members.map(({content:_,...member})=>({...member,role:/\.dtsi?$/u.test(member.sourceName)?"include":"header"})),
    includeGraph:graph,buildInputs:{includeSearchPaths:[]},externalReferences:[...references].filter(reference=>reference.startsWith("&{")
      ?!paths.has(dtsReferencePath(reference.slice(1))!):!labels.has(reference)).sort()};
  return {members,manifest,digest:`sha256:${createHash("sha256").update(JSON.stringify({name:draft.name,manifest,changeDescription:draft.changeDescription})).digest("hex")}`};
}

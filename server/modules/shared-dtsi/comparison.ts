import type { Database } from "../../shared/database/client";
import { isDeepStrictEqual } from "node:util";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { SharedDtsiComparison, SharedDtsiVersion } from "../contracts/dtoSchemas/sharedDtsi";
import { parseDts, parseDtsValue, renderDtsValue, type DtsDocument, type DtsValue } from "../dts";
import { expandDtsIncludes } from "../dts/configSetResolver";
import { closureMembers, composeDtsBuildInputs, loadSharedDtsiClosure } from "./dependencies";
import { completePublicationSource, getSharedDtsiVersion } from "./publication";

const declaredInputs=(version:SharedDtsiVersion)=>({includeSearchPaths:version.manifest.buildInputs.includeSearchPaths,defines:version.manifest.buildInputs.defines??{}});

// Keep declarations in parser order: repeated writes/deletes must never become an unordered map.
function semanticValue(value:DtsValue):DtsValue {
  switch(value.kind) {
    case "strings":return {kind:value.kind,values:value.values};
    case "cells":return {kind:value.kind,bits:value.bits,groups:value.groups.map(group=>group.map(cell=>cell.kind==="integer"?{kind:cell.kind,raw:cell.value,value:cell.value}:cell))};
    case "mixed":return {kind:value.kind,segments:value.segments.map(segment=>segment.kind==="string"?{kind:segment.kind,raw:JSON.stringify(segment.value),value:segment.value}
      :{kind:segment.kind,bits:segment.bits,cells:segment.cells.map(cell=>cell.kind==="integer"?{kind:cell.kind,raw:cell.value,value:cell.value}:cell)})};
    default:return value;
  }
}
export function sharedDtsiDeclarationSemantics(document:DtsDocument):string {
  type Statement=DtsDocument["topLevel"][number]|DtsDocument["topLevel"][number]["children"][number]|DtsDocument["directives"][number];
  const print=(statement:Statement,indent=""):string=>{
    if(statement.kind==="directive")return `${indent}${statement.name}${statement.arg?` ${JSON.stringify(statement.arg)}`:""}${document.source[statement.span.end-1]===";"?";":""}`;
    if(statement.kind==="property")return `${indent}${statement.name}${statement.rawText.trim()?` = ${renderDtsValue(semanticValue(statement.value??parseDtsValue(statement.name,statement.rawText).value))}`:""};`;
    if(statement.kind!=="node")return `${indent}/${statement.kind}/ ${statement.name}${statement.kind==="delete-node"&&statement.unitAddress!==undefined?`@${statement.unitAddress}`:""};`;
    return `${indent}${statement.labels.map(label=>`${label}: `).join("")}${statement.refTarget?`&${statement.refTarget}`:statement.isOverlayRoot?"/":`${statement.name}${statement.unitAddress===undefined?"":`@${statement.unitAddress}`}`} {\n${statement.children.map(child=>print(child,`${indent}  `)).join("\n")}\n${indent}};`;
  };
  // The parser groups fragment properties under a synthetic root; their spans retain the real interleaving.
  const statements:Statement[]=[...document.directives,...document.topLevel.flatMap<Statement>(node=>node.isOverlayRoot&&node.children[0]?.span.start===node.span.start?node.children:[node])];
  return statements.sort((a,b)=>a.span.start-b.span.start).map(statement=>print(statement)).join("\n");
}

export async function compareSharedDtsiVersions(db:Database,auth:AuthContext,resourceId:string,beforeId:string,afterId:string):Promise<SharedDtsiComparison> {
  const before=await getSharedDtsiVersion(db,auth,resourceId,beforeId),after=await getSharedDtsiVersion(db,auth,resourceId,afterId);
  const prepare=async(version:SharedDtsiVersion)=>{
    const source=await completePublicationSource(db,auth,{id:version.id,resourceId:version.resourceId,name:version.name,revision:1,updatedAt:version.createdAt,
      changeDescription:version.changeDescription,members:version.members,dependencies:version.manifest.dependencies,buildInputs:declaredInputs(version),sourceEvidence:version.manifest.sourceEvidence});
    if(!isDeepStrictEqual(source.manifest,version.manifest))throw new ApiError("CONFLICT","固定版本的源码或预处理证明不匹配，请联系管理员检查工具链。",{reason:"shared-source-comparison-stale"});
    const closure=await loadSharedDtsiClosure(db,auth,version.manifest.dependencies??[],resourceId);
    const sources=[...version.members.map(member=>({...member,resourceId,resourceName:version.name})),
      ...closure.flatMap(resource=>resource.item.members.map(member=>({...member,resourceId:resource.resourceId,resourceName:resource.name,
        sourceName:resource.mountPath?`${resource.mountPath}/${member.sourceName}`:member.sourceName})))];
    const members=[...version.members,...closureMembers(closure)];
    const files=new Map(members.map(member=>[member.sourceName,{content:member.content,fileVersionId:member.id}]));
    const included=new Set(version.manifest.includeGraph.map(edge=>edge.target));
    const roots=members.filter(member=>/\.dtsi?$/u.test(member.sourceName)&&!included.has(member.sourceName));
    const declarations=roots.map(root=>`// ${root.sourceName}\n${sharedDtsiDeclarationSemantics(source.preprocessing?.documents.get(root.sourceName)?.document??parseDts(expandDtsIncludes({entryFile:root.sourceName,files,
      includeSearchPaths:composeDtsBuildInputs(declaredInputs(version),closure).includeSearchPaths}).text))}`);
    return {sources,semantics:declarations.join("\n\n")};
  };
  const left=await prepare(before),right=await prepare(after);
  const key=(source:{resourceId:string;id:string})=>`${source.resourceId}/${source.id}`;
  const keys=new Set([...left.sources.map(key),...right.sources.map(key)]);
  const sources=[...keys].flatMap(id=>{
    const a=left.sources.find(source=>key(source)===id),b=right.sources.find(source=>key(source)===id),source=b??a!;
    return a?.content===b?.content && a?.sourceName===b?.sourceName?[]:[{resourceId:source.resourceId,resourceName:source.resourceName,memberId:source.id,
      before:a?{sourceName:a.sourceName,content:a.content}:null,after:b?{sourceName:b.sourceName,content:b.content}:null}];
  });
  const {members:_beforeMembers,manifest:_beforeManifest,...beforeSummary}=before;
  const {members:_afterMembers,manifest:_afterManifest,...afterSummary}=after;
  return {before:beforeSummary,after:afterSummary,sources,buildInputs:{before:declaredInputs(before),after:declaredInputs(after)},dependencies:{before:before.manifest.dependencyClosure??[],after:after.manifest.dependencyClosure??[]},semantic:{scope:"ordered-fragment-declarations",before:left.semantics,after:right.semantics,
    externalReferences:[...new Set([...before.manifest.externalReferences,...after.manifest.externalReferences])]}};
}

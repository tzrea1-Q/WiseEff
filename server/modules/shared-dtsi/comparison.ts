import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import type { SharedDtsiComparison, SharedDtsiVersion } from "../contracts/dtoSchemas/sharedDtsi";
import { parseDts, parseDtsValue, renderDtsValue, type DtsNodeCst, type DtsValue } from "../dts";
import { expandDtsIncludes } from "../dts/configSetResolver";
import { closureMembers, loadSharedDtsiClosure } from "./dependencies";
import { getSharedDtsiVersion } from "./publication";

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
export function sharedDtsiDeclarationSemantics(nodes:DtsNodeCst[],indent=""):string {
  return nodes.map(node=>`${indent}${node.labels.map(label=>`${label}: `).join("")}${node.refTarget?`&${node.refTarget}`:node.isOverlayRoot?"/":`${node.name}${node.unitAddress===undefined?"":`@${node.unitAddress}`}`} {\n${
    node.children.map(child=>child.kind==="node"?sharedDtsiDeclarationSemantics([child],`${indent}  `)
      :child.kind==="property"?`${indent}  ${child.name}${child.rawText.trim()?` = ${renderDtsValue(semanticValue(child.value??parseDtsValue(child.name,child.rawText).value))}`:""};`
        :`${indent}  /${child.kind}/ ${child.name}${child.kind==="delete-node"&&child.unitAddress!==undefined?`@${child.unitAddress}`:""};`).join("\n")}\n${indent}};`).join("\n");
}

export async function compareSharedDtsiVersions(db:Database,auth:AuthContext,resourceId:string,beforeId:string,afterId:string):Promise<SharedDtsiComparison> {
  const before=await getSharedDtsiVersion(db,auth,resourceId,beforeId),after=await getSharedDtsiVersion(db,auth,resourceId,afterId);
  const prepare=async(version:SharedDtsiVersion)=>{
    const closure=await loadSharedDtsiClosure(db,auth,version.manifest.dependencies??[],resourceId);
    const sources=[...version.members.map(member=>({...member,resourceId,resourceName:version.name})),
      ...closure.flatMap(resource=>resource.item.members.map(member=>({...member,resourceId:resource.resourceId,resourceName:resource.name,
        sourceName:resource.mountPath?`${resource.mountPath}/${member.sourceName}`:member.sourceName})))];
    const members=[...version.members,...closureMembers(closure)];
    const files=new Map(members.map(member=>[member.sourceName,{content:member.content,fileVersionId:member.id}]));
    const included=new Set(version.manifest.includeGraph.map(edge=>edge.target));
    const roots=members.filter(member=>member.sourceName.endsWith(".dtsi")&&!included.has(member.sourceName));
    const declarations=roots.map(root=>`// ${root.sourceName}\n${sharedDtsiDeclarationSemantics(parseDts(expandDtsIncludes({entryFile:root.sourceName,files,
      includeSearchPaths:version.manifest.buildInputs.includeSearchPaths}).text).topLevel)}`);
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
  return {before:beforeSummary,after:afterSummary,sources,dependencies:{before:before.manifest.dependencyClosure??[],after:after.manifest.dependencyClosure??[]},semantic:{scope:"ordered-fragment-declarations",before:left.semantics,after:right.semantics,
    externalReferences:[...new Set([...before.manifest.externalReferences,...after.manifest.externalReferences])]}};
}

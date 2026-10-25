import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { getAuthContext } from "../auth/repository";
import { createUserInvocation } from "../auth/trustedInvocation";
import { resolveOperatingContext } from "../auth/operatingContext";
import type { ProposalCommand } from "../parameter-governance/proposals/command";
import { sharedDtsiRecognitionReferenceSchema } from "../contracts/dtoSchemas/sharedDtsi";
import { offsetToLineColumn, resolveDtsConfigSet } from "../dts";
import { parseCanonicalCompatibleSelector } from "../parameter-catalog-contract";
import { DriverCompatible } from "../catalog-kernel/interface";
import { captureModuleRecognitionCatalog, loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";
import { parameterOrganizationId, withParameterAccess } from "../parameters/operatingScope";
import { closureMembers, composeDtsBuildInputs, loadSharedDtsiClosure, mountedSharedPath } from "./dependencies";
import { completePublicationSource, getSharedDtsiVersion } from "./publication";

/** Read immutable source evidence without creating a project or a Catalog observation. */
export async function readSharedDtsiCompatibleEvidence(db: Database, auth: AuthContext, resourceId: string, versionId: string) {
  const version = await getSharedDtsiVersion(db, auth, resourceId, versionId);
  const resources = await loadSharedDtsiClosure(db, auth, version.manifest.dependencies ?? [], resourceId);
  const declared={includeSearchPaths:version.manifest.buildInputs.includeSearchPaths,defines:version.manifest.buildInputs.defines??{}};
  const prepared=await completePublicationSource(db,auth,{id:version.id,resourceId,name:version.name,revision:version.version,updatedAt:version.createdAt,
    changeDescription:version.changeDescription,members:version.members,dependencies:version.manifest.dependencies,buildInputs:declared});
  const members = [...version.members, ...closureMembers(resources)];
  const files = new Map(members.map(member => [member.sourceName, {fileVersionId: member.id, content: member.content}]));
  const included = new Set(prepared.manifest.includeGraph.map(edge => edge.target));
  const roots = members.filter(member => member.sourceName.endsWith(".dtsi") && !included.has(member.sourceName));
  if (!roots.length) throw new ApiError("VALIDATION_FAILED", "固定版本没有可识别的源码入口。");
  const resolved = resolveDtsConfigSet({entryFile:roots[0]!.sourceName,overlayOrder:roots.slice(1).map(member=>member.sourceName),
    ...composeDtsBuildInputs(declared,resources),files,requireExactOrigins:true,preparedSources:prepared.preprocessing??undefined});
  if (resolved.diagnostics.some(diagnostic => diagnostic.severity === "error"))
    throw new ApiError("VALIDATION_FAILED", "固定版本的来源暂不可识别，请核对完整依赖。", {diagnostics:resolved.diagnostics});
  const ownership = new Map(version.members.map(member => [member.sourceName, {resourceId,versionId,memberId:member.id,sourceName:member.sourceName,version:version.version}]));
  for (const resource of resources) for (const member of resource.item.members)
    ownership.set(mountedSharedPath(resource.mountPath,member.sourceName), {resourceId:resource.resourceId,versionId:resource.versionId,memberId:member.id,sourceName:member.sourceName,version:resource.version});
  const stubs = [...resolved.effective.nodesByLocator.values()].filter(node=>node.isLabelStub).map(node=>node.nodeLocator);
  const items = [];
  for (const node of resolved.effective.nodesByLocator.values()) {
    const property = node.properties.get("compatible");
    if (node.deleted || !property || property.deleted) continue;
    const value = property.value;
    if (value?.kind !== "strings" || value.values.some(compatible=>!parseCanonicalCompatibleSelector(compatible).ok))
      throw new ApiError("VALIDATION_FAILED", "源码中的 compatible 标识无效。");
    const effect = property.sourceChain.at(-1)!;
    const owner = ownership.get(effect.fileName);
    if (!owner || !effect.origin) throw new ApiError("VALIDATION_FAILED", "compatible 原始来源位置不可验证。");
    const stub = stubs.find(path=>node.nodeLocator===path || node.nodeLocator.startsWith(`${path}/`));
    items.push({nodeLocator:stub ? `&${node.nodeLocator.slice(1)}` : node.nodeLocator,unresolved:!!stub,labels:node.labels,
      compatibles:[...new Set(value.values)],source:{...owner,line:offsetToLineColumn(files.get(effect.fileName)!.content,effect.origin.start).line}});
  }
  return {resourceId,versionId,items};
}

export async function recognizeSharedDtsiVersion(db: Database, auth: AuthContext, resourceId: string, versionId: string) {
  const evidence = await readSharedDtsiCompatibleEvidence(db,auth,resourceId,versionId);
  const current = await captureModuleRecognitionCatalog(db);
  const catalog = current ? await loadOrganizationCatalogSnapshot(db,parameterOrganizationId(auth),current) : null;
  const summarize=(match:ReturnType<NonNullable<typeof catalog>["resolveSubject"]>|undefined)=>({status:!match ? "unavailable" as const : match.status === "matched" && match.subject.kind === "driver" ? "recognized" as const
    : match.status === "ambiguous" ? "ambiguous" as const : match.status === "retired" ? "retired" as const : "unknown" as const,
    subjectIds:match?.status === "matched" || match?.status === "retired" ? [match.subject.id] : match?.status === "ambiguous" ? match.candidates.map(subject=>subject.id) : []});
  const items = evidence.items.map(item => ({...item,candidate:summarize(catalog?.resolveSubject({driverCompatibles:item.compatibles.map(DriverCompatible),nodeTypeFallback:{kind:"absent"}})),compatibles:item.compatibles.map(compatible=>{
    const match = catalog?.resolveSubject({driverCompatibles:[DriverCompatible(compatible)],nodeTypeFallback:{kind:"absent"}});
    return {compatible,...summarize(match)};
  })}));
  const final = await captureModuleRecognitionCatalog(db);
  if (current && (!final || final.release.id !== current.release.id || final.release.digest !== current.release.digest))
    throw new ApiError("CONFLICT", "目录发布已变化，请重新读取来源识别。", {reason:"release-drift"});
  return {...evidence,items,catalogReleaseId:catalog?.release.id ?? null};
}

/** Existing proposal writer remains the only authoring path; provenance is resolved here, never accepted from the browser. */
export async function bindSharedDtsiProposalEvidence(db:Database,command:ProposalCommand):Promise<ProposalCommand> {
  if(!("payload" in command) || command.payload.sourceReference===undefined && command.payload.sourceEvidence===undefined)return command;
  const parsed=sharedDtsiRecognitionReferenceSchema.safeParse(command.payload.sourceReference);
  if(!parsed.success || command.payload.sourceEvidence!==undefined || !["create-subject","source-recognition"].includes(String(command.payload.kind)))
    throw new ApiError("VALIDATION_FAILED","共享来源引用无效，请从固定版本重新识别。");
  const ref=parsed.data;
  const changeSet=command.payload.changeSet;
  if(command.payload.kind==="create-subject") {
  if(!Array.isArray(changeSet) || changeSet.length!==1 || !changeSet[0] || typeof changeSet[0]!=="object" || Array.isArray(changeSet[0]))
    throw new ApiError("VALIDATION_FAILED","来源识别只能预填一个待确认的主体。");
  const change=changeSet[0],selector=change.selector;
  if(change.op!=="create-subject" || change.kind!=="driver" || !selector || typeof selector!=="object" || Array.isArray(selector)
    || selector.kind!=="driver-compatible" || selector.value!==ref.compatible)
    throw new ApiError("VALIDATION_FAILED","主体 compatible 标识与固定来源不一致。");
  }
  const principal=await getAuthContext(db,command.context.principalId);
  const auth=withParameterAccess(principal,await resolveOperatingContext(db,createUserInvocation(principal),command.organizationId));
  const result=await recognizeSharedDtsiVersion(db,auth,ref.resourceId,ref.versionId);
  if(result.catalogReleaseId!==command.currentRelease.id)throw new ApiError("CONFLICT","目录发布已变化，请重新核对来源。",{reason:"release-drift"});
  const item=result.items.find(item=>item.nodeLocator===ref.nodeLocator && item.compatibles.some(entry=>entry.compatible===ref.compatible));
  if(!item)throw new ApiError("VALIDATION_FAILED","来源与 compatible 标识不匹配。");
  if(command.payload.kind==="create-subject" && item.candidate.status!=="unknown")
    throw new ApiError("CONFLICT","来源已匹配正式主体或存在歧义，请重新核对识别结果。");
  return {...command,payload:{...command.payload,sourceEvidence:{...item.source,nodeLocator:item.nodeLocator,unresolved:item.unresolved,compatible:ref.compatible,candidate:item.candidate}}};
}

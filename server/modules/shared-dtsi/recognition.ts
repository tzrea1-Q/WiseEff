import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { offsetToLineColumn, resolveDtsConfigSet } from "../dts";
import { parseCanonicalCompatibleSelector } from "../parameter-catalog-contract";
import { DriverCompatible } from "../catalog-kernel/interface";
import { captureModuleRecognitionCatalog, loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";
import { parameterOrganizationId } from "../parameters/operatingScope";
import { closureMembers, loadSharedDtsiClosure, mountedSharedPath } from "./dependencies";
import { getSharedDtsiVersion } from "./publication";

/** Read immutable source evidence without creating a project or a Catalog observation. */
export async function readSharedDtsiCompatibleEvidence(db: Database, auth: AuthContext, resourceId: string, versionId: string) {
  const version = await getSharedDtsiVersion(db, auth, resourceId, versionId);
  const resources = await loadSharedDtsiClosure(db, auth, version.manifest.dependencies ?? [], resourceId);
  const members = [...version.members, ...closureMembers(resources)];
  const files = new Map(members.map(member => [member.sourceName, {fileVersionId: member.id, content: member.content}]));
  const included = new Set(version.manifest.includeGraph.map(edge => edge.target));
  const roots = members.filter(member => member.sourceName.endsWith(".dtsi") && !included.has(member.sourceName));
  if (!roots.length) throw new ApiError("VALIDATION_FAILED", "固定版本没有可识别的源码入口。");
  const resolved = resolveDtsConfigSet({entryFile:roots[0]!.sourceName,overlayOrder:roots.slice(1).map(member=>member.sourceName),
    includeSearchPaths:version.manifest.buildInputs.includeSearchPaths,files,requireExactOrigins:true});
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
  const items = evidence.items.map(item => ({...item,compatibles:item.compatibles.map(compatible=>{
    const match = catalog?.resolveSubject({driverCompatibles:[DriverCompatible(compatible)],nodeTypeFallback:{kind:"absent"}});
    return {compatible,status:!match ? "unavailable" as const : match.status === "matched" && match.subject.kind === "driver" ? "recognized" as const
      : match.status === "ambiguous" ? "ambiguous" as const : match.status === "retired" ? "retired" as const : "unknown" as const,
      subjectIds:match?.status === "matched" || match?.status === "retired" ? [match.subject.id] : match?.status === "ambiguous" ? match.candidates.map(subject=>subject.id) : []};
  })}));
  const final = await captureModuleRecognitionCatalog(db);
  if (current && (!final || final.release.id !== current.release.id || final.release.digest !== current.release.digest))
    throw new ApiError("CONFLICT", "目录发布已变化，请重新读取来源识别。", {reason:"release-drift"});
  return {...evidence,items,catalogReleaseId:catalog?.release.id ?? null};
}

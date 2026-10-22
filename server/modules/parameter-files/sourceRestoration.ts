import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import type { DtsEffectiveNode } from "../dts/configSetResolver";
import { loadDeletedSourceAnchors, appendProjectValue, readOwnedCurrentBinding, readOwnedProjectValueIdentity } from "../parameter-bindings/values";
import { assertCanonicalValueConstraints } from "../parameter-bindings/values/service";
import { deriveHistoryEventId } from "../parameter-bindings/values/repositories";
import { asValueClient, rawTextToPayload } from "../parameter-bindings/catalogProjectValueSync";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { DefinitionRevisionId, ParameterDefinitionId, ProjectValueId } from "../parameter-catalog-contract";
import { sameSourceRevision, sourceRevisionDigest, type SourceRevisionNewProperty } from "./sourceRevisionService";

type Scope = { organizationId: string; projectId: string; configSetId: string };
type Anchor = Awaited<ReturnType<typeof loadDeletedSourceAnchors>>[number];
export type SourceRestoration = SourceRevisionNewProperty & Omit<Anchor, "locator" | "logicalNodeId" | "nodeLocator"> & {
  locator: Record<string, unknown>;
};

export async function matchingDeletedSourceAnchors(tx: Database, scope: Scope,
  effective: Map<string, DtsEffectiveNode>, members: ReadonlyArray<{ sourceName: string; fileId: string }>) {
  const selected = new Map<string, Anchor>();
  // The owner orders by deletion time, then pin ID. Repeated exact anchors use the newest one.
  for (const anchor of await loadDeletedSourceAnchors(tx, scope)) {
    if (anchor.format !== "dts" || !anchor.nodeLocator || !anchor.logicalNodeId || typeof anchor.locator.propertyName !== "string") continue;
    const node = effective.get(anchor.nodeLocator), property = node?.properties.get(anchor.locator.propertyName);
    if (!node || node.deleted || !property || property.deleted
      || members.find((row) => row.sourceName === property.sourceChain.at(-1)?.fileName)?.fileId !== anchor.fileId) continue;
    const key = JSON.stringify([anchor.fileId, anchor.nodeLocator, anchor.locator.propertyName]);
    if (!selected.has(key)) selected.set(key, anchor);
  }
  return [...selected.values()];
}

export function sourceRestorationNodes(anchors: Anchor[]) {
  return [...new Map(anchors.map((anchor) => [anchor.logicalNodeId, {
    baseConfigRevisionId: anchor.baseConfigRevisionId, nodeLocator: anchor.nodeLocator!, logicalNodeId: anchor.logicalNodeId!
  }])).values()];
}

/** Consume exact matches so normal discovery cannot create a second Binding for a deleted source. */
export async function prepareSourceRestorations(tx: Database, scope: Scope, properties: SourceRevisionNewProperty[],
  anchors: Anchor[], snapshots: ReadonlyMap<string, CatalogSnapshot>): Promise<SourceRestoration[]> {
  const result: SourceRestoration[] = [];
  for (const anchor of anchors) {
    const index = properties.findIndex((row) => row.fileId === anchor.fileId && row.nodeLocator === anchor.nodeLocator && row.propertyName === anchor.locator.propertyName);
    if (index < 0) continue;
    const property = properties[index]!, snapshot = snapshots.get(anchor.catalogReleaseId);
    const definition = snapshot?.getDefinitionRevision({ definitionId: ParameterDefinitionId(anchor.definitionId), revisionId: DefinitionRevisionId(anchor.effectiveRevisionId) });
    if (!definition || definition.status !== "found" || property.logicalNodeId !== anchor.logicalNodeId
      || property.definitionId !== anchor.definitionId || property.subjectId !== anchor.subjectId
      || (await readSourceRegistrationAgreement(tx, { organizationId: scope.organizationId, subjectId: anchor.subjectId }))?.id !== anchor.registrationId) {
      throw new ApiError("CONFLICT", "已删除参数的身份或登记发生变化，无法安全恢复。请核对文件与节点归属。");
    }
    assertCanonicalValueConstraints(definition.revision, property.payload, true);
    result.push({ ...property, ...anchor, nodeLocator: property.nodeLocator, logicalNodeId: property.logicalNodeId,
      definitionRevisionId: anchor.effectiveRevisionId });
    properties.splice(index, 1);
  }
  return result;
}

export async function applySourceRestoration(tx: Database, scope: Scope, planned: SourceRestoration,
  input: { requestId: string; configRevisionId: string; auditRef: string; derived?: boolean },
  snapshot: CatalogSnapshot, property: { propertyOccurrenceId: string; nodeOccurrenceId: string; rawText: string; fileVersionId: string }) {
  const current = await readOwnedCurrentBinding(tx, { ...scope, bindingId: planned.bindingId,
    restoration: { requestId: input.requestId, oldValueId: planned.oldValueId, configRevisionId: input.configRevisionId } });
  const old = await readOwnedProjectValueIdentity(tx, { ...scope, bindingId: planned.bindingId, projectValueId: planned.oldValueId });
  if (current.status !== "current" || !old || !sameSourceRevision(rawTextToPayload(planned.propertyName, property.rawText), planned.payload)) {
    throw new ApiError("CONFLICT", "恢复参数的来源或当前值已变化，所有变更已回滚。");
  }
  const appended = await appendProjectValue(asValueClient(tx), { snapshot,
    binding: { ...current.binding, catalogRelease: snapshot.release }, definitionRevisionId: current.binding.effectiveRevisionId,
    expectedTip: ProjectValueId(planned.oldValueId), payload: planned.payload, valueState: "present",
    source: { sourceRef: old.value.source.sourceRef, configRevisionId: input.configRevisionId },
    sourceCommit: { requestId: input.requestId, auditRef: input.auditRef, derived: input.derived ?? false } });
  if (!appended.ok) throw new ApiError("CONFLICT", "恢复参数时发生并发修改，所有变更已回滚。");
  const locator = { kind: "dts-property", propertyOccurrenceId: property.propertyOccurrenceId,
    nodeOccurrenceId: property.nodeOccurrenceId, fileVersionId: property.fileVersionId, propertyName: planned.propertyName };
  const sourcePinId = randomUUID();
  await tx.query(`insert into parameter_catalog.project_value_source_pins
    (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,
     file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,$13)`,
  [sourcePinId,appended.value.currentTip,planned.bindingId,planned.definitionId,scope.organizationId,scope.projectId,
    planned.sourceOccurrenceId,input.configRevisionId,planned.fileId,property.fileVersionId,property.propertyOccurrenceId,
    JSON.stringify(locator),`sha256:${sourceRevisionDigest(locator)}`]);
  return { bindingId: planned.bindingId, oldValueId: planned.oldValueId, newValueId: appended.value.currentTip, sourcePinId,
    historyEventId: deriveHistoryEventId({ bindingId: planned.bindingId, oldCurrentValueId: planned.oldValueId, newCurrentValueId: appended.value.currentTip }),
    fileId: planned.fileId, fileVersionId: property.fileVersionId };
}

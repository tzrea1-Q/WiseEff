import { createHash } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import { loadExactSourceRevisionForProof, type ExactSourceRevisionIdentity } from "../parameter-files/sourceVersion";
import { parseDts, parseDtsValue, resolveDtsConfigSet, type DtsNodeCst, type DtsValue } from "../dts";
import { normalizePersistedManifest } from "./configRevisionManifest";
import type { ConfigRevisionMemberRole } from "./types";

export type ExactDtsSourceIdentity = ExactSourceRevisionIdentity & {
  logicalNodeId: string; propertyOccurrenceId: string; nodeOccurrenceId: string; propertyName: string;
};
export type ExactDtsSourceProof = {
  value: DtsValue; sourceName: string; nodeLocator: string; sourceDigest: string; revisionDigest: string;
  fileId: string; fileVersionId: string; configRevisionId: string; propertyOccurrenceId: string;
  nodeOccurrenceId: string; logicalNodeId: string; propertyName: string; sourceSpan: { start: number; end: number };
};
type Effect = {
  id: string; sourceOrder: number; kind: string; propertyId: string | null; nodeId: string | null;
  fileVersionId: string | null; propertyFileVersionId: string | null; propertyNodeId: string | null;
  propertyName: string | null; rawText: string | null; start: number | null; end: number | null;
  nodeStart: number | null; nodeEnd: number | null; nodeName: string | null;
  refTarget: string | null; unitAddress: string | null;
};
function refuse(message: string): never { throw new ApiError("CONFLICT", message, { reason: "source-proof-invalid" }); }
const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

/** The caller already holds source-prefix and Binding/workflow locks in its owned transaction. */
export async function proveExactDtsProperty(tx: Queryable, objectStore: ObjectStore, input: ExactDtsSourceIdentity): Promise<ExactDtsSourceProof> {
  const source = await loadExactSourceRevisionForProof(tx, objectStore, input);
  if (!["resolved", "validated", "compiled", "pending_approval"].includes(source.revision.status)) refuse("DTS source revision has not completed resolution.");
  const selected = source.members.find((member) => member.fileId === input.fileId && member.fileVersionId === input.fileVersionId)!;
  if (selected.format !== "dts") refuse("A DTS source property is required.");
  const dtsMembers = source.members.filter((member) => member.format === "dts");
  if (!source.revision.entryFile || !Array.isArray(source.revision.includeSearchPaths) || !Array.isArray(source.revision.overlayOrder)
    || !source.revision.includeSearchPaths.every((path) => typeof path === "string")
    || !source.revision.overlayOrder.every((path) => typeof path === "string")) refuse("DTS source manifest is incomplete.");
  const normalized = normalizePersistedManifest({
    entryFile: source.revision.entryFile!, includeSearchPaths: source.revision.includeSearchPaths, overlayOrder: source.revision.overlayOrder,
    members: dtsMembers.map((member) => ({ ...member, fileName: member.sourceName, role: member.role as ConfigRevisionMemberRole })),
  });
  if (!normalized.ok) refuse("DTS source manifest is not resolvable.");
  const logical = (await tx.query<{ id: string; nodeLocator: string }>(
    `select revision.id,revision.node_locator as "nodeLocator" from dts_logical_node_revisions revision
     join dts_logical_nodes node on node.id=revision.logical_node_id
     where revision.config_revision_id=$1 and node.id=$2 and node.organization_id=$3 and node.project_id=$4 and node.config_set_id=$5`,
    [input.configRevisionId,input.logicalNodeId,input.organizationId,input.projectId,input.configSetId],
  )).rows;
  if (logical.length !== 1) refuse("Logical source ownership is missing or ambiguous.");
  const resolved = resolveDtsConfigSet({
    ...normalized.manifest,
    requireExactOrigins: true,
    files: new Map(dtsMembers.map((member) => [member.sourceName, { fileVersionId: member.fileVersionId, content: member.content }])),
  });
  if (resolved.diagnostics.some((diagnostic) => diagnostic.code === "source-proof-limit")) {
    throw new ApiError("CONFLICT", "Exact source proof exceeds its bounded capacity.", { reason: "source-proof-limit" });
  }
  if (resolved.diagnostics.length) refuse("DTS source has unresolved or ambiguous provenance.");
  const node = resolved.effective.nodesByLocator.get(logical[0]!.nodeLocator);
  const property = node?.properties.get(input.propertyName);
  if (!node || node.deleted || !property || property.deleted || !property.sourceChain.length) refuse("DTS property is not a final active source value.");
  const effects = (await tx.query<Effect>(
    `select effect.id,effect.source_order as "sourceOrder",effect.effect_kind as kind,
      effect.property_occurrence_id as "propertyId",effect.node_occurrence_id as "nodeId",
      node.file_version_id as "fileVersionId",property.file_version_id as "propertyFileVersionId",
      property.node_occurrence_id as "propertyNodeId",property.property_name as "propertyName",
      property.raw_text as "rawText",property.start_offset as start,property.end_offset as end,
      node.start_offset as "nodeStart",node.end_offset as "nodeEnd",node.name as "nodeName",
      node.ref_target as "refTarget",node.unit_address as "unitAddress"
     from dts_occurrence_effects effect
     left join dts_node_occurrences node on node.id=effect.node_occurrence_id and node.config_revision_id=effect.config_revision_id
     left join dts_property_occurrences property on property.id=effect.property_occurrence_id and property.config_revision_id=effect.config_revision_id
     where effect.config_revision_id=$1 and effect.logical_node_revision_id=$2 and effect.property_name=$3
     order by effect.source_order,effect.id`, [input.configRevisionId,logical[0]!.id,input.propertyName],
  )).rows;
  if (effects.length !== property.sourceChain.length) refuse("Stored DTS effect chain does not match the exact source.");
  const parsed = new Map<string, ReturnType<typeof parseDts>>();
  for (const member of dtsMembers) {
    try { parsed.set(member.fileVersionId, parseDts(member.content)); }
    catch { refuse("DTS source member cannot be parsed exactly."); }
  }
  let targetValue: DtsValue | undefined;
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index]!;
    const originEntry = property.sourceChain[index]!;
    const origin = originEntry.origin;
    const member = dtsMembers.find((candidate) => candidate.sourceName === originEntry.fileName);
    if (!origin || !member || member.fileVersionId !== origin.fileVersionId || effect.kind !== originEntry.effect
      || (index > 0 && effects[index - 1]!.sourceOrder >= effect.sourceOrder)
      || !effect.nodeId || effect.fileVersionId !== member.fileVersionId) refuse("DTS effect has an ambiguous or changed original source.");
    const matchingNodes: DtsNodeCst[] = [];
    const visit = (nodes: DtsNodeCst[]) => {
      for (const candidate of nodes) {
        if (candidate.span.start === effect.nodeStart && candidate.span.end === effect.nodeEnd) matchingNodes.push(candidate);
        visit(candidate.children.filter((child): child is DtsNodeCst => child.kind === "node"));
      }
    };
    visit(parsed.get(member!.fileVersionId)!.topLevel);
    const owner = matchingNodes[0];
    if (matchingNodes.length !== 1 || !owner || effect.nodeName !== (owner.isOverlayRoot ? "/" : owner.refTarget ?? owner.name)
      || (effect.refTarget ?? null) !== (owner.refTarget ?? null) || (effect.unitAddress ?? null) !== (owner.unitAddress ?? null)) refuse("DTS node occurrence disagrees with its exact CST.");
    const target = owner!.children.filter((child) => child.kind !== "node"
      && child.span.start === origin!.start && child.span.end === origin!.end && child.name === input.propertyName);
    if (target.length !== 1) refuse("DTS property origin does not belong to its recorded node.");
    if (effect.kind === "delete") {
      if (target[0]!.kind !== "delete-property" || effect.propertyId !== null) refuse("DTS delete provenance is invalid.");
      continue;
    }
    const exact = target[0]!;
    if (exact.kind !== "property" || effect.propertyNodeId !== effect.nodeId || effect.propertyFileVersionId !== member!.fileVersionId
      || effect.propertyName !== input.propertyName || effect.start !== origin!.start || effect.end !== origin!.end
      || effect.rawText !== exact.rawText) refuse("DTS property occurrence disagrees with source bytes.");
    let value: DtsValue;
    try {
      value = parseDtsValue(input.propertyName, exact.rawText).value;
      if (JSON.stringify(value) !== JSON.stringify(parseDtsValue(input.propertyName, originEntry.rawText).value)) refuse("DTS resolution changed the lossless source value.");
    } catch { refuse("DTS property does not have a lossless supported value."); }
    if (index === effects.length - 1) {
      if (effect.propertyId !== input.propertyOccurrenceId || effect.nodeId !== input.nodeOccurrenceId || member!.fileVersionId !== input.fileVersionId) refuse("Final DTS source identity differs from the requested occurrence.");
      targetValue = value!;
    }
  }
  if (!targetValue) refuse("DTS source has no proven final value.");
  const final = property.sourceChain.at(-1)!.origin!;
  return {
    value: targetValue!, sourceName: selected.sourceName, nodeLocator: logical[0]!.nodeLocator,
    sourceDigest: `sha256:${selected.checksum.replace(/^sha256:/, "")}`,
    revisionDigest: digest({ revision: source.revision, members: source.members.map(({ bytes: _bytes, content: _content, ...metadata }) => metadata) }),
    fileId: input.fileId, fileVersionId: input.fileVersionId, configRevisionId: input.configRevisionId,
    propertyOccurrenceId: input.propertyOccurrenceId, nodeOccurrenceId: input.nodeOccurrenceId,
    logicalNodeId: input.logicalNodeId, propertyName: input.propertyName,
    sourceSpan: { start: final.start, end: final.end },
  };
}

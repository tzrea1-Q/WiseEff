import { createHash, randomUUID } from "node:crypto";

import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import type { ObjectStore } from "../logs/objectStore";
import { DefinitionRevisionId, ParameterDefinitionId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { asValueClient, rawTextToPayload } from "../parameter-bindings/catalogProjectValueSync";
import { loadSourceBindingCohortReadOnly } from "../parameter-bindings/values";
import { digestProjectValuePayload, deriveHistoryEventId, deriveProjectValueId,
  casCurrentTip, insertBindingHistoryEvent, insertProjectValue, loadBindingById, loadProjectValueById,
  loadOwnedProjectValueSourcePin, loadDeletedSourceAnchors } from "../parameter-bindings/values/repositories";
import { canAdminParameters, canEditParameters, canReviewParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import type { ConfigRevisionManifestMember, ConfigRevisionMemberRole } from "../parameter-topology/types";
import { ingestConfigRevisionInTransaction } from "../parameter-topology/ingestService";
import { offsetToLineColumn } from "../dts/offsetToLineColumn";
import { resolveDtsConfigSet, type DtsEffectiveConfigSet, type DtsEffectiveProperty } from "../dts/configSetResolver";
import { parseDts } from "../dts";
import { canonicalSourceMemberMatchesCurrentFile, loadCanonicalSourceCohort,
  loadCanonicalSourceSnapshot, lockCanonicalSourceCohort, recordCanonicalPermissionRefusal,
  requireCanonicalUserInvocation, type CanonicalSourceManifest, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { readJsonSourceValue } from "./jsonSource";
import { rethrowSourceTransactionError } from "./sourceVersion";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const same = (left: unknown, right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
function conflict(reason: string): never { throw new ApiError("CONFLICT", reason); }

type JsonMemberRemovalProof = Readonly<{
  kind: "canonical-member-removal";
  organizationId: string;
  projectId: string;
  configSetId: string;
  fileId: string;
  fileVersionId: string;
  configRevisionId: string;
  members: readonly Readonly<{
    fileId: string; fileVersionId: string; sourceName: string; format: "json";
    role: string; sortOrder: number; checksum: string; sizeBytes: number;
  }>[];
  cohort: readonly Readonly<{
    bindingId: string; oldValueId: string; sourcePinId: string;
    sourceOccurrenceId: string; definitionId: string; effectiveRevisionId: string;
    catalogReleaseId: string; fileId: string; fileVersionId: string;
    locator: Record<string, ContractJsonValue>; valueDigest: string;
  }>[];
  proofDigest: string;
}>;

type DtsGeometryNode = Readonly<{
  fileVersionId: string; path: string; name: string; unitAddress: string | null; labels: readonly string[];
  refTarget: string | null; overlayRoot: boolean; span: readonly [number, number, number, number, number, number];
  rawText: string; ast: ContractJsonValue; contentHash: string | null;
}>;
type DtsMemberRemovalGeometry = Readonly<{
  property: Readonly<{ name: string; fileVersionId: string; span: readonly [number, number, number, number, number, number];
    rawText: string; ast: ContractJsonValue; contentHash: string | null }>;
  node: DtsGeometryNode;
  parent: DtsGeometryNode | null;
  logical: Readonly<{ logicalNodeId: string; locator: string; name: string; unitAddress: string | null;
    compatible: string | null; driverSchemaVersionId: string | null; parentLogicalNodeId: string | null }>;
}>;
type DtsMemberRemovalCohortEntry = Readonly<{
  bindingId: string; oldValueId: string; sourcePinId: string; sourceOccurrenceId: string;
  definitionId: string; effectiveRevisionId: string; catalogReleaseId: string; registrationId: string;
  subjectId: string; fileId: string; fileVersionId: string; format: "dts";
  locator: Record<string, ContractJsonValue>; locatorDigest: string; valueKind: string;
  value: ContractJsonValue; valueDigest: string; dtsGeometry: DtsMemberRemovalGeometry;
}>;
type JsonMemberRemovalCohortEntry = Readonly<{
  bindingId: string; oldValueId: string; sourcePinId: string; sourceOccurrenceId: string;
  definitionId: string; effectiveRevisionId: string; catalogReleaseId: string; registrationId: string;
  subjectId: string; fileId: string; fileVersionId: string; format: "json";
  locator: Record<string, ContractJsonValue>; locatorDigest: string; valueKind: string;
  value: ContractJsonValue; valueDigest: string;
  jsonIdentity: Readonly<{ configurationInstanceId: string; configurationSchemaSubjectId: string;
    rootPointer: string; rootPointerDigest: string }>;
}>;
type DtsMemberRemovalProof = Readonly<{
  kind: "canonical-member-removal"; proofVersion: 2; format: "dts";
  organizationId: string; projectId: string; configSetId: string; fileId: string;
  fileVersionId: string; configRevisionId: string;
  members: readonly Readonly<{ fileId: string; fileVersionId: string; sourceName: string; format: "json" | "dts";
    role: string; sortOrder: number; checksum: string; sizeBytes: number }> [];
  cohort: readonly (DtsMemberRemovalCohortEntry | JsonMemberRemovalCohortEntry)[];
  proofDigest: string;
}>;
export type CanonicalMemberRemovalProof = JsonMemberRemovalProof | DtsMemberRemovalProof;

function isDtsMemberRemovalProof(proof: CanonicalMemberRemovalProof): proof is DtsMemberRemovalProof {
  return "proofVersion" in proof && proof.proofVersion === 2 && proof.format === "dts";
}

/** C owns submission/assignment. The database row, never this DTO, is the review authority. */
export type ReviewedCanonicalMemberRemoval = Readonly<{
  requestId: string;
  submitterUserId: string;
  reviewerUserId: string;
  decision: "approve";
  frozen: CanonicalMemberRemovalProof;
}>;

type MemberFile = {
  id: string; current_version_id: string | null; config_set_role: string | null;
  config_set_sort_order: number; format: string;
};

type SnapshotFile = { name: string; format: "dts" | "json"; versionNumber: number; content: string };
type SourceGraphManifest = {
  entryFile: string | null; includeSearchPaths: string[]; overlayOrder: string[];
  members: Array<{ fileId: string; fileVersionId: string; sourceName: string; format: "dts" | "json" }>;
};
type NativeEffectiveProperty = {
  logicalNodeId: string; nodeLocator: string; fileId: string; fileVersionId: string; propertyName: string;
  propertyOccurrenceId: string; nodeOccurrenceId: string; logicalNodeRevisionId: string; effectId: string;
  geometry: DtsMemberRemovalGeometry;
};
type NativeLogicalNode = DtsMemberRemovalGeometry["logical"];
type InspectedMemberRemoval = {
  proof: CanonicalMemberRemovalProof; files: SnapshotFile[]; manifest: CanonicalSourceManifest;
  resolver?: DtsEffectiveConfigSet; native?: { properties: NativeEffectiveProperty[]; nodes: NativeLogicalNode[] };
};

const span = (content: string, start: number, end: number): DtsGeometryNode["span"] => {
  const from = offsetToLineColumn(content, start);
  const to = offsetToLineColumn(content, end);
  return [start, end, from.line, from.column, to.line, to.column];
};
const jsonContract = (value: unknown): ContractJsonValue => JSON.parse(JSON.stringify(value)) as ContractJsonValue;
const locatorSegment = (node: { name: string; unitAddress?: string; refTarget?: string; isOverlayRoot: boolean }) =>
  node.isOverlayRoot ? "" : node.refTarget ?? (node.unitAddress === undefined ? node.name : `${node.name}@${node.unitAddress}`);
const childLocator = (parent: string, segment: string) => segment ? (parent ? `${parent}/${segment}` : segment) : parent;
const displayLocator = (locator: string) => locator ? `/${locator}` : "/";

function parsedOccurrenceFacts(manifest: SourceGraphManifest, files: readonly SnapshotFile[]) {
  const nodes = new Map<string, DtsGeometryNode>();
  const properties = new Map<string, DtsMemberRemovalGeometry["property"]>();
  const fileById = new Map(manifest.members.map((member, index) => [member.fileId, { member, file: files[index]! }]));
  for (const member of manifest.members.filter((item) => item.format === "dts")) {
    const source = fileById.get(member.fileId);
    if (!source || source.member.fileVersionId !== member.fileVersionId || source.file.format !== "dts") {
      conflict("DTS source bytes do not match their exact member version.");
    }
    const { content } = source.file;
    const visit = (node: ReturnType<typeof parseDts>["topLevel"][number], parent: DtsGeometryNode | null, parentPath: string) => {
      if (node.kind !== "node") return;
      const nodePath = displayLocator(childLocator(parentPath, locatorSegment(node)));
      const nodeRaw = content.slice(node.span.start, node.span.end);
      const nodeGeometry: DtsGeometryNode = {
        fileVersionId: member.fileVersionId, path: nodePath,
        name: node.isOverlayRoot ? "/" : node.refTarget ?? node.name,
        unitAddress: node.unitAddress ?? null, labels: [...node.labels], refTarget: node.refTarget ?? null,
        overlayRoot: node.isOverlayRoot, span: span(content, node.span.start, node.span.end), rawText: nodeRaw,
        ast: jsonContract({ kind: "node", labels: node.labels,
          ...(node.refTarget === undefined ? {} : { refTarget: node.refTarget }), isOverlayRoot: node.isOverlayRoot }),
        contentHash: digest(nodeRaw),
      };
      const nodeKey = JSON.stringify([member.fileVersionId, node.span.start, node.span.end]);
      if (nodes.has(nodeKey)) conflict("DTS source contains an ambiguous native node span.");
      nodes.set(nodeKey, nodeGeometry);
      for (const child of node.children) {
        if (child.kind === "node") visit(child, nodeGeometry, nodePath.slice(1));
        else if (child.kind === "property") {
          const property = {
            name: child.name, fileVersionId: member.fileVersionId,
            span: span(content, child.span.start, child.span.end),
            rawText: child.rawText,
            ast: jsonContract(child.value ?? { kind: "raw", valueType: child.valueType }),
            contentHash: digest(child.rawText),
          } as const;
          const propertyKey = JSON.stringify([member.fileVersionId, child.name, child.span.start, child.span.end]);
          if (properties.has(propertyKey)) conflict("DTS source contains an ambiguous native property span.");
          properties.set(propertyKey, property);
        }
      }
      void parent;
    };
    const parsed = parseDts(content);
    for (const root of parsed.topLevel) if (root.kind === "node") visit(root, null, "");
  }
  return { nodes, properties };
}

function assertGeometryMatchesBytes(
  geometry: DtsMemberRemovalGeometry,
  facts: ReturnType<typeof parsedOccurrenceFacts>,
) {
  const property = geometry.property;
  const node = geometry.node;
  const expectedProperty = facts.properties.get(JSON.stringify([
    property.fileVersionId, property.name, property.span[0], property.span[1]
  ]));
  const expectedNode = facts.nodes.get(JSON.stringify([
    node.fileVersionId, node.span[0], node.span[1]
  ]));
  const expectedParent = geometry.parent && facts.nodes.get(JSON.stringify([
    geometry.parent.fileVersionId, geometry.parent.span[0], geometry.parent.span[1]
  ]));
  if (!expectedProperty || !expectedNode || !same(property, expectedProperty)
    || !same(node, expectedNode) || (geometry.parent !== null && (!expectedParent || !same(geometry.parent, expectedParent)))) {
    conflict("DTS native occurrence geometry does not match the exact UTF-8 source bytes.");
  }
}

async function loadNativeEffectiveGraph(
  tx: Queryable, input: { revisionId: string; organizationId: string; projectId: string; configSetId: string },
): Promise<{ properties: NativeEffectiveProperty[]; nodes: NativeLogicalNode[] }> {
  const integrity = await tx.query<{ invalid: number; tied: number }>(`
    select
      (select count(*)::int from public.dts_occurrence_effects effect
        left join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
          and logical.config_revision_id=effect.config_revision_id
        left join public.dts_logical_nodes logical_node on logical_node.id=logical.logical_node_id
          and logical_node.organization_id=$2 and logical_node.project_id=$3 and logical_node.config_set_id=$4
        left join public.dts_property_occurrences property on property.id=effect.property_occurrence_id
          and property.config_revision_id=effect.config_revision_id and property.property_name=effect.property_name
        left join public.dts_node_occurrences node on node.id=effect.node_occurrence_id
          and node.id=property.node_occurrence_id and node.config_revision_id=effect.config_revision_id
          and node.file_version_id=property.file_version_id
        left join public.dts_config_revision_members member on member.config_revision_id=effect.config_revision_id
          and member.file_version_id=property.file_version_id
        left join public.project_parameter_file_versions version on version.id=property.file_version_id and version.file_id=member.file_id
        left join public.project_parameter_files file on file.id=member.file_id
          and file.organization_id=$2 and file.project_id=$3
        where effect.config_revision_id=$1 and effect.effect_kind in ('set','override')
          and not exists (select 1 from public.dts_occurrence_effects later
            where later.config_revision_id=effect.config_revision_id
              and later.logical_node_revision_id=effect.logical_node_revision_id
              and later.property_name=effect.property_name and later.source_order>effect.source_order)
          and (logical.id is null or logical_node.id is null or property.id is null or node.id is null
            or member.id is null or version.id is null or file.id is null
            or (node.parent_occurrence_id is not null and not exists (
              select 1 from public.dts_node_occurrences parent where parent.id=node.parent_occurrence_id
                and parent.config_revision_id=node.config_revision_id and parent.file_version_id=node.file_version_id)))) as invalid,
      (select count(*)::int from public.dts_occurrence_effects left_effect
        join public.dts_occurrence_effects right_effect on right_effect.config_revision_id=left_effect.config_revision_id
          and right_effect.logical_node_revision_id=left_effect.logical_node_revision_id
          and right_effect.property_name is not distinct from left_effect.property_name
          and right_effect.source_order=left_effect.source_order and right_effect.id<>left_effect.id
        where left_effect.config_revision_id=$1) as tied`,
  [input.revisionId, input.organizationId, input.projectId, input.configSetId]);
  if (integrity.rows[0]?.invalid !== 0 || integrity.rows[0]?.tied !== 0) {
    conflict("DTS native effective source graph has an incomplete or ambiguous occurrence.");
  }
  const properties = (await tx.query<NativeEffectiveProperty>(`
    select logical.logical_node_id as "logicalNodeId",logical.node_locator as "nodeLocator",
      member.file_id as "fileId",property.file_version_id as "fileVersionId",
      property.property_name as "propertyName",property.id as "propertyOccurrenceId",node.id as "nodeOccurrenceId",
      logical.id as "logicalNodeRevisionId",effect.id as "effectId",
      jsonb_build_object(
        'property',jsonb_build_object('name',property.property_name,'fileVersionId',property.file_version_id,
          'span',jsonb_build_array(property.start_offset,property.end_offset,property.start_line,
            property.start_column,property.end_line,property.end_column),
          'rawText',property.raw_text,'ast',property.ast_json,'contentHash',property.content_hash),
        'node',jsonb_build_object('fileVersionId',node.file_version_id,'path',node.node_path,
          'name',node.name,'unitAddress',node.unit_address,'labels',node.labels,'refTarget',node.ref_target,
          'overlayRoot',node.is_overlay_root,'span',jsonb_build_array(node.start_offset,node.end_offset,
            node.start_line,node.start_column,node.end_line,node.end_column),
          'rawText',node.raw_text,'ast',node.ast_json,'contentHash',node.content_hash),
        'parent',case when node.parent_occurrence_id is null then 'null'::jsonb else
          jsonb_build_object('fileVersionId',parent.file_version_id,'path',parent.node_path,'name',parent.name,
            'unitAddress',parent.unit_address,'labels',parent.labels,'refTarget',parent.ref_target,
            'overlayRoot',parent.is_overlay_root,'span',jsonb_build_array(parent.start_offset,parent.end_offset,
              parent.start_line,parent.start_column,parent.end_line,parent.end_column),
            'rawText',parent.raw_text,'ast',parent.ast_json,'contentHash',parent.content_hash) end,
        'logical',jsonb_build_object('logicalNodeId',logical.logical_node_id,'locator',logical.node_locator,
          'name',logical.name,'unitAddress',logical.unit_address,'compatible',logical.compatible,
          'driverSchemaVersionId',logical.driver_schema_version_id,'parentLogicalNodeId',logical.parent_logical_node_id)
      ) as geometry
    from public.dts_occurrence_effects effect
    join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
      and logical.config_revision_id=effect.config_revision_id
    join public.dts_logical_nodes logical_node on logical_node.id=logical.logical_node_id
      and logical_node.organization_id=$2 and logical_node.project_id=$3 and logical_node.config_set_id=$4
    join public.dts_property_occurrences property on property.id=effect.property_occurrence_id
      and property.config_revision_id=effect.config_revision_id and property.property_name=effect.property_name
    join public.dts_node_occurrences node on node.id=effect.node_occurrence_id
      and node.id=property.node_occurrence_id and node.config_revision_id=effect.config_revision_id
      and node.file_version_id=property.file_version_id
    left join public.dts_node_occurrences parent on parent.id=node.parent_occurrence_id
      and parent.config_revision_id=node.config_revision_id and parent.file_version_id=node.file_version_id
    join public.dts_config_revision_members member on member.config_revision_id=effect.config_revision_id
      and member.file_version_id=property.file_version_id
    join public.project_parameter_file_versions version on version.id=property.file_version_id and version.file_id=member.file_id
    join public.project_parameter_files file on file.id=member.file_id and file.organization_id=$2 and file.project_id=$3
    where effect.config_revision_id=$1 and effect.effect_kind in ('set','override')
      and not exists (select 1 from public.dts_occurrence_effects later
        where later.config_revision_id=effect.config_revision_id
          and later.logical_node_revision_id=effect.logical_node_revision_id
          and later.property_name=effect.property_name and later.source_order>effect.source_order)
      and (node.parent_occurrence_id is null or parent.id is not null)
    order by logical.logical_node_id,property.property_name,member.file_id,property.file_version_id,property.id`,
  [input.revisionId, input.organizationId, input.projectId, input.configSetId])).rows;
  const nodes = (await tx.query<NativeLogicalNode>(`
    select logical.logical_node_id as "logicalNodeId",logical.node_locator as locator,logical.name,
      logical.unit_address as "unitAddress",logical.compatible,logical.driver_schema_version_id as "driverSchemaVersionId",
      logical.parent_logical_node_id as "parentLogicalNodeId"
    from public.dts_logical_node_revisions logical
    join public.dts_logical_nodes logical_node on logical_node.id=logical.logical_node_id
      and logical_node.organization_id=$2 and logical_node.project_id=$3 and logical_node.config_set_id=$4
    where logical.config_revision_id=$1
    order by logical.logical_node_id`, [input.revisionId, input.organizationId, input.projectId, input.configSetId])).rows;
  const allNodeCount = (await tx.query<{ count: number }>(
    "select count(*)::int as count from public.dts_logical_node_revisions where config_revision_id=$1", [input.revisionId])).rows[0]?.count;
  if (nodes.length !== allNodeCount || new Set(nodes.map((node) => node.logicalNodeId)).size !== nodes.length
    || new Set(properties.map((property) => `${property.logicalNodeId}\0${property.propertyName}`)).size !== properties.length) {
    conflict("DTS native graph has an unowned or duplicate logical source identity.");
  }
  return { properties, nodes };
}

function resolverFor(manifest: SourceGraphManifest, files: readonly SnapshotFile[]) {
  if (!manifest.entryFile) conflict("DTS member removal needs a complete entry manifest.");
  const resolved = resolveDtsConfigSet({
    entryFile: manifest.entryFile, includeSearchPaths: manifest.includeSearchPaths, overlayOrder: manifest.overlayOrder,
    requireExactOrigins: true,
    files: new Map(manifest.members.flatMap((member, index) => member.format === "dts"
      ? [[member.sourceName, { fileVersionId: member.fileVersionId, content: files[index]!.content }] as const] : [])),
  });
  if (resolved.diagnostics.length || resolved.effective.nodesByLocator.size === 0) {
    conflict("DTS member removal requires a fully resolved source graph with exact origins.");
  }
  return resolved.effective;
}

function assertResolverMatchesNative(
  resolver: DtsEffectiveConfigSet, native: { properties: NativeEffectiveProperty[]; nodes: NativeLogicalNode[] },
  manifest: SourceGraphManifest, files: readonly SnapshotFile[],
) {
  const facts = parsedOccurrenceFacts(manifest, files);
  const logicalByLocator = new Map(native.nodes.map((node) => [node.locator, node]));
  if (logicalByLocator.size !== native.nodes.length || logicalByLocator.size !== resolver.nodesByLocator.size) {
    conflict("DTS resolver and native logical-node set disagree.");
  }
  for (const resolvedNode of resolver.nodesByLocator.values()) {
    const logical = logicalByLocator.get(resolvedNode.nodeLocator);
    if (!logical || logical.name !== resolvedNode.name || logical.unitAddress !== (resolvedNode.unitAddress ?? null)) {
      conflict("DTS resolver node identity differs from its native logical identity.");
    }
    const compatible = resolvedNode.properties.get("compatible");
    const compatibleMetadata = compatible && !compatible.deleted
      ? compatible.normalizedValue || compatible.rawText : null;
    if (!same(logical.compatible, compatibleMetadata)) conflict("DTS resolver compatible metadata differs from its native logical identity.");
  }
  const expected = new Set<string>();
  for (const resolvedNode of resolver.nodesByLocator.values()) {
    const logical = logicalByLocator.get(resolvedNode.nodeLocator)!;
    const parentPath = resolvedNode.nodeLocator === "/" ? null : `/${resolvedNode.nodeLocator.slice(1).split("/").slice(0, -1).join("/")}`;
    const parent = parentPath === null ? null : logicalByLocator.get(parentPath)?.logicalNodeId ?? null;
    if (logical.parentLogicalNodeId !== parent) conflict("DTS resolver parent identity differs from its native logical identity.");
    for (const property of resolvedNode.properties.values()) {
      if (property.deleted) continue;
      const final = property.sourceChain.at(-1);
      const member = final && manifest.members.find((candidate) => candidate.sourceName === final.fileName);
      if (!final?.origin || !member || member.format !== "dts" || final.effect === "delete") {
        conflict("DTS effective property has an ambiguous or synthetic source origin.");
      }
      const matches = native.properties.filter((row) => row.logicalNodeId === logical.logicalNodeId
        && row.propertyName === property.name && row.fileVersionId === final.origin!.fileVersionId
        && row.geometry.property.span[0] === final.origin!.start && row.geometry.property.span[1] === final.origin!.end
        && row.geometry.property.rawText === property.rawText);
      if (matches.length !== 1) conflict("DTS effective property does not have one exact native source occurrence.");
      const row = matches[0]!;
      const key = `${row.logicalNodeId}\0${row.propertyName}`;
      if (expected.has(key)) conflict("DTS effective property graph is ambiguous.");
      expected.add(key);
      assertGeometryMatchesBytes(row.geometry, facts);
    }
  }
  if (expected.size !== native.properties.length) conflict("DTS native effective properties do not match the complete resolver graph.");
}

function nativePropertyKey(row: NativeEffectiveProperty) {
  return serializeContract({ logicalNodeId: row.logicalNodeId, fileId: row.fileId,
    fileVersionId: row.fileVersionId, propertyName: row.propertyName, geometry: row.geometry } as ContractJsonValue);
}

function resolvedPropertyValue(property: DtsEffectiveProperty) {
  return { name: property.name, valueType: property.valueType, value: property.value ?? null,
    rawText: property.rawText, normalizedValue: property.normalizedValue, deleted: property.deleted,
    sourceChain: property.sourceChain };
}

function assertResolverRemoval(
  oldGraph: DtsEffectiveConfigSet, newGraph: DtsEffectiveConfigSet, removed: readonly DtsMemberRemovalCohortEntry[],
) {
  const removedByNode = new Map<string, Set<string>>();
  for (const entry of removed) {
    const names = removedByNode.get(entry.dtsGeometry.logical.locator) ?? new Set<string>();
    names.add(entry.dtsGeometry.property.name);
    removedByNode.set(entry.dtsGeometry.logical.locator, names);
    const sourceNode = oldGraph.nodesByLocator.get(entry.dtsGeometry.logical.locator);
    const sourceProperty = sourceNode?.properties.get(entry.dtsGeometry.property.name);
    const final = sourceProperty?.sourceChain.at(-1);
    if (!sourceProperty || sourceProperty.deleted || !final || final.effect === "delete"
      || !final.origin || final.origin.fileVersionId !== entry.fileVersionId
      || final.origin.start !== entry.dtsGeometry.property.span[0]
      || final.origin.end !== entry.dtsGeometry.property.span[1]) {
      conflict("Removed DTS property is not the exact old effective source contribution.");
    }
  }
  const oldNodes = [...oldGraph.nodesByLocator.values()].sort((a, b) => a.nodeLocator.localeCompare(b.nodeLocator));
  const newNodes = [...newGraph.nodesByLocator.values()].sort((a, b) => a.nodeLocator.localeCompare(b.nodeLocator));
  if (oldNodes.length !== newNodes.length) conflict("DTS member removal changed the effective logical-node count.");
  for (let index = 0; index < oldNodes.length; index += 1) {
    const before = oldNodes[index]!;
    const after = newNodes[index]!;
    if (before.nodeLocator !== after.nodeLocator || before.name !== after.name
      || before.unitAddress !== after.unitAddress || !same([...before.labels].sort(), [...after.labels].sort())) {
      conflict("DTS member removal changed effective node identity or metadata.");
    }
    const removedNames = removedByNode.get(before.nodeLocator) ?? new Set<string>();
    for (const [name, property] of before.properties) {
      const next = after.properties.get(name);
      if (removedNames.has(name)) {
        if (next && !next.deleted) conflict("Removing the DTS member would reveal or retain an effective fallback property.");
        continue;
      }
      if (!next || !same(resolvedPropertyValue(property), resolvedPropertyValue(next))) {
        conflict("DTS member removal changed a surviving effective property or its source origin.");
      }
    }
    for (const [name, property] of after.properties) {
      if (!before.properties.has(name) && !removedNames.has(name)) {
        conflict("DTS member removal introduced an effective property.");
      }
      if (removedNames.has(name) && !property.deleted) {
        conflict("Removing the DTS member exposed a lower-precedence source value.");
      }
    }
  }
}

function assertNativeOldMinusRemoved(
  oldGraph: { properties: NativeEffectiveProperty[]; nodes: NativeLogicalNode[] },
  newGraph: { properties: NativeEffectiveProperty[]; nodes: NativeLogicalNode[] },
  removed: readonly DtsMemberRemovalCohortEntry[],
) {
  const removedPropertyIds = new Set<string>();
  for (const entry of removed) {
    const propertyOccurrenceId = entry.locator.propertyOccurrenceId;
    if (typeof propertyOccurrenceId !== "string") conflict("Removed DTS proof lost its native property occurrence ID.");
    const rows = oldGraph.properties.filter((row) => row.propertyOccurrenceId === propertyOccurrenceId);
    if (rows.length !== 1 || rows[0]!.logicalNodeId !== entry.dtsGeometry.logical.logicalNodeId
      || rows[0]!.fileId !== entry.fileId || rows[0]!.fileVersionId !== entry.fileVersionId
      || rows[0]!.propertyName !== entry.dtsGeometry.property.name || !same(rows[0]!.geometry, entry.dtsGeometry)) {
      conflict("Removed DTS Binding does not identify one exact old effective native property.");
    }
    removedPropertyIds.add(propertyOccurrenceId);
  }
  const oldKept = oldGraph.properties.filter((row) => !removedPropertyIds.has(row.propertyOccurrenceId))
    .map(nativePropertyKey).sort();
  const next = newGraph.properties.map(nativePropertyKey).sort();
  if (!same(oldKept, next)) conflict("DTS successor graph is not the complete old native graph minus reviewed properties.");
  const oldNodes = [...oldGraph.nodes].sort((a, b) => a.logicalNodeId.localeCompare(b.logicalNodeId));
  const newNodes = [...newGraph.nodes].sort((a, b) => a.logicalNodeId.localeCompare(b.logicalNodeId));
  if (!same(oldNodes, newNodes)) conflict("DTS successor changed a logical node or structural revision identity.");
}

async function assertNoConflictingDtsTransactions(
  tx: Queryable, proof: DtsMemberRemovalProof, excludedRequestId?: string,
) {
  const bindingIds = proof.cohort.map((entry) => entry.bindingId);
  const pending = await tx.query<{ id: string }>(`
    select request.id from public.project_parameter_value_change_requests request
    where request.organization_id=$1 and request.project_id=$2 and request.status='pending'
      and request.id is distinct from $4
      and ((request.request_kind='single' and request.binding_id=any($5::text[]))
        or (request.request_kind='batch' and (
          exists (select 1 from jsonb_array_elements(coalesce(request.candidate_binding_manifest,'[]'::jsonb)) as entry(value)
            where entry.value->>'bindingId'=any($5::text[]))
          or exists (select 1 from public.project_parameter_value_change_targets target
            where target.request_id=request.id and target.binding_id=any($5::text[]))
        ))
        or (request.request_kind='member-removal' and request.member_config_set_id=$3))
    order by request.id for update of request nowait`,
  [proof.organizationId, proof.projectId, proof.configSetId, excludedRequestId ?? null, bindingIds]);
  if (pending.rows.length) conflict("A current Binding is already in another pending source review.");
  const candidates = await tx.query<{ id: string }>(`
    select candidate.id from public.project_parameter_file_candidates candidate
    join public.project_parameter_value_change_requests request on request.organization_id=candidate.organization_id
      and request.project_id=candidate.project_id and request.status='pending'
      and (request.candidate_id=candidate.id or request.batch_upload_candidate_id=candidate.id)
    where candidate.organization_id=$1 and candidate.project_id=$2 and candidate.status='ready'
      and exists (select 1 from jsonb_array_elements(coalesce(candidate.frozen_binding_manifest,'[]'::jsonb)) as entry(value)
        where entry.value->>'bindingId'=any($3::text[]))
      and request.id is distinct from $4
    order by candidate.id for update of candidate nowait`,
  [proof.organizationId, proof.projectId, bindingIds, excludedRequestId ?? null]);
  if (candidates.rows.length) conflict("A pending full-source candidate overlaps this DTS member cohort.");
  const removedIds = proof.cohort.filter((entry) => entry.fileId === proof.fileId).map((entry) => entry.bindingId);
  const drafts = await tx.query<{ id: string }>(`
    select draft.id from public.project_parameter_value_drafts draft
    where draft.organization_id=$1 and draft.project_id=$2 and draft.binding_id=any($3::text[])
      and not exists (select 1 from public.project_parameter_value_change_requests request
        where request.organization_id=draft.organization_id and request.project_id=draft.project_id
          and request.draft_id=draft.id and request.status='pending')
    order by draft.id for update of draft nowait`, [proof.organizationId, proof.projectId, removedIds]);
  if (drafts.rows.length) conflict("An unsubmitted draft targets a Binding on the removed DTS member.");
}

async function inspectDtsMemberRemoval(
  tx: Queryable,
  organizationId: string,
  input: { projectId: string; configSetId: string; fileId: string; excludedRequestId?: string },
  snapshot: Awaited<ReturnType<typeof loadCanonicalSourceSnapshot>>,
  currentFiles: readonly MemberFile[],
  cohort: Awaited<ReturnType<typeof loadCanonicalSourceCohort>>,
): Promise<InspectedMemberRemoval> {
  const { manifest, files } = snapshot;
  const removed = manifest.members.find((member) => member.fileId === input.fileId);
  const revision = (await tx.query<{
    status: string; entry_file: string | null; include_search_paths: string[]; overlay_order: string[];
  }>(`select status,entry_file,include_search_paths,overlay_order from public.dts_config_revisions where id=$1
      and organization_id=$2 and project_id=$3 and config_set_id=$4`,
  [manifest.configRevisionId, organizationId, input.projectId, input.configSetId])).rows[0];
  if (!removed || removed.format !== "dts" || removed.role !== "overlay"
    || !revision || revision.status !== "resolved" || !revision.entry_file
    || removed.sourceName === revision.entry_file
    || revision.overlay_order.filter((name) => name === removed.sourceName).length !== 1
    || manifest.members.length !== currentFiles.length
    || manifest.members.some((member) => {
      const current = currentFiles.find((file) => file.id === member.fileId);
      return !current || !canonicalSourceMemberMatchesCurrentFile(member, current);
    })
    || !same(revision.include_search_paths, manifest.includeSearchPaths)
    || !same(revision.overlay_order, manifest.overlayOrder)
    || revision.entry_file !== manifest.entryFile) {
    conflict("DTS removal requires one current non-entry overlay in the exact pinned revision.");
  }
  const deletedAnchors = await loadDeletedSourceAnchors(tx, {
    organizationId, projectId: input.projectId, configSetId: input.configSetId,
  });
  if (deletedAnchors.length) conflict("DTS member removal is unsupported while terminal source deletions exist.");
  const oldResolver = resolverFor(manifest, files);
  const oldNative = await loadNativeEffectiveGraph(tx, {
    revisionId: manifest.configRevisionId, organizationId, projectId: input.projectId, configSetId: input.configSetId,
  });
  assertResolverMatchesNative(oldResolver, oldNative, manifest, files);
  const nativeByPropertyId = new Map<string, NativeEffectiveProperty[]>();
  for (const row of oldNative.properties) {
    const rows = nativeByPropertyId.get(row.propertyOccurrenceId) ?? [];
    rows.push(row);
    nativeByPropertyId.set(row.propertyOccurrenceId, rows);
  }
  const frozenCohort: Array<DtsMemberRemovalCohortEntry | JsonMemberRemovalCohortEntry> = [];
  for (const row of [...cohort].sort((a, b) => a.bindingId.localeCompare(b.bindingId))) {
    const pin = await loadOwnedProjectValueSourcePin(tx, {
      organizationId, projectId: input.projectId, bindingId: row.bindingId, projectValueId: row.oldValueId,
    });
    const binding = await loadBindingById(asValueClient(tx), row.bindingId);
    const old = await loadProjectValueById(asValueClient(tx), row.oldValueId);
    const pinMeta = pin && (await tx.query<{
      locator_digest: string; property_occurrence_id: string | null; root_pointer_digest: string | null; occurrence_kind: string;
    }>(`select pin.locator_digest,pin.property_occurrence_id,occurrence.root_pointer_digest,occurrence.occurrence_kind
        from parameter_catalog.project_value_source_pins pin
        join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
        where pin.id=$1 and pin.binding_id=$2 and pin.project_value_id=$3`,
    [pin.sourcePinId, row.bindingId, row.oldValueId])).rows[0];
    if (!pin || !pinMeta || !binding || !old || pin.configRevisionId !== manifest.configRevisionId
      || pin.sourcePinId !== row.sourcePinId || pin.configSetId !== input.configSetId
      || pin.valueState !== "present" || old.value_state !== "present"
      || old.config_revision_id !== manifest.configRevisionId || old.value_digest !== row.valueDigest
      || binding.organization_id !== organizationId || binding.project_id !== input.projectId
      || binding.current_value_id !== row.oldValueId || binding.source_occurrence_id !== row.sourceOccurrenceId
      || binding.definition_id !== row.definitionId || binding.effective_revision_id !== row.effectiveRevisionId
      || binding.catalog_release_id !== row.catalogReleaseId
      || !manifest.members.some((member) => member.fileId === pin.fileId && member.fileVersionId === pin.fileVersionId)) {
      conflict("DTS removal current Binding, Value or source pin is stale or unowned.");
    }
    const registration = await readSourceRegistrationAgreement(tx, { organizationId, subjectId: binding.subject_id });
    if (!registration || registration.id !== binding.registration_id) conflict("DTS removal Binding has no active source registration.");
    const fileIndex = manifest.members.findIndex((member) => member.fileId === pin.fileId && member.fileVersionId === pin.fileVersionId);
    if (pin.format === "dts") {
      if (pinMeta.occurrence_kind !== "dts" || !pin.logicalNodeId || binding.logical_node_id !== pin.logicalNodeId
        || !pinMeta.property_occurrence_id || pin.locator.kind !== "dts-property"
        || typeof pin.locator.fileVersionId !== "string" || typeof pin.locator.propertyName !== "string"
        || typeof pin.locator.propertyOccurrenceId !== "string" || typeof pin.locator.nodeOccurrenceId !== "string") {
        conflict("DTS source pin does not have the exact native property identity.");
      }
      const locator = {
        kind: "dts-property", fileVersionId: pin.fileVersionId, propertyName: pin.locator.propertyName,
        propertyOccurrenceId: pinMeta.property_occurrence_id, nodeOccurrenceId: pin.locator.nodeOccurrenceId,
      } as const;
      if (!same(locator, pin.locator) || locator.propertyOccurrenceId !== pin.locator.propertyOccurrenceId
        || `sha256:${digest(serializeContract(locator as unknown as ContractJsonValue))}` !== pinMeta.locator_digest) {
        conflict("DTS source pin locator or canonical digest is not exact.");
      }
      const native = nativeByPropertyId.get(locator.propertyOccurrenceId) ?? [];
      if (native.length !== 1 || native[0]!.nodeOccurrenceId !== locator.nodeOccurrenceId
        || native[0]!.logicalNodeId !== pin.logicalNodeId || native[0]!.fileId !== pin.fileId
        || native[0]!.fileVersionId !== pin.fileVersionId || native[0]!.propertyName !== locator.propertyName) {
        conflict("DTS current Binding does not point to one complete effective native property.");
      }
      const source = oldResolver.nodesByLocator.get(native[0]!.nodeLocator)?.properties.get(locator.propertyName);
      if (!source || source.deleted || source.rawText !== native[0]!.geometry.property.rawText) {
        conflict("DTS current Binding has no exact effective source value.");
      }
      const payload = rawTextToPayload(locator.propertyName, source.rawText);
      if (old.value_kind !== payload.kind || old.value_digest !== digestProjectValuePayload(payload)
        || !same(old.value, payload.value)) conflict("DTS source bytes disagree with the current typed Value.");
      frozenCohort.push({
        bindingId: row.bindingId, oldValueId: row.oldValueId, sourcePinId: pin.sourcePinId,
        sourceOccurrenceId: row.sourceOccurrenceId, definitionId: row.definitionId,
        effectiveRevisionId: row.effectiveRevisionId, catalogReleaseId: row.catalogReleaseId,
        registrationId: binding.registration_id, subjectId: binding.subject_id,
        fileId: pin.fileId, fileVersionId: pin.fileVersionId, format: "dts", locator: pin.locator,
        locatorDigest: pinMeta.locator_digest, valueKind: old.value_kind,
        value: jsonContract(old.value), valueDigest: old.value_digest, dtsGeometry: native[0]!.geometry,
      });
    } else if (pin.format === "json") {
      if (pinMeta.occurrence_kind !== "json" || pin.logicalNodeId !== null
        || pinMeta.property_occurrence_id !== null || !pin.configurationInstanceId
        || !pin.configurationSchemaSubjectId || pin.rootPointer === null
        || typeof pinMeta.root_pointer_digest !== "string" || pin.locator.kind !== "json-pointer"
        || typeof pin.locator.pointer !== "string"
        || !same(pin.locator, { kind: "json-pointer", pointer: pin.locator.pointer })) {
        conflict("JSON survivor does not have its exact immutable instance/root/pointer identity.");
      }
      const expectedLocatorDigest = `sha256:${digest(serializeContract(pin.locator as unknown as ContractJsonValue))}`;
      if (pinMeta.locator_digest !== expectedLocatorDigest
        || pinMeta.root_pointer_digest !== `sha256:${digest(pin.rootPointer)}`) {
        conflict("JSON survivor locator or root digest is not canonical.");
      }
      const sourceValue = readJsonSourceValue(files[fileIndex]!.content, pin.locator.pointer, pin.rootPointer);
      const payload = { kind: "json" as const, value: sourceValue as ContractJsonValue };
      if (old.value_kind !== "json" || old.value_digest !== digestProjectValuePayload(payload)
        || !same(old.value, payload.value)) conflict("JSON source bytes disagree with the current typed Value.");
      frozenCohort.push({
        bindingId: row.bindingId, oldValueId: row.oldValueId, sourcePinId: pin.sourcePinId,
        sourceOccurrenceId: row.sourceOccurrenceId, definitionId: row.definitionId,
        effectiveRevisionId: row.effectiveRevisionId, catalogReleaseId: row.catalogReleaseId,
        registrationId: binding.registration_id, subjectId: binding.subject_id,
        fileId: pin.fileId, fileVersionId: pin.fileVersionId, format: "json", locator: pin.locator,
        locatorDigest: pinMeta.locator_digest, valueKind: old.value_kind,
        value: jsonContract(old.value), valueDigest: old.value_digest,
        jsonIdentity: {
          configurationInstanceId: pin.configurationInstanceId,
          configurationSchemaSubjectId: pin.configurationSchemaSubjectId,
          rootPointer: pin.rootPointer, rootPointerDigest: pinMeta.root_pointer_digest,
        },
      });
    } else conflict("Current source cohort contains an unsupported format.");
  }
  const removedRows = frozenCohort.filter((entry) => entry.fileId === input.fileId);
  const survivors = frozenCohort.filter((entry) => entry.fileId !== input.fileId);
  if (new Set(frozenCohort.map((entry) => entry.bindingId)).size !== frozenCohort.length
    || new Set(frozenCohort.map((entry) => entry.sourcePinId)).size !== frozenCohort.length
    || new Set(frozenCohort.map((entry) => entry.oldValueId)).size !== frozenCohort.length
    || !removedRows.length || !survivors.length || removedRows.some((entry) => entry.format !== "dts")) {
    conflict("Both the removed DTS member and a surviving member need current governed Bindings.");
  }
  for (const entry of removedRows) {
    if (entry.format !== "dts") continue;
    const oldProperty = oldResolver.nodesByLocator.get(entry.dtsGeometry.logical.locator)?.properties.get(entry.dtsGeometry.property.name);
    const final = oldProperty?.sourceChain.at(-1);
    if (!oldProperty || oldProperty.deleted || !final || final.fileName !== removed.sourceName
      || !final.origin || final.origin.fileVersionId !== removed.fileVersionId
      || final.origin.start !== entry.dtsGeometry.property.span[0] || final.origin.end !== entry.dtsGeometry.property.span[1]) {
      conflict("Removed DTS Binding is not an exclusive current property contribution.");
    }
  }
  const base = {
    kind: "canonical-member-removal" as const, proofVersion: 2 as const, format: "dts" as const,
    organizationId, projectId: input.projectId, configSetId: input.configSetId,
    fileId: input.fileId, fileVersionId: removed.fileVersionId, configRevisionId: manifest.configRevisionId,
    members: manifest.members.map(({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes }) =>
      ({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes })),
    cohort: frozenCohort,
  };
  const proof = { ...base, proofDigest: digest(serializeContract(base as unknown as ContractJsonValue)) };
  await assertNoConflictingDtsTransactions(tx, proof, input.excludedRequestId);
  return { proof, files, manifest, resolver: oldResolver, native: oldNative };
}

async function inspectMemberRemoval(
  tx: Database, storage: ObjectStore, organizationId: string,
  input: { projectId: string; configSetId: string; fileId: string; excludedRequestId?: string }
): Promise<InspectedMemberRemoval> {
  const set = await tx.query(`select id from public.dts_config_set
    where id=$1 and organization_id=$2 and project_id=$3 for update nowait`,
  [input.configSetId, organizationId, input.projectId]);
  if (set.rows.length !== 1) throw new ApiError("NOT_FOUND", "Configuration set is unavailable.");
  const files = (await tx.query<MemberFile>(`select id,current_version_id,config_set_role,config_set_sort_order,format
    from public.project_parameter_files where organization_id=$1 and project_id=$2 and config_set_id=$3
    order by id for update nowait`, [organizationId, input.projectId, input.configSetId])).rows;
  if (!files.some((file) => file.id === input.fileId) || files.length < 2) {
    throw new ApiError("CONFLICT", "A current member with a surviving source file is required.");
  }
  await tx.query(`select version.id from public.project_parameter_file_versions version
    join public.project_parameter_files file on file.id=version.file_id and file.current_version_id=version.id
    where file.organization_id=$1 and file.project_id=$2 and file.config_set_id=$3
    order by version.id for update of version nowait`, [organizationId, input.projectId, input.configSetId]);
  let seed: { bindingId: string; valueId: string } | undefined;
  for (const entry of await loadSourceBindingCohortReadOnly(tx, {
    organizationId, projectId: input.projectId, configSetId: input.configSetId
  })) {
    const pin = await loadOwnedProjectValueSourcePin(tx, {
      organizationId, projectId: input.projectId,
      bindingId: entry.bindingId, projectValueId: entry.oldValueId
    });
    if (pin?.fileId === input.fileId) {
      seed = { bindingId: entry.bindingId, valueId: entry.oldValueId };
      break;
    }
  }
  if (!seed) conflict("Removed source member has no current Binding cohort.");
  const sourcePin = await loadOwnedProjectValueSourcePin(tx, {
    organizationId, projectId: input.projectId, bindingId: seed.bindingId, projectValueId: seed.valueId
  });
  if (!sourcePin) conflict("Removed source member has no exact source pin.");
  await lockCanonicalSourceCohort(tx, sourcePin);
  const cohort = await loadCanonicalSourceCohort(tx, {
    organizationId, projectId: input.projectId, configSetId: input.configSetId
  });
  const snapshot = await loadCanonicalSourceSnapshot(tx, storage, {
    organizationId, projectId: input.projectId, bindingId: seed.bindingId, projectValueId: seed.valueId
  });
  if (snapshot.manifest.configSetId !== input.configSetId
    || snapshot.manifest.members.length !== files.length
    || snapshot.manifest.members.some((member) => {
      const current = files.find((file) => file.id === member.fileId);
      return !current || !canonicalSourceMemberMatchesCurrentFile(member,current);
    })) conflict("Current source members differ from the exact pinned revision.");
  const removedMember = snapshot.manifest.members.find((member) => member.fileId === input.fileId);
  if (removedMember?.format === "dts") {
    return inspectDtsMemberRemoval(tx, organizationId, input, snapshot, files, cohort);
  }
  if (snapshot.manifest.members.some((member) => member.format !== "json")) {
    conflict("JSON member removal remains limited to an all-JSON source revision.");
  }
  const frozenCohort: JsonMemberRemovalProof["cohort"][number][] = [];
  for (const entry of cohort) {
    const pin = await loadOwnedProjectValueSourcePin(tx, {
      organizationId, projectId: input.projectId,
      bindingId: entry.bindingId, projectValueId: entry.oldValueId
    });
    if (!pin || pin.configRevisionId !== snapshot.manifest.configRevisionId
      || pin.sourcePinId !== entry.sourcePinId || pin.configSetId !== input.configSetId
      || pin.valueState !== "present" || pin.format !== "json"
      || !snapshot.manifest.members.some((member) => member.fileId === pin.fileId
        && member.fileVersionId === pin.fileVersionId)) conflict("Source cohort has an unpinned or stale member.");
    frozenCohort.push({
      bindingId: entry.bindingId, oldValueId: entry.oldValueId, sourcePinId: pin.sourcePinId,
      sourceOccurrenceId: entry.sourceOccurrenceId, definitionId: entry.definitionId,
      effectiveRevisionId: entry.effectiveRevisionId, catalogReleaseId: entry.catalogReleaseId,
      fileId: pin.fileId, fileVersionId: pin.fileVersionId,
      locator: pin.locator, valueDigest: entry.valueDigest
    });
  }
  if (!frozenCohort.some((entry) => entry.fileId === input.fileId)
    || !frozenCohort.some((entry) => entry.fileId !== input.fileId)) {
    conflict("Both removed and surviving members need an exact current Binding.");
  }
  const removedFile = snapshot.manifest.members.find((member) => member.fileId === input.fileId)!;
  const base = {
    kind: "canonical-member-removal" as const,
    organizationId, projectId: input.projectId, configSetId: input.configSetId,
    fileId: input.fileId, fileVersionId: removedFile.fileVersionId,
    configRevisionId: snapshot.manifest.configRevisionId,
    members: snapshot.manifest.members.map(({ fileId, fileVersionId, sourceName,
      role, sortOrder, checksum, sizeBytes }) => ({
      fileId, fileVersionId, sourceName, format: "json" as const, role, sortOrder, checksum, sizeBytes
    })),
    cohort: frozenCohort
  };
  return { proof: { ...base, proofDigest: digest(serializeContract(base)) }, files: snapshot.files, manifest: snapshot.manifest };
}

type JsonSuccessorReceipt = Readonly<{
  bindingId: string; oldValueId: string; newValueId: string; sourcePinId: string;
  historyEventId: string; fileId: string; fileVersionId: string; format: "json";
}>;
type DtsSuccessorReceipt = Readonly<{
  bindingId: string; oldValueId: string; newValueId: string; sourcePinId: string;
  historyEventId: string; fileId: string; fileVersionId: string; format: "dts";
  nodeOccurrenceId: string; propertyOccurrenceId: string; logicalNodeRevisionId: string; effectId: string;
}>;

async function applyDtsMemberRemoval(
  tx: Database, storage: ObjectStore, auth: AuthContext, snapshot: CatalogSnapshot,
  review: Omit<ReviewedCanonicalMemberRemoval, "frozen"> & { frozen: DtsMemberRemovalProof },
  context: { traceId: string }, invocation: TrustedInvocationContext,
): Promise<{ requestId: string; tombstoneId: string; successorConfigRevisionId: string; replayed: false }> {
  const frozen = review.frozen;
  const inspected = await inspectMemberRemoval(tx, storage, auth.organization.id, {
    projectId: frozen.projectId, configSetId: frozen.configSetId, fileId: frozen.fileId,
    excludedRequestId: review.requestId,
  });
  if (!isDtsMemberRemovalProof(inspected.proof) || !same(inspected.proof, frozen)
    || !inspected.resolver || !inspected.native) conflict("DTS member removal source proof is stale.");
  const manifest = inspected.manifest;
  const removed = manifest.members.find((member) => member.fileId === frozen.fileId);
  if (!removed || removed.fileVersionId !== frozen.fileVersionId || removed.format !== "dts") {
    conflict("DTS member version changed after review.");
  }
  if (frozen.cohort.some((entry) => entry.catalogReleaseId !== snapshot.release.id)) {
    conflict("DTS member removal Catalog release changed after review.");
  }
  const currentById = new Map(inspected.files.map((file, index) => [frozen.members[index]!.fileId, file]));
  const successorMembers: ConfigRevisionManifestMember[] = frozen.members.filter((member) => member.fileId !== frozen.fileId)
    .map((member) => ({
      fileId: member.fileId, fileVersionId: member.fileVersionId, fileName: member.sourceName,
      sourceName: member.sourceName, format: member.format, role: member.role as ConfigRevisionMemberRole,
      sortOrder: member.sortOrder, content: currentById.get(member.fileId)!.content,
    }));
  const sourceRevision = (await tx.query<{
    entry_file: string; include_search_paths: string[]; overlay_order: string[];
  }>(`select entry_file,include_search_paths,overlay_order from public.dts_config_revisions where id=$1
      and organization_id=$2 and project_id=$3 and config_set_id=$4 and status='resolved'`,
  [frozen.configRevisionId, auth.organization.id, frozen.projectId, frozen.configSetId])).rows[0];
  if (!sourceRevision || sourceRevision.entry_file !== manifest.entryFile
    || !same(sourceRevision.include_search_paths, manifest.includeSearchPaths)
    || !same(sourceRevision.overlay_order, manifest.overlayOrder)) conflict("DTS source manifest changed after review.");
  const overlayOrder = sourceRevision.overlay_order.filter((name) => name !== removed.sourceName);
  const attribution = trustedDomainAttribution(invocation);
  const revision = await ingestConfigRevisionInTransaction(tx, {
    organizationId: auth.organization.id, projectId: frozen.projectId, configSetId: frozen.configSetId,
    entryFile: sourceRevision.entry_file, includeSearchPaths: sourceRevision.include_search_paths,
    overlayOrder, members: successorMembers,
  }, auth, { createdByUserId: attribution.userId, domain: attribution }, {
    sourceCommit: { baseConfigRevisionId: frozen.configRevisionId },
  });
  if (revision.status !== "resolved") conflict("DTS source successor did not resolve with stable logical identities.");
  const successorGraphManifest: SourceGraphManifest = {
    entryFile: sourceRevision.entry_file, includeSearchPaths: sourceRevision.include_search_paths,
    overlayOrder, members: frozen.members.filter((member) => member.fileId !== frozen.fileId).map((member) => ({
      fileId: member.fileId, fileVersionId: member.fileVersionId, sourceName: member.sourceName, format: member.format,
    })),
  };
  const successorFiles = frozen.members.map((member, index) => ({ member, file: inspected.files[index]! }))
    .filter(({ member }) => member.fileId !== frozen.fileId).map(({ file }) => file);
  const oldResolver = inspected.resolver;
  const newResolver = resolverFor(successorGraphManifest, successorFiles);
  const newNative = await loadNativeEffectiveGraph(tx, {
    revisionId: revision.id, organizationId: auth.organization.id, projectId: frozen.projectId, configSetId: frozen.configSetId,
  });
  assertResolverMatchesNative(newResolver, newNative, successorGraphManifest, successorFiles);
  const removedDts = frozen.cohort.filter((entry): entry is DtsMemberRemovalCohortEntry =>
    entry.fileId === frozen.fileId && entry.format === "dts");
  assertResolverRemoval(oldResolver, newResolver, removedDts);
  assertNativeOldMinusRemoved(inspected.native, newNative, removedDts);
  const newRowsByBinding = new Map<string, NativeEffectiveProperty>();
  for (const entry of frozen.cohort.filter((row) => row.fileId !== frozen.fileId && row.format === "dts")) {
    const dts = entry as DtsMemberRemovalCohortEntry;
    const rows = newNative.properties.filter((row) => row.logicalNodeId === dts.dtsGeometry.logical.logicalNodeId
      && row.fileId === dts.fileId && row.fileVersionId === dts.fileVersionId
      && row.propertyName === dts.dtsGeometry.property.name && same(row.geometry, dts.dtsGeometry));
    if (rows.length !== 1) conflict("Surviving DTS Binding has no exact successor occurrence pair.");
    newRowsByBinding.set(dts.bindingId, rows[0]!);
  }
  const auditEventId = randomUUID();
  const successorBindings: Array<JsonSuccessorReceipt | DtsSuccessorReceipt> = [];
  for (const entry of frozen.cohort.filter((row) => row.fileId !== frozen.fileId)) {
    const binding = await loadBindingById(asValueClient(tx), entry.bindingId, "update");
    const old = await loadProjectValueById(asValueClient(tx), entry.oldValueId);
    if (!binding || !old || binding.organization_id !== auth.organization.id || binding.project_id !== frozen.projectId
      || binding.current_value_id !== entry.oldValueId || binding.source_occurrence_id !== entry.sourceOccurrenceId
      || binding.definition_id !== entry.definitionId || binding.effective_revision_id !== entry.effectiveRevisionId
      || binding.catalog_release_id !== entry.catalogReleaseId || binding.registration_id !== entry.registrationId
      || binding.subject_id !== entry.subjectId || old.value_state !== "present"
      || old.value_digest !== entry.valueDigest || old.value_kind !== entry.valueKind
      || !same(old.value, entry.value) || old.config_revision_id !== frozen.configRevisionId
      || snapshot.getDefinitionRevision({ definitionId: ParameterDefinitionId(entry.definitionId),
        revisionId: DefinitionRevisionId(entry.effectiveRevisionId) }).status !== "found") {
      conflict("Surviving Binding, Value or Definition is stale.");
    }
    const definition = snapshot.getDefinitionById(ParameterDefinitionId(entry.definitionId));
    if (definition.status !== "found" || definition.definition.subjectId !== entry.subjectId) {
      conflict("Surviving Binding subject does not own its Catalog Definition.");
    }
    const registration = await readSourceRegistrationAgreement(tx, {
      organizationId: auth.organization.id, subjectId: binding.subject_id,
    });
    if (!registration || registration.id !== entry.registrationId) conflict("Surviving Binding registration is no longer active.");
    const memberIndex = frozen.members.findIndex((member) => member.fileId === entry.fileId
      && member.fileVersionId === entry.fileVersionId);
    if (memberIndex < 0) conflict("Surviving Binding source is outside the frozen manifest.");
    let payload: ReturnType<typeof rawTextToPayload> | { kind: "json"; value: ContractJsonValue };
    let locator = entry.locator;
    let propertyOccurrenceId: string | null = null;
    let dtsRow: NativeEffectiveProperty | undefined;
    if (entry.format === "json") {
      const member = frozen.members[memberIndex]!;
      if (member.format !== "json") {
        conflict("JSON survivor format differs from the frozen source identity.");
      }
      const sourceValue = readJsonSourceValue(inspected.files[memberIndex]!.content,
        (entry.locator as Record<string, ContractJsonValue>).pointer as string, entry.jsonIdentity.rootPointer);
      payload = { kind: "json", value: sourceValue as ContractJsonValue };
      if (payload.kind !== entry.valueKind || !same(payload.value, entry.value)) {
        conflict("JSON survivor changed its source value during member removal.");
      }
    } else {
      const member = frozen.members[memberIndex]!;
      dtsRow = newRowsByBinding.get(entry.bindingId);
      if (member.format !== "dts" || !dtsRow || !same(dtsRow.geometry, entry.dtsGeometry)) {
        conflict("DTS survivor geometry changed during source ingestion.");
      }
      const property = newResolver.nodesByLocator.get(dtsRow.nodeLocator)?.properties.get(dtsRow.propertyName);
      if (!property || property.deleted || !property.sourceChain.at(-1)?.origin) {
        conflict("DTS survivor no longer has an exact effective source value.");
      }
      payload = rawTextToPayload(dtsRow.propertyName, property.rawText);
      if (payload.kind !== entry.valueKind || !same(payload.value, entry.value)) {
        conflict("DTS survivor changed its typed value during member removal.");
      }
      locator = {
        kind: "dts-property", fileVersionId: dtsRow.fileVersionId, propertyName: dtsRow.propertyName,
        propertyOccurrenceId: dtsRow.propertyOccurrenceId, nodeOccurrenceId: dtsRow.nodeOccurrenceId,
      };
      propertyOccurrenceId = dtsRow.propertyOccurrenceId;
    }
    const valueDigest = digestProjectValuePayload(payload);
    if (valueDigest !== entry.valueDigest || old.value_digest !== valueDigest) {
      conflict("Surviving Value digest changed during member removal.");
    }
    const newValueId = deriveProjectValueId({
      bindingId: entry.bindingId, definitionRevisionId: DefinitionRevisionId(entry.effectiveRevisionId),
      sourceRef: old.source_ref, configRevisionId: revision.id, valueKind: payload.kind,
      valueDigest, expectedTip: entry.oldValueId,
    });
    if (!await insertProjectValue(asValueClient(tx), {
      id: newValueId, bindingId: entry.bindingId, definitionId: entry.definitionId,
      definitionRevisionId: entry.effectiveRevisionId, sourceRef: old.source_ref,
      configRevisionId: revision.id, valueDigest, valueKind: payload.kind,
      valueJson: JSON.stringify(payload.value), valueState: "present",
    })) conflict("Surviving Value revision already exists.");
    const sourcePinId = randomUUID();
    const locatorDigest = `sha256:${digest(serializeContract(locator as unknown as ContractJsonValue))}`;
    await tx.query(`insert into parameter_catalog.project_value_source_pins
      (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,
       config_revision_id,file_id,file_version_id,format,locator,locator_digest,property_occurrence_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
    [sourcePinId, newValueId, entry.bindingId, entry.definitionId, auth.organization.id, frozen.projectId,
      entry.sourceOccurrenceId, revision.id, entry.fileId, entry.fileVersionId, entry.format,
      JSON.stringify(locator), locatorDigest, propertyOccurrenceId]);
    if (!await casCurrentTip(asValueClient(tx), {
      bindingId: entry.bindingId, expectedTip: entry.oldValueId, nextTip: newValueId, sourceCommitRequestId: review.requestId,
    })) conflict("Surviving Binding lost its exact reviewed Value tip.");
    const historyEventId = deriveHistoryEventId({
      bindingId: entry.bindingId, oldCurrentValueId: entry.oldValueId, newCurrentValueId: newValueId,
    });
    await insertBindingHistoryEvent(asValueClient(tx), {
      id: historyEventId, bindingId: entry.bindingId, effectiveRevisionId: entry.effectiveRevisionId,
      oldCurrentValueId: entry.oldValueId, newCurrentValueId: newValueId,
      successAuditRef: auditEventId, catalogReleaseId: entry.catalogReleaseId,
      reason: "source-revision-propagation",
    });
    const common = { bindingId: entry.bindingId, oldValueId: entry.oldValueId, newValueId,
      sourcePinId, historyEventId, fileId: entry.fileId, fileVersionId: entry.fileVersionId };
    if (entry.format === "json") successorBindings.push({ ...common, format: "json" });
    else if (dtsRow) successorBindings.push({ ...common, format: "dts", nodeOccurrenceId: dtsRow.nodeOccurrenceId,
      propertyOccurrenceId: dtsRow.propertyOccurrenceId, logicalNodeRevisionId: dtsRow.logicalNodeRevisionId,
      effectId: dtsRow.effectId });
  }
  successorBindings.sort((a, b) => a.bindingId.localeCompare(b.bindingId));
  const removedBindings = frozen.cohort.filter((row) => row.fileId === frozen.fileId)
    .map((row) => ({ bindingId: row.bindingId, valueId: row.oldValueId, sourcePinId: row.sourcePinId }));
  const tombstoneId = randomUUID();
  await writeTrustedAuditEventInTx(asAuditTx(tx), {
    id: auditEventId, invocation, app: "parameters", kind: "parameter-topology-governance",
    action: "source-member-removed", severity: "Medium", projectId: frozen.projectId,
    targetType: "project-parameter-file", targetId: frozen.fileId,
    metadata: { tombstoneId, configSetId: frozen.configSetId, configRevisionId: frozen.configRevisionId,
      fileVersionId: frozen.fileVersionId, bindings: removedBindings, successorConfigRevisionId: revision.id,
      successorBindings, reviewRequestId: review.requestId, submitterUserId: review.submitterUserId,
      proofDigest: frozen.proofDigest }, traceId: context.traceId,
  });
  await tx.query("set local role parameter_governance_writer_role");
  await tx.query(`select parameter_catalog.insert_reviewed_member_tombstone(
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)`,
  [tombstoneId, auth.organization.id, frozen.projectId, frozen.configSetId, frozen.fileId,
    frozen.configRevisionId, frozen.fileVersionId, JSON.stringify(removedBindings), revision.id,
    JSON.stringify(successorBindings), auditEventId]);
  await tx.query("reset role");
  const detached = await tx.query(`update public.project_parameter_files
    set config_set_id=null,config_set_role=null,config_set_sort_order=0,updated_at=now()
    where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$4 and current_version_id=$5`,
  [frozen.fileId, auth.organization.id, frozen.projectId, frozen.configSetId, frozen.fileVersionId]);
  if (detached.rowCount !== 1) conflict("Removed DTS file lost its exact membership or version.");
  const approved = await tx.query(`update public.project_parameter_value_change_requests
    set status='approved',reviewer_user_id=$2,applied_at=now(),apply_outcome='committed',
      applied_audit_ref=$3,applied_file_version_ids='[]'::jsonb,applied_source_result=$4::jsonb,updated_at=now()
    where id=$1 and status='pending' and assigned_to_user_id=$2`,
  [review.requestId, auth.user.id, auditEventId, JSON.stringify({ tombstoneId, successorConfigRevisionId: revision.id })]);
  if (approved.rowCount !== 1) conflict("Member removal review decision changed.");
  return { requestId: review.requestId, tombstoneId, successorConfigRevisionId: revision.id, replayed: false };
}

async function verifyDtsMemberRemovalReplay(
  tx: Database, storage: ObjectStore,
  review: Omit<ReviewedCanonicalMemberRemoval, "frozen"> & { frozen: DtsMemberRemovalProof },
  request: { applied_source_result: { tombstoneId: string; successorConfigRevisionId: string } | null;
    applied_audit_ref: string | null; reviewer_user_id: string | null; status: string },
  tombstone: { id: string; successor_config_revision_id: string; config_revision_id: string;
    file_version_id: string; audit_event_id: string; binding_manifest: unknown; successor_binding_manifest: unknown;
    metadata: unknown },
) {
  const proof = review.frozen;
  if (!request.applied_source_result || !request.applied_audit_ref
    || request.status !== "approved" || request.reviewer_user_id !== review.reviewerUserId
    || tombstone.config_revision_id !== proof.configRevisionId || tombstone.file_version_id !== proof.fileVersionId
    || tombstone.successor_config_revision_id !== request.applied_source_result.successorConfigRevisionId
    || request.applied_source_result.tombstoneId !== tombstone.id
    || request.applied_audit_ref !== tombstone.audit_event_id
    || !same(Object.keys(request.applied_source_result).sort(), ["successorConfigRevisionId", "tombstoneId"])) {
    conflict("Approved DTS member removal has no exact immutable replay receipt.");
  }
  const expectedRemoved = proof.cohort.filter((entry) => entry.fileId === proof.fileId)
    .map((entry) => ({ bindingId: entry.bindingId, valueId: entry.oldValueId, sourcePinId: entry.sourcePinId }));
  if (!same(tombstone.binding_manifest, expectedRemoved)) conflict("DTS removal tombstone does not retain the frozen removed cohort.");
  const receipts = tombstone.successor_binding_manifest;
  if (!Array.isArray(receipts)) conflict("DTS removal receipt is not a complete successor Binding array.");
  const receiptRows = receipts as Array<JsonSuccessorReceipt | DtsSuccessorReceipt>;
  const expectedSurvivors = proof.cohort.filter((entry) => entry.fileId !== proof.fileId)
    .map((entry) => entry.bindingId).sort();
  if (!same(receiptRows.map((row) => row.bindingId), expectedSurvivors)
    || new Set(receiptRows.map((row) => row.bindingId)).size !== receiptRows.length) {
    conflict("DTS removal receipt omits, duplicates or reorders a survivor.");
  }
  const audit = (await tx.query<{ metadata: Record<string, unknown> }>(
    "select metadata from public.audit_events where id=$1", [request.applied_audit_ref])).rows[0];
  const auditMetadata = tombstone.metadata as Record<string, unknown>;
  if (!audit || !same(audit.metadata, auditMetadata)
    || auditMetadata.reviewRequestId !== review.requestId || auditMetadata.proofDigest !== proof.proofDigest
    || auditMetadata.submitterUserId !== review.submitterUserId
    || auditMetadata.successorConfigRevisionId !== tombstone.successor_config_revision_id
    || auditMetadata.tombstoneId !== tombstone.id || !same(auditMetadata.bindings, expectedRemoved)
    || !same(auditMetadata.successorBindings, receiptRows)) {
    conflict("DTS removal audit and tombstone receipts disagree.");
  }
  const successorRevision = (await tx.query<{ id: string; status: string; organization_id: string;
    project_id: string; config_set_id: string }>(`select id,status,organization_id,project_id,config_set_id
      from public.dts_config_revisions where id=$1`, [tombstone.successor_config_revision_id])).rows[0];
  if (!successorRevision || successorRevision.status !== "resolved"
    || successorRevision.organization_id !== proof.organizationId || successorRevision.project_id !== proof.projectId
    || successorRevision.config_set_id !== proof.configSetId) conflict("DTS replay successor revision is unavailable.");
  let newSnapshot: Awaited<ReturnType<typeof loadCanonicalSourceSnapshot>> | undefined;
  for (const receipt of receiptRows) {
    const frozen = proof.cohort.find((entry) => entry.bindingId === receipt.bindingId);
    if (!frozen || frozen.fileId === proof.fileId || receipt.oldValueId !== frozen.oldValueId
      || receipt.fileId !== frozen.fileId || receipt.fileVersionId !== frozen.fileVersionId
      || receipt.format !== frozen.format) conflict("DTS replay receipt differs from its frozen Binding identity.");
    const expectedKeys = frozen.format === "json"
      ? ["bindingId", "oldValueId", "newValueId", "sourcePinId", "historyEventId", "fileId", "fileVersionId", "format"].sort()
      : ["bindingId", "oldValueId", "newValueId", "sourcePinId", "historyEventId", "fileId", "fileVersionId", "format",
        "nodeOccurrenceId", "propertyOccurrenceId", "logicalNodeRevisionId", "effectId"].sort();
    if (!same(Object.keys(receipt).sort(), expectedKeys)) conflict("DTS replay receipt has an invalid per-format shape.");
    const oldValue = await loadProjectValueById(asValueClient(tx), frozen.oldValueId);
    const newValue = await loadProjectValueById(asValueClient(tx), receipt.newValueId);
    const oldPin = await loadOwnedProjectValueSourcePin(tx, {
      organizationId: proof.organizationId, projectId: proof.projectId,
      bindingId: frozen.bindingId, projectValueId: frozen.oldValueId,
    });
    const newPin = await loadOwnedProjectValueSourcePin(tx, {
      organizationId: proof.organizationId, projectId: proof.projectId,
      bindingId: frozen.bindingId, projectValueId: receipt.newValueId,
    });
    const binding = await loadBindingById(asValueClient(tx), frozen.bindingId);
    const history = (await tx.query<{ id: string; binding_id: string; effective_revision_id: string;
      old_current_value_id: string; new_current_value_id: string; success_audit_ref: string; catalog_release_id: string;
      reason: string }>(`select id,binding_id,new_effective_revision_id as effective_revision_id,old_current_value_id,new_current_value_id,
        success_audit_ref,catalog_release_id,reason from parameter_catalog.binding_history_events where id=$1`,
    [receipt.historyEventId])).rows[0];
    const newPinMeta = newPin && (await tx.query<{ locator_digest: string; property_occurrence_id: string | null;
      occurrence_kind: string; configuration_instance_id: string | null; configuration_schema_subject_id: string | null;
      root_pointer: string | null; root_pointer_digest: string | null }>(`
      select pin.locator_digest,pin.property_occurrence_id,occurrence.occurrence_kind,
        occurrence.configuration_instance_id,occurrence.configuration_schema_subject_id,
        occurrence.root_pointer,occurrence.root_pointer_digest
      from parameter_catalog.project_value_source_pins pin
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
      where pin.id=$1`, [newPin.sourcePinId])).rows[0];
    const oldPinMeta = oldPin && (await tx.query<{ locator_digest: string; property_occurrence_id: string | null;
      occurrence_kind: string; configuration_instance_id: string | null; configuration_schema_subject_id: string | null;
      root_pointer: string | null; root_pointer_digest: string | null }>(`
      select pin.locator_digest,pin.property_occurrence_id,occurrence.occurrence_kind,
        occurrence.configuration_instance_id,occurrence.configuration_schema_subject_id,
        occurrence.root_pointer,occurrence.root_pointer_digest
      from parameter_catalog.project_value_source_pins pin
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
      where pin.id=$1`, [oldPin.sourcePinId])).rows[0];
    if (!oldValue || !newValue || !oldPin || !newPin || !binding || !history || !newPinMeta || !oldPinMeta
      || oldPin.sourcePinId !== frozen.sourcePinId || !same(oldPin.locator, frozen.locator)
      || oldPinMeta.locator_digest !== frozen.locatorDigest
      || oldPin.configRevisionId !== proof.configRevisionId || newPin.sourcePinId !== receipt.sourcePinId
      || newPin.configRevisionId !== tombstone.successor_config_revision_id
      || newPin.fileId !== frozen.fileId || newPin.fileVersionId !== frozen.fileVersionId
      || newPin.format !== frozen.format || newPin.sourceOccurrenceId !== frozen.sourceOccurrenceId
      || binding.source_occurrence_id !== frozen.sourceOccurrenceId || binding.definition_id !== frozen.definitionId
      || binding.effective_revision_id !== frozen.effectiveRevisionId || binding.catalog_release_id !== frozen.catalogReleaseId
      || binding.registration_id !== frozen.registrationId || binding.subject_id !== frozen.subjectId
      || oldValue.value_state !== "present" || newValue.value_state !== "present"
      || oldValue.value_kind !== frozen.valueKind || newValue.value_kind !== frozen.valueKind
      || oldValue.value_digest !== frozen.valueDigest || newValue.value_digest !== frozen.valueDigest
      || !same(oldValue.value, frozen.value) || !same(newValue.value, frozen.value)
      || oldValue.source_ref !== newValue.source_ref || oldValue.definition_revision_id !== frozen.effectiveRevisionId
      || newValue.definition_revision_id !== frozen.effectiveRevisionId
      || oldValue.config_revision_id !== proof.configRevisionId
      || newValue.config_revision_id !== tombstone.successor_config_revision_id
      || history.id !== receipt.historyEventId || history.binding_id !== frozen.bindingId
      || history.effective_revision_id !== frozen.effectiveRevisionId
      || history.old_current_value_id !== frozen.oldValueId || history.new_current_value_id !== receipt.newValueId
      || history.success_audit_ref !== request.applied_audit_ref || history.catalog_release_id !== frozen.catalogReleaseId
      || history.reason !== "source-revision-propagation") {
      conflict("DTS replay history, Value or pin does not match its immutable successor receipt.");
    }
    if (receipt.format === "json" && frozen.format === "json") {
      const identity = frozen.jsonIdentity;
      if (!same(newPin.locator, frozen.locator) || newPinMeta.property_occurrence_id !== null
        || oldPinMeta.property_occurrence_id !== null || newPinMeta.locator_digest !== frozen.locatorDigest
        || oldPinMeta.locator_digest !== frozen.locatorDigest
        || newPinMeta.occurrence_kind !== "json" || oldPinMeta.occurrence_kind !== "json"
        || newPinMeta.configuration_instance_id !== identity.configurationInstanceId
        || oldPinMeta.configuration_instance_id !== identity.configurationInstanceId
        || newPinMeta.configuration_schema_subject_id !== identity.configurationSchemaSubjectId
        || oldPinMeta.configuration_schema_subject_id !== identity.configurationSchemaSubjectId
        || newPinMeta.root_pointer !== identity.rootPointer || oldPinMeta.root_pointer !== identity.rootPointer
        || newPinMeta.root_pointer_digest !== identity.rootPointerDigest
        || oldPinMeta.root_pointer_digest !== identity.rootPointerDigest
        || identity.rootPointerDigest !== `sha256:${digest(identity.rootPointer)}`) {
        conflict("JSON replay changed its exact source locator.");
      }
    } else if (receipt.format === "dts" && frozen.format === "dts") {
      const dts = frozen;
      const locator = { kind: "dts-property", fileVersionId: frozen.fileVersionId,
        propertyName: dts.dtsGeometry.property.name, propertyOccurrenceId: receipt.propertyOccurrenceId,
        nodeOccurrenceId: receipt.nodeOccurrenceId };
      if (!same(oldPin.locator, frozen.locator) || oldPinMeta.property_occurrence_id !== frozen.locator.propertyOccurrenceId
        || !same(newPin.locator, locator) || newPinMeta.property_occurrence_id !== receipt.propertyOccurrenceId
        || newPinMeta.occurrence_kind !== "dts" || oldPinMeta.occurrence_kind !== "dts"
        || newPinMeta.locator_digest !== `sha256:${digest(serializeContract(locator as unknown as ContractJsonValue))}`) {
        conflict("DTS replay changed its native successor occurrence locator.");
      }
    } else conflict("DTS replay receipt format does not match the frozen Binding.");
    if (!newSnapshot) newSnapshot = await loadCanonicalSourceSnapshot(tx, storage, {
      organizationId: proof.organizationId, projectId: proof.projectId,
      bindingId: frozen.bindingId, projectValueId: receipt.newValueId,
    });
  }
  if (!newSnapshot || newSnapshot.manifest.configRevisionId !== tombstone.successor_config_revision_id) {
    conflict("DTS replay cannot reload its immutable successor source bytes.");
  }
  const oldRevision = (await tx.query<{ entry_file: string | null; include_search_paths: string[]; overlay_order: string[] }>(`
    select entry_file,include_search_paths,overlay_order from public.dts_config_revisions
    where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$4 and status='resolved'`,
  [proof.configRevisionId, proof.organizationId, proof.projectId, proof.configSetId])).rows[0];
  const removedSourceName = proof.members.find((member) => member.fileId === proof.fileId)?.sourceName;
  if (!oldRevision || !removedSourceName || newSnapshot.manifest.entryFile !== oldRevision.entry_file
    || !same(newSnapshot.manifest.includeSearchPaths, oldRevision.include_search_paths)
    || !same(newSnapshot.manifest.overlayOrder, oldRevision.overlay_order.filter((name) => name !== removedSourceName))) {
    conflict("DTS replay successor entry/include/overlay manifest is not the reviewed removal.");
  }
  const expectedMembers = proof.members.filter((member) => member.fileId !== proof.fileId);
  if (!same(newSnapshot.manifest.members.map(({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes }) =>
    ({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes })), expectedMembers)) {
    conflict("DTS replay successor manifest differs from the frozen full-member identity.");
  }
  const newResolver = resolverFor(newSnapshot.manifest, newSnapshot.files);
  const oldNative = await loadNativeEffectiveGraph(tx, { revisionId: proof.configRevisionId,
    organizationId: proof.organizationId, projectId: proof.projectId, configSetId: proof.configSetId });
  const newNative = await loadNativeEffectiveGraph(tx, { revisionId: tombstone.successor_config_revision_id,
    organizationId: proof.organizationId, projectId: proof.projectId, configSetId: proof.configSetId });
  assertResolverMatchesNative(newResolver, newNative, newSnapshot.manifest, newSnapshot.files);
  const removedDts = proof.cohort.filter((entry): entry is DtsMemberRemovalCohortEntry =>
    entry.fileId === proof.fileId && entry.format === "dts");
  assertNativeOldMinusRemoved(oldNative, newNative, removedDts);
  for (const receipt of receiptRows) {
    if (receipt.format !== "dts") continue;
    const frozen = proof.cohort.find((entry): entry is DtsMemberRemovalCohortEntry =>
      entry.bindingId === receipt.bindingId && entry.format === "dts");
    const rows = newNative.properties.filter((row) => row.propertyOccurrenceId === receipt.propertyOccurrenceId);
    if (!frozen || rows.length !== 1 || rows[0]!.nodeOccurrenceId !== receipt.nodeOccurrenceId
      || rows[0]!.logicalNodeRevisionId !== receipt.logicalNodeRevisionId || rows[0]!.effectId !== receipt.effectId
      || !same(rows[0]!.geometry, frozen.dtsGeometry)) {
      conflict("DTS replay native endpoint IDs differ from the immutable receipt.");
    }
  }
}

/** Read and lock one exact source cohort; C persists this DTO in its pending request. */
export async function prepareCanonicalMemberRemoval(
  tx: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; configSetId: string; fileId: string;
    invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<CanonicalMemberRemovalProof> {
  const security: CanonicalSourceSecurityContext = {
    invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink
  };
  await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical member removal prepare",
    targetType: "project-parameter-file", targetId: input.fileId
  });
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical member removal prepare",
      targetType: "project-parameter-file", targetId: input.fileId
    });
    throw new ApiError("FORBIDDEN", "Parameter file administration is required.");
  }
  try {
    return (await inspectMemberRemoval(tx, storage, auth.organization.id, input)).proof;
  } catch (error) { rethrowSourceTransactionError(error); }
}

/** C calls this inside its reviewed request transaction; all D writes share that COMMIT. */
export async function applyReviewedCanonicalMemberRemoval(
  tx: Database, storage: ObjectStore, auth: AuthContext, snapshot: CatalogSnapshot,
  review: ReviewedCanonicalMemberRemoval,
  context: { invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<{ requestId: string; tombstoneId: string; successorConfigRevisionId: string; replayed: boolean }> {
  const frozen = review.frozen;
  const security: CanonicalSourceSecurityContext = {
    invocation: context.invocation, requestId: context.traceId, refusalSink: context.refusalSink
  };
  try {
    const request = (await tx.query<{
      status: string; submitter_user_id: string | null; assigned_to_user_id: string | null;
      reviewer_user_id: string | null; member_proof_digest: string;
      member_frozen_proof: CanonicalMemberRemovalProof; applied_source_result: {
        tombstoneId: string; successorConfigRevisionId: string
      } | null; applied_audit_ref: string | null;
    }>(`select status,submitter_user_id,assigned_to_user_id,reviewer_user_id,
        member_proof_digest,member_frozen_proof,applied_source_result,applied_audit_ref
      from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and request_kind='member-removal'
        and member_file_id=$4 and member_config_set_id=$5 and member_file_version_id=$6
      for update`, [review.requestId, auth.organization.id, frozen.projectId,
      frozen.fileId, frozen.configSetId, frozen.fileVersionId])).rows[0];
    if (!request) throw new ApiError("NOT_FOUND", "Member removal review request is unavailable.");
    if (request.member_proof_digest !== frozen.proofDigest
      || !same(request.member_frozen_proof, frozen)
      || request.submitter_user_id !== review.submitterUserId
      || request.assigned_to_user_id !== review.reviewerUserId
      || !['pending', 'approved'].includes(request.status)) {
      throw new ApiError("CONFLICT", "Member removal has no matching frozen review request.");
    }
    const invocation = await requireCanonicalUserInvocation(auth, security, {
      projectId: frozen.projectId, operation: "canonical member removal apply",
      targetType: "project-parameter-file", targetId: frozen.fileId
    });
    if (!review.requestId.trim() || review.reviewerUserId !== auth.user.id
      || review.submitterUserId === auth.user.id
      || frozen.organizationId !== auth.organization.id
      || !canEditParameters(auth, frozen.projectId) || !canReviewParameters(auth)
      || !canReviewParameterStage(auth, frozen.projectId, "software_review")
      || !await hasCurrentCanonicalReviewRole(tx, {
        organizationId: auth.organization.id, projectId: frozen.projectId, userId: auth.user.id
      })) {
      await recordCanonicalPermissionRefusal(security, {
        projectId: frozen.projectId, operation: "canonical member removal apply",
        targetType: "project-parameter-file", targetId: frozen.fileId
      });
      throw new ApiError("FORBIDDEN", "A separate current project reviewer is required.");
    }
    const existing = (await tx.query<{ id: string; successor_config_revision_id: string; config_revision_id: string;
      file_version_id: string; audit_event_id: string; binding_manifest: unknown; successor_binding_manifest: unknown;
      metadata: unknown }>(`
      select tombstone.id,tombstone.successor_config_revision_id,tombstone.config_revision_id,
        tombstone.file_version_id,tombstone.audit_event_id,tombstone.binding_manifest,
        tombstone.successor_binding_manifest,audit.metadata
      from parameter_catalog.project_source_member_tombstones tombstone
      join public.audit_events audit on audit.id=tombstone.audit_event_id
      where tombstone.organization_id=$1 and tombstone.project_id=$2
        and tombstone.config_set_id=$3 and tombstone.file_id=$4`,
    [auth.organization.id, frozen.projectId, frozen.configSetId, frozen.fileId])).rows[0];
    if (existing) {
      const metadata = existing.metadata as Record<string, unknown>;
      if (metadata.reviewRequestId !== review.requestId || metadata.proofDigest !== frozen.proofDigest
        || metadata.submitterUserId !== review.submitterUserId
        || !existing.successor_config_revision_id || request.status !== 'approved'
        || request.reviewer_user_id !== auth.user.id
        || request.applied_source_result?.tombstoneId !== existing.id
        || request.applied_source_result?.successorConfigRevisionId !== existing.successor_config_revision_id
        || !request.applied_audit_ref) conflict("Removed member has a different reviewed receipt.");
      if (isDtsMemberRemovalProof(frozen)) {
        await verifyDtsMemberRemovalReplay(tx, storage, { ...review, frozen }, request, existing);
      }
      return { requestId: review.requestId, tombstoneId: existing.id,
        successorConfigRevisionId: existing.successor_config_revision_id, replayed: true };
    }
    if (request.status !== 'pending') conflict("Member removal request is not pending.");
    if (isDtsMemberRemovalProof(frozen)) {
      return await applyDtsMemberRemoval(tx, storage, auth, snapshot, { ...review, frozen }, context, invocation);
    }
    const inspected = await inspectMemberRemoval(tx, storage, auth.organization.id, frozen);
    if (!same(inspected.proof, frozen)) conflict("Member removal source proof is stale.");
    const attribution = trustedDomainAttribution(invocation);
    const successorConfigRevisionId = randomUUID();
    await insertConfigRevision(tx, {
      id: successorConfigRevisionId, organizationId: auth.organization.id,
      projectId: frozen.projectId, configSetId: frozen.configSetId,
      revisionNumber: await nextConfigRevisionNumber(tx, frozen.configSetId),
      status: "resolved", attribution
    });
    await insertConfigRevisionMembers(tx, successorConfigRevisionId,
      frozen.members.filter((member) => member.fileId !== frozen.fileId).map((member) => ({
        fileId: member.fileId, fileVersionId: member.fileVersionId,
        fileName: member.sourceName, sourceName: member.sourceName,
        format: member.format, role: member.role as ConfigRevisionMemberRole,
        sortOrder: member.sortOrder, content: ""
      })));
    const auditEventId = randomUUID();
    const successorBindings: Array<{
      bindingId: string; oldValueId: string; newValueId: string; sourcePinId: string;
      historyEventId: string; fileId: string; fileVersionId: string;
    }> = [];
    for (const entry of frozen.cohort.filter((row) => row.fileId !== frozen.fileId)) {
      const binding = await loadBindingById(asValueClient(tx), entry.bindingId, "update");
      const old = await loadProjectValueById(asValueClient(tx), entry.oldValueId);
      if (!binding || !old || binding.organization_id !== auth.organization.id
        || binding.project_id !== frozen.projectId || binding.current_value_id !== entry.oldValueId
        || binding.source_occurrence_id !== entry.sourceOccurrenceId
        || binding.catalog_release_id !== snapshot.release.id
        || binding.definition_id !== entry.definitionId
        || binding.effective_revision_id !== entry.effectiveRevisionId
        || old.value_kind !== "json" || old.value_state !== "present"
        || old.value_digest !== entry.valueDigest) conflict("Surviving Binding base is stale.");
      const registration = await readSourceRegistrationAgreement(tx, {
        organizationId: auth.organization.id, subjectId: binding.subject_id
      });
      if (registration?.id !== binding.registration_id
        || snapshot.getDefinitionRevision({
          definitionId: ParameterDefinitionId(binding.definition_id),
          revisionId: DefinitionRevisionId(binding.effective_revision_id)
        }).status !== "found") conflict("Surviving Binding registration or Definition is unavailable.");
      const memberIndex = frozen.members.findIndex((member) => member.fileId === entry.fileId);
      const ownPin = await loadOwnedProjectValueSourcePin(tx, {
        organizationId: auth.organization.id, projectId: frozen.projectId,
        bindingId: entry.bindingId, projectValueId: entry.oldValueId
      });
      if (memberIndex < 0 || !ownPin || ownPin.sourcePinId !== entry.sourcePinId
        || ownPin.configRevisionId !== frozen.configRevisionId
        || ownPin.locator.kind !== "json-pointer"
        || typeof ownPin.locator.pointer !== "string" || ownPin.rootPointer === null) {
        conflict("Surviving Binding has no exact JSON source locator.");
      }
      const sourceValue = readJsonSourceValue(inspected.files[memberIndex]!.content,
        ownPin.locator.pointer as string, ownPin.rootPointer);
      const payload = { kind: "json" as const, value: old.value as ContractJsonValue };
      const valueDigest = digestProjectValuePayload(payload);
      if (old.value_digest !== valueDigest || !same(sourceValue, payload.value)) {
        conflict("Surviving JSON value differs from its exact source bytes.");
      }
      const newValueId = deriveProjectValueId({
        bindingId: entry.bindingId, definitionRevisionId: DefinitionRevisionId(entry.effectiveRevisionId),
        sourceRef: old.source_ref, configRevisionId: successorConfigRevisionId,
        valueKind: "json", valueDigest, expectedTip: entry.oldValueId
      });
      const inserted = await insertProjectValue(asValueClient(tx), {
        id: newValueId, bindingId: entry.bindingId, definitionId: entry.definitionId,
        definitionRevisionId: entry.effectiveRevisionId, sourceRef: old.source_ref,
        configRevisionId: successorConfigRevisionId, valueDigest, valueKind: "json",
        valueJson: JSON.stringify(payload.value), valueState: "present"
      });
      if (!inserted) conflict("Surviving Value revision already exists.");
      const sourcePinId = randomUUID();
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,
         config_revision_id,file_id,file_version_id,format,locator,locator_digest)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'json',$11::jsonb,$12)`,
      [sourcePinId, newValueId, entry.bindingId, entry.definitionId,
        auth.organization.id, frozen.projectId, entry.sourceOccurrenceId,
        successorConfigRevisionId, entry.fileId, entry.fileVersionId,
        JSON.stringify(entry.locator), `sha256:${digest(serializeContract(entry.locator))}`]);
      if (!await casCurrentTip(asValueClient(tx), {
        bindingId: entry.bindingId, expectedTip: entry.oldValueId, nextTip: newValueId,
        sourceCommitRequestId: review.requestId
      })) conflict("Surviving Binding lost its exact Value tip.");
      const historyEventId = deriveHistoryEventId({
        bindingId: entry.bindingId, oldCurrentValueId: entry.oldValueId, newCurrentValueId: newValueId
      });
      await insertBindingHistoryEvent(asValueClient(tx), {
        id: historyEventId, bindingId: entry.bindingId,
        effectiveRevisionId: entry.effectiveRevisionId,
        oldCurrentValueId: entry.oldValueId, newCurrentValueId: newValueId,
        successAuditRef: auditEventId, catalogReleaseId: entry.catalogReleaseId,
        reason: "source-revision-propagation"
      });
      successorBindings.push({ bindingId: entry.bindingId, oldValueId: entry.oldValueId,
        newValueId, sourcePinId, historyEventId, fileId: entry.fileId,
        fileVersionId: entry.fileVersionId });
    }
    const removedBindings = frozen.cohort.filter((row) => row.fileId === frozen.fileId)
      .map((row) => ({ bindingId: row.bindingId, valueId: row.oldValueId, sourcePinId: row.sourcePinId }));
    const tombstoneId = randomUUID();
    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      id: auditEventId, invocation, app: "parameters", kind: "parameter-topology-governance",
      action: "source-member-removed", severity: "Medium", projectId: frozen.projectId,
      targetType: "project-parameter-file", targetId: frozen.fileId,
      metadata: {
        tombstoneId, configSetId: frozen.configSetId, configRevisionId: frozen.configRevisionId,
        fileVersionId: frozen.fileVersionId, bindings: removedBindings,
        successorConfigRevisionId, successorBindings,
        reviewRequestId: review.requestId, submitterUserId: review.submitterUserId,
        proofDigest: frozen.proofDigest
      }, traceId: context.traceId
    });
    await tx.query("set local role parameter_governance_writer_role");
    await tx.query(`select parameter_catalog.insert_reviewed_member_tombstone(
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)`,
    [tombstoneId, auth.organization.id, frozen.projectId, frozen.configSetId,
      frozen.fileId, frozen.configRevisionId, frozen.fileVersionId,
      JSON.stringify(removedBindings), successorConfigRevisionId,
      JSON.stringify(successorBindings), auditEventId]);
    await tx.query("reset role");
    const detached = await tx.query(`update public.project_parameter_files
      set config_set_id=null,config_set_role=null,config_set_sort_order=0,updated_at=now()
      where id=$1 and organization_id=$2 and project_id=$3
        and config_set_id=$4 and current_version_id=$5`,
    [frozen.fileId, auth.organization.id, frozen.projectId,
      frozen.configSetId, frozen.fileVersionId]);
    if (detached.rowCount !== 1) conflict("Removed file lost its exact membership or version.");
    const approved = await tx.query(`update public.project_parameter_value_change_requests
      set status='approved',reviewer_user_id=$2,applied_at=now(),apply_outcome='committed',
        applied_audit_ref=$3,applied_file_version_ids='[]'::jsonb,
        applied_source_result=$4::jsonb,updated_at=now()
      where id=$1 and status='pending' and assigned_to_user_id=$2`,
    [review.requestId, auth.user.id, auditEventId,
      JSON.stringify({ tombstoneId, successorConfigRevisionId })]);
    if (approved.rowCount !== 1) conflict("Member removal review decision changed.");
    return { requestId: review.requestId, tombstoneId, successorConfigRevisionId, replayed: false };
  } catch (error) { rethrowSourceTransactionError(error); }
}

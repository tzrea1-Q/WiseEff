import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AuthContext } from "../auth/types";
import type { TrustedInvocationDomainAttribution } from "../auth/trustedInvocation";
import {
  parseDts,
  resolveDtsConfigSet,
  type DtsConfigSetFile,
  type DtsEffectiveNode,
  type DtsNodeCst,
  type DtsPropertyCst,
} from "../dts";
import { offsetToLineColumn } from "../dts/offsetToLineColumn";
import type {
  LogicalNodeCandidate,
  LogicalNodeSnapshot,
} from "../dts/identity";
import {
  matchDriver,
  matchProperty,
} from "../parameter-specs/matcher";
import {
  getParameterSpecRow,
} from "../parameter-specs/repository";
import { getCachedOrganizationSchemaRegistry } from "../parameter-specs/schemaRegistryCache";
import type {
  MatchableNode,
  SchemaRegistry,
} from "../parameter-specs/types";
import { resolveAttributionModuleForBinding } from "../parameter-modules/ensureAttributionModuleForBinding";
import { lockOrganizationModuleRecognition } from "../parameter-modules/recognitionSettings";
import {
  BOARD_INSTANCE_MODULE_NAME,
  isModuleScaffoldingNode,
  isScaffoldingDriverLabel,
} from "../parameter-modules/modulePlacement";
import { isStructuralPropertyKey } from "./parameterSurface";
import { ApiError } from "../../shared/http/errors";
import type { Database, Queryable } from "../../shared/database/client";
import {
  applyReviewedContinuityToSnapshots,
  listReviewedContinuityDecisions,
  resolveLogicalContinuity,
  countSingletonCardinalityConflicts,
  type ContinuityAmbiguous,
} from "./bindingService";
import { normalizeManifestLogicalPath, normalizePersistedManifest } from "./configRevisionManifest";
import {
  insertConfigRevision,
  insertConfigRevisionMembers,
  insertLogicalNode,
  insertLogicalNodeRevision,
  insertNodeOccurrence,
  insertOccurrenceEffect,
  insertPropertyOccurrence,
  insertValidationDiagnostics,
  insertValidationRun,
  listPreviousLogicalNodeSnapshots,
  nextConfigRevisionNumber,
  updateConfigRevisionStatus,
} from "./repository";
import type {
  ConfigRevisionManifest,
  DtsConfigRevisionDto,
  LineColumn,
  PersistedLogicalNodeRevision,
  PersistedNodeOccurrence,
  PersistedPropertyOccurrence,
} from "./types";

export { offsetToLineColumn };

export type ConfigRevisionIngestOptions = {
  sourceCommit?: { baseConfigRevisionId: string };
  reviewedSource?: ReviewedSourceContinuity;
  /** Typed edits keep identity against the exact persisted revision they patch. */
  continuityBaseConfigRevisionId?: string;
};

/** Frozen by the whole-source owner after read-only continuity inspection. */
export type ReviewedSourceContinuity = {
  baseConfigRevisionId: string;
  restorationBaseConfigRevisionId?: string;
  restorationNodes?: Array<{ baseConfigRevisionId: string; nodeLocator: string; logicalNodeId: string }>;
  nodes: Array<Omit<PersistedLogicalNodeRevision, "id"> & { isNew: boolean }>;
};

const schemasRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schemas/dts",
);

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Locator with leading slash (`/` for root), matching `resolveDtsConfigSet` display paths. */
function displayLocator(locator: string): string {
  return locator === ""
    ? "/"
    : locator.startsWith("/")
      ? locator
      : `/${locator}`;
}

function segmentFor(
  node: Pick<
    DtsNodeCst,
    "name" | "unitAddress" | "refTarget" | "isOverlayRoot"
  >,
): string {
  if (node.isOverlayRoot) return "";
  if (node.refTarget) return node.refTarget;
  if (node.unitAddress !== undefined) return `${node.name}@${node.unitAddress}`;
  return node.name;
}

function joinLocator(parent: string, segment: string): string {
  if (!segment) return parent;
  if (!parent) return segment;
  return `${parent}/${segment}`;
}

function parentLocator(locator: string): string | null {
  if (locator === "/") return null;
  const trimmed = locator.startsWith("/") ? locator.slice(1) : locator;
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return "/";
  return `/${trimmed.slice(0, idx)}`;
}

function locatorDepth(locator: string): number {
  if (locator === "/") return 0;
  return locator.split("/").filter(Boolean).length;
}

function topologyRelationFor(locator: string): string {
  const parent = parentLocator(locator);
  return parent ? `child-of-locator:${parent}` : "root";
}

function parseCompatibleList(rawText: string): string[] {
  return [...rawText.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function extractReg(node: DtsEffectiveNode): string | undefined {
  const reg = node.properties.get("reg");
  if (!reg || reg.deleted) return undefined;
  return reg.rawText;
}

function uniqueKeysFromReg(reg?: string): Record<string, string> | undefined {
  if (!reg) return undefined;
  const match = reg.match(/<\s*(0x[0-9a-fA-F]+|\d+)/);
  if (!match) return undefined;
  return { "i2c-reg": match[1].toLowerCase() };
}

/** "diascope/sc8562" (namespace) → "sc8562"; single-segment namespaces pass through unchanged. */
function driverModuleFromSchemaNamespace(
  schemaNamespace: string | null | undefined,
): string | null {
  if (!schemaNamespace) return null;
  const segments = schemaNamespace
    .split("/")
    .filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1]! : null;
}

function instanceNameFor(
  matchable: Pick<MatchableNode, "name" | "unitAddress">,
): string | null {
  if (!matchable.name) return null;
  if (matchable.name === "/") return BOARD_INSTANCE_MODULE_NAME;
  return matchable.unitAddress
    ? `${matchable.name}@${matchable.unitAddress}`
    : matchable.name;
}

function toMatchableNode(node: DtsEffectiveNode): MatchableNode {
  const compatibleProp = node.properties.get("compatible");
  const compatible =
    compatibleProp && !compatibleProp.deleted
      ? parseCompatibleList(compatibleProp.rawText)
      : [];
  const properties: MatchableNode["properties"] = {};
  for (const [key, property] of node.properties) {
    if (property.deleted) continue;
    properties[key] = { rawText: property.rawText };
  }
  return {
    nodeLocator: node.nodeLocator,
    name: node.name,
    unitAddress: node.unitAddress,
    compatible,
    properties,
  };
}

function toPreviousSnapshot(row: {
  logicalNodeId: string;
  nodeLocator: string;
  name: string;
  unitAddress?: string;
  driverSchemaVersionId?: string | null;
  parentLogicalNodeId: string | null;
  reg?: string;
}): LogicalNodeSnapshot {
  return {
    logicalNodeId: row.logicalNodeId,
    nodeLocator: row.nodeLocator,
    name: row.name,
    unitAddress: row.unitAddress,
    parentLogicalNodeId: row.parentLogicalNodeId,
    driverSchemaVersionId: row.driverSchemaVersionId,
    reg: row.reg,
    uniqueKeys: uniqueKeysFromReg(row.reg),
    topologyRelation: topologyRelationFor(row.nodeLocator),
  };
}

type SourceOccurrence = { nodeOccurrenceId: string; propertyOccurrenceId: string | null };
const originKey = (fileVersionId: string, span: { start: number; end: number }, name: string) =>
  JSON.stringify([fileVersionId, span.start, span.end, name]);

type CollectedOccurrences = {
  nodes: PersistedNodeOccurrence[];
  properties: PersistedPropertyOccurrence[];
  byOrigin: Map<string, SourceOccurrence>;
};

function collectFileOccurrences(
  fileVersionId: string,
  content: string,
): CollectedOccurrences {
  const doc = parseDts(content);
  const nodes: PersistedNodeOccurrence[] = [];
  const properties: PersistedPropertyOccurrence[] = [];
  const byOrigin = new Map<string, SourceOccurrence>();
  let nodeOrder = 0;
  let propertyOrder = 0;

  const walk = (
    cst: DtsNodeCst,
    parentLocatorNoSlash: string,
    parentOccurrenceId: string | null,
  ) => {
    const locatorNoSlash = cst.refTarget
      ? joinLocator(parentLocatorNoSlash, cst.refTarget)
      : joinLocator(parentLocatorNoSlash, segmentFor(cst));
    const nodePath = displayLocator(locatorNoSlash);
    const start = offsetToLineColumn(content, cst.span.start);
    const end = offsetToLineColumn(content, cst.span.end);
    const rawText = content.slice(cst.span.start, cst.span.end);
    const id = randomUUID();

    nodes.push({
      id,
      fileVersionId,
      parentOccurrenceId,
      name: cst.isOverlayRoot ? "/" : cst.refTarget ? cst.refTarget : cst.name,
      unitAddress: cst.unitAddress,
      labels: [...cst.labels],
      refTarget: cst.refTarget,
      isOverlayRoot: cst.isOverlayRoot,
      nodePath,
      startOffset: cst.span.start,
      endOffset: cst.span.end,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
      rawText,
      astJson: {
        kind: "node",
        labels: cst.labels,
        refTarget: cst.refTarget,
        isOverlayRoot: cst.isOverlayRoot,
      },
      sourceOrder: nodeOrder,
      contentHash: contentHash(rawText),
    });
    nodeOrder += 1;

    for (const child of cst.children) {
      if (child.kind === "property") {
        collectProperty(child, id);
      } else if (child.kind === "delete-property") {
        byOrigin.set(originKey(fileVersionId, child.span, child.name), { nodeOccurrenceId: id, propertyOccurrenceId: null });
      } else if (child.kind === "node") {
        walk(child, locatorNoSlash, id);
      }
    }
  };

  function collectProperty(
    prop: DtsPropertyCst,
    nodeOccurrenceId: string,
  ) {
    const propStart = offsetToLineColumn(content, prop.span.start);
    const propEnd = offsetToLineColumn(content, prop.span.end);
    const propId = randomUUID();
    properties.push({
      id: propId,
      nodeOccurrenceId,
      fileVersionId,
      propertyName: prop.name,
      startOffset: prop.span.start,
      endOffset: prop.span.end,
      startLine: propStart.line,
      startColumn: propStart.column,
      endLine: propEnd.line,
      endColumn: propEnd.column,
      rawText: prop.rawText,
      astJson: prop.value ?? { kind: "raw", valueType: prop.valueType },
      sourceOrder: propertyOrder,
      contentHash: contentHash(prop.rawText),
    });
    propertyOrder += 1;
    byOrigin.set(originKey(fileVersionId, prop.span, prop.name), { nodeOccurrenceId, propertyOccurrenceId: propId });
  }

  for (const top of doc.topLevel) {
    walk(top, "", null);
  }

  return {
    nodes,
    properties,
    byOrigin,
  };
}

type ContinuityBuildResult = {
  logicalNodesToInsert: Array<{
    id: string;
    organizationId: string;
    projectId: string;
    configSetId: string;
  }>;
  revisions: PersistedLogicalNodeRevision[];
  revisionByLocator: Map<string, PersistedLogicalNodeRevision>;
  stableLogicalIdByLocator: Map<string, string>;
  ambiguous: Array<{
    previous: LogicalNodeSnapshot;
    continuity: ContinuityAmbiguous;
  }>;
};

async function buildLogicalRevisionsWithContinuity(
  tx: Queryable,
  input: {
    effectiveNodes: Map<string, DtsEffectiveNode>;
    organizationId: string;
    projectId: string;
    configSetId: string;
    revisionNumber: number;
    registry: SchemaRegistry;
    sourceCommit?: { baseConfigRevisionId: string };
    reviewedSource?: ReviewedSourceContinuity;
    continuityBaseConfigRevisionId?: string;
    restorationBaseConfigRevisionId?: string;
    restorationNodes?: ReviewedSourceContinuity["restorationNodes"];
  },
): Promise<ContinuityBuildResult> {
  const previousRows = await listPreviousLogicalNodeSnapshots(tx, {
    configSetId: input.configSetId,
    beforeRevisionNumber: input.revisionNumber,
    baseConfigRevisionId: input.sourceCommit?.baseConfigRevisionId ?? input.reviewedSource?.baseConfigRevisionId
      ?? input.continuityBaseConfigRevisionId,
  });
  const restorationBase = input.reviewedSource?.restorationBaseConfigRevisionId ?? input.restorationBaseConfigRevisionId;
  if (restorationBase) {
    const owned = (await tx.query(`select id from dts_config_revisions where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$4`,
      [restorationBase,input.organizationId,input.projectId,input.configSetId])).rows[0];
    if (!owned) throw new ApiError("CONFLICT","Snapshot identity base is unavailable.");
    const historical = await listPreviousLogicalNodeSnapshots(tx,{ configSetId: input.configSetId,
      beforeRevisionNumber: input.revisionNumber,baseConfigRevisionId: restorationBase });
    for (const row of historical) {
      const existing = previousRows.find((entry) => entry.nodeLocator === row.nodeLocator);
      if (existing && existing.logicalNodeId !== row.logicalNodeId) throw new ApiError("CONFLICT","Current and snapshot node identities disagree; explicit mapping is required.");
      if (!existing) previousRows.push(row);
    }
  }
  // Exact deleted anchors can come from different revisions. Import only each
  // anchor and its parents, never unrelated historical identities at reused paths.
  for (const anchor of input.reviewedSource?.restorationNodes ?? input.restorationNodes ?? []) {
    const owned = (await tx.query(`select id from dts_config_revisions where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$4`,
      [anchor.baseConfigRevisionId,input.organizationId,input.projectId,input.configSetId])).rows[0];
    if (!owned) throw new ApiError("CONFLICT", "已删除参数的历史修订不可用。");
    const historical = await listPreviousLogicalNodeSnapshots(tx, { configSetId: input.configSetId,
      beforeRevisionNumber: input.revisionNumber, baseConfigRevisionId: anchor.baseConfigRevisionId });
    if (historical.find((row) => row.nodeLocator === anchor.nodeLocator)?.logicalNodeId !== anchor.logicalNodeId) {
      throw new ApiError("CONFLICT", "已删除参数的历史节点身份不匹配。");
    }
    let locator: string | null = anchor.nodeLocator;
    while (locator) {
      const row = historical.find((node) => node.nodeLocator === locator);
      if (!row) throw new ApiError("CONFLICT", "已删除参数的历史父节点不可用。");
      const existing = previousRows.find((node) => node.nodeLocator === locator);
      if (existing && existing.logicalNodeId !== row.logicalNodeId) throw new ApiError("CONFLICT", "当前节点与已删除参数的历史身份不一致，无法安全恢复。");
      if (!existing) previousRows.push(row);
      locator = parentLocator(locator);
    }
  }
  const previousSnapshotsBase = previousRows.map(toPreviousSnapshot);

  const sorted = [...input.effectiveNodes.values()]
    .filter((node) => !node.deleted)
    .sort(
      (a, b) =>
        locatorDepth(a.nodeLocator) - locatorDepth(b.nodeLocator) ||
        a.nodeLocator.localeCompare(b.nodeLocator),
    );

  if (input.reviewedSource) {
    const frozen = input.reviewedSource.nodes;
    const previousIds = new Set(previousRows.map((row) => row.logicalNodeId));
    if (frozen.length !== sorted.length || new Set(frozen.map((row) => row.logicalNodeId)).size !== frozen.length) {
      throw new ApiError("CONFLICT", "Reviewed DTS continuity has a different node cohort.");
    }
    const revisions = sorted.map((node) => {
      const row = frozen.find((entry) => entry.nodeLocator === node.nodeLocator);
      const compatibleProperty = node.properties.get("compatible");
      const compatible = compatibleProperty && !compatibleProperty.deleted
        ? compatibleProperty.normalizedValue || compatibleProperty.rawText : undefined;
      const parent = parentLocator(node.nodeLocator);
      const parentId = parent ? frozen.find((entry) => entry.nodeLocator === parent)?.logicalNodeId : null;
      if (!row || row.name !== node.name || row.unitAddress !== node.unitAddress || row.compatible !== compatible
        || row.parentLogicalNodeId !== parentId || row.isNew === previousIds.has(row.logicalNodeId)) {
        throw new ApiError("CONFLICT", "Reviewed DTS continuity no longer matches the source.");
      }
      return { ...row, id: randomUUID() };
    });
    return { revisions, logicalNodesToInsert: frozen.filter((row) => row.isNew).map((row) => ({
      id: row.logicalNodeId, organizationId: input.organizationId, projectId: input.projectId,
      configSetId: input.configSetId
    })), revisionByLocator: new Map(revisions.map((row) => [row.nodeLocator, row])),
    stableLogicalIdByLocator: new Map(revisions.map((row) => [row.nodeLocator, row.logicalNodeId])), ambiguous: [] };
  }

  if (input.sourceCommit) {
    // Only the source owner uses this branch, after revalidating the exact
    // immutable members and single-property CST patch. External import retains
    // the generic continuity matcher below; a locator alone never proves identity.
    const previousByLocator = new Map(previousRows.map((row) => [row.nodeLocator, row]));
    if (!previousRows.length || previousRows.length !== sorted.length || previousByLocator.size !== sorted.length
      || new Set(previousRows.map((row) => row.logicalNodeId)).size !== sorted.length) {
      throw new ApiError("CONFLICT", "Prepared source change has a different or unproven DTS node cohort.");
    }
    const revisions: PersistedLogicalNodeRevision[] = [];
    for (const node of sorted) {
      const previous = previousByLocator.get(node.nodeLocator);
      const parent = parentLocator(node.nodeLocator);
      const parentId = parent ? previousByLocator.get(parent)?.logicalNodeId : null;
      const compatibleProperty = node.properties.get("compatible");
      const compatible = compatibleProperty && !compatibleProperty.deleted
        ? compatibleProperty.normalizedValue || compatibleProperty.rawText : undefined;
      if (!previous || (parent && !parentId) || previous.name !== node.name
        || previous.unitAddress !== node.unitAddress || previous.compatible !== compatible
        || previous.reg !== extractReg(node) || previous.parentLogicalNodeId !== parentId) {
        throw new ApiError("CONFLICT", "Prepared source change cannot alter DTS node identity metadata.");
      }
      revisions.push({ id: randomUUID(), logicalNodeId: previous.logicalNodeId, nodeLocator: node.nodeLocator,
        name: node.name, unitAddress: node.unitAddress, compatible,
        driverSchemaVersionId: previous.driverSchemaVersionId ?? null, parentLogicalNodeId: previous.parentLogicalNodeId });
    }
    return { logicalNodesToInsert: [], revisions,
      revisionByLocator: new Map(revisions.map((row) => [row.nodeLocator, row])),
      stableLogicalIdByLocator: new Map(revisions.map((row) => [row.nodeLocator, row.logicalNodeId])), ambiguous: [] };
  }

  const provisionalByLocator = new Map<string, LogicalNodeCandidate>();
  const driverVersionByLocator = new Map<string, string | null>();

  for (const node of sorted) {
    const matchable = toMatchableNode(node);
    const driverDecision = matchDriver(matchable, input.registry);
    let driverSchemaVersionId: string | null = null;
    if (driverDecision.kind === "matched") {
      // Existing versions remain continuity evidence; importing a source must not
      // rewrite the legacy definitions protected by the maintenance baseline.
      const existing = await getParameterSpecRow(tx, {
        organizationId: input.organizationId,
        specId: `pspec:driver:${driverDecision.value.schemaNamespace}`,
        driverSchemaVersionId: driverDecision.value.id,
      });
      driverSchemaVersionId = existing?.driverSchemaVersionId ?? null;
    }
    driverVersionByLocator.set(node.nodeLocator, driverSchemaVersionId);

    const parentLoc = parentLocator(node.nodeLocator);
    const reg = extractReg(node);
    const provisionalId = randomUUID();
    provisionalByLocator.set(node.nodeLocator, {
      logicalNodeId: provisionalId,
      nodeLocator: node.nodeLocator,
      name: node.name,
      unitAddress: node.unitAddress,
      parentLogicalNodeId: parentLoc
        ? (provisionalByLocator.get(parentLoc)?.logicalNodeId ?? null)
        : null,
      driverSchemaVersionId,
      reg,
      uniqueKeys: uniqueKeysFromReg(reg),
      topologyRelation: topologyRelationFor(node.nodeLocator),
      labels: [...node.labels],
    });
  }

  const candidates = [...provisionalByLocator.values()];
  const reviewedDecisions = await listReviewedContinuityDecisions(tx, {
    configSetId: input.configSetId,
    previousLogicalNodeIds: previousSnapshotsBase.map(
      (row) => row.logicalNodeId,
    ),
  });
  const previousSnapshots = applyReviewedContinuityToSnapshots(
    previousSnapshotsBase,
    candidates,
    reviewedDecisions,
  );
  const claimedProvisional = new Set<string>();
  const stableByProvisional = new Map<string, string>();
  const ambiguous: ContinuityBuildResult["ambiguous"] = [];

  if (input.continuityBaseConfigRevisionId) {
    // A complete unchanged identity tuple is positive continuity evidence for
    // source revisions; the locator alone never selects a prior identity.
    const previousByLocator = new Map(previousRows.map((row) => [row.nodeLocator, row]));
    for (const node of sorted) {
      const previous = previousByLocator.get(node.nodeLocator);
      const candidate = provisionalByLocator.get(node.nodeLocator)!;
      const compatibleProperty = node.properties.get("compatible");
      const compatible = compatibleProperty && !compatibleProperty.deleted
        ? compatibleProperty.normalizedValue || compatibleProperty.rawText : undefined;
      const parent = parentLocator(node.nodeLocator);
      const provisionalParent = parent ? provisionalByLocator.get(parent)?.logicalNodeId : null;
      const stableParent = provisionalParent ? stableByProvisional.get(provisionalParent) : null;
      if (previous && previous.name === node.name && previous.unitAddress === node.unitAddress
        && previous.compatible === compatible && previous.reg === extractReg(node)
        && previous.parentLogicalNodeId === stableParent) {
        claimedProvisional.add(candidate.logicalNodeId);
        stableByProvisional.set(candidate.logicalNodeId, previous.logicalNodeId);
        driverVersionByLocator.set(node.nodeLocator, previous.driverSchemaVersionId ?? null);
      }
    }
  }

  const previousInDepthOrder = [...previousSnapshots].sort(
    (a, b) =>
      locatorDepth(a.nodeLocator) - locatorDepth(b.nodeLocator) ||
      a.nodeLocator.localeCompare(b.nodeLocator),
  );

  for (const previous of previousInDepthOrder) {
    if ([...stableByProvisional.values()].includes(previous.logicalNodeId)) continue;
    const available = candidates.filter(
      (candidate) => !claimedProvisional.has(candidate.logicalNodeId),
    );
    // Prefer candidates whose parent already resolved to the previous parent's stable id.
    const withStableParents = available.map((candidate) => {
      const parentLoc = parentLocator(candidate.nodeLocator);
      if (!parentLoc) return candidate;
      const provisionalParent =
        provisionalByLocator.get(parentLoc)?.logicalNodeId;
      const stableParent =
        provisionalParent && stableByProvisional.has(provisionalParent)
          ? stableByProvisional.get(provisionalParent)!
          : candidate.parentLogicalNodeId;
      return { ...candidate, parentLogicalNodeId: stableParent };
    });

    const continuity = resolveLogicalContinuity(previous, withStableParents);
    if (continuity.kind === "matched") {
      claimedProvisional.add(continuity.candidateLogicalNodeId);
      stableByProvisional.set(
        continuity.candidateLogicalNodeId,
        continuity.stableLogicalNodeId,
      );
    } else if (continuity.kind === "ambiguous") {
      for (const candidate of continuity.candidates) {
        claimedProvisional.add(candidate.logicalNodeId);
        // Keep provisional ids as the candidate identities exposed to mapping review.
        stableByProvisional.set(
          candidate.logicalNodeId,
          candidate.logicalNodeId,
        );
      }
      ambiguous.push({ previous, continuity });
    }
  }

  const previousIds = new Set(
    previousSnapshots.map((row) => row.logicalNodeId),
  );
  const logicalNodesToInsert: ContinuityBuildResult["logicalNodesToInsert"] =
    [];
  const insertedLogicalIds = new Set<string>();
  const revisions: PersistedLogicalNodeRevision[] = [];
  const revisionByLocator = new Map<string, PersistedLogicalNodeRevision>();
  const stableLogicalIdByLocator = new Map<string, string>();

  for (const node of sorted) {
    const provisional = provisionalByLocator.get(node.nodeLocator)!;
    const stableId =
      stableByProvisional.get(provisional.logicalNodeId) ??
      provisional.logicalNodeId;
    stableLogicalIdByLocator.set(node.nodeLocator, stableId);

    if (!previousIds.has(stableId) && !insertedLogicalIds.has(stableId)) {
      logicalNodesToInsert.push({
        id: stableId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        configSetId: input.configSetId,
      });
      insertedLogicalIds.add(stableId);
    }

    const parentLoc = parentLocator(node.nodeLocator);
    const parentStable = parentLoc
      ? (stableLogicalIdByLocator.get(parentLoc) ?? null)
      : null;
    const compatibleProp = node.properties.get("compatible");
    const revision: PersistedLogicalNodeRevision = {
      id: randomUUID(),
      logicalNodeId: stableId,
      nodeLocator: node.nodeLocator,
      name: node.name,
      unitAddress: node.unitAddress,
      compatible:
        compatibleProp && !compatibleProp.deleted
          ? compatibleProp.normalizedValue || compatibleProp.rawText
          : undefined,
      driverSchemaVersionId:
        driverVersionByLocator.get(node.nodeLocator) ?? null,
      parentLogicalNodeId: parentStable,
    };
    revisions.push(revision);
    revisionByLocator.set(node.nodeLocator, revision);
  }

  return {
    logicalNodesToInsert,
    revisions,
    revisionByLocator,
    stableLogicalIdByLocator,
    ambiguous,
  };
}

/** No revisions, logical identities, bindings or values are written by preview. */
export async function prepareReviewedSourceContinuity(tx: Queryable, input: {
  organizationId: string; projectId: string; configSetId: string; baseConfigRevisionId: string;
  effectiveNodes: Map<string, DtsEffectiveNode>; sourceDigest: string;
  restorationBaseConfigRevisionId?: string;
  restorationNodes?: ReviewedSourceContinuity["restorationNodes"];
}): Promise<ReviewedSourceContinuity> {
  const base = (await tx.query<{ revision_number: number }>(
    "select revision_number from dts_config_revisions where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$4",
    [input.baseConfigRevisionId, input.organizationId, input.projectId, input.configSetId])).rows[0];
  if (!base) throw new ApiError("CONFLICT", "Source continuity base is unavailable.");
  const registry = await getCachedOrganizationSchemaRegistry(tx, { schemasRoot, organizationId: input.organizationId });
  const prepared = await buildLogicalRevisionsWithContinuity(tx, { ...input, registry,
    revisionNumber: base.revision_number + 1, continuityBaseConfigRevisionId: input.baseConfigRevisionId });
  if (prepared.ambiguous.length) throw new ApiError("CONFLICT", "DTS node identity continuity requires an explicit mapping decision.", {
    reason: "logical-continuity-decision-needed", nodes: prepared.ambiguous.map((row) => row.previous.nodeLocator)
  });
  const newIds = new Map(prepared.logicalNodesToInsert.map((row) => {
    const node = prepared.revisions.find((entry) => entry.logicalNodeId === row.id)!;
    return [row.id, `srnode_${contentHash(`${input.configSetId}:${input.baseConfigRevisionId}:${input.sourceDigest}:${node.nodeLocator}`)}`];
  }));
  return { baseConfigRevisionId: input.baseConfigRevisionId,
    ...(input.restorationBaseConfigRevisionId ? { restorationBaseConfigRevisionId: input.restorationBaseConfigRevisionId } : {}),
    ...(input.restorationNodes?.length ? { restorationNodes: input.restorationNodes } : {}),
    nodes: prepared.revisions.map(({ id: _id, unitAddress, compatible, ...row }) => ({
    ...row, ...(unitAddress === undefined ? {} : { unitAddress }), ...(compatible === undefined ? {} : { compatible }),
    logicalNodeId: newIds.get(row.logicalNodeId) ?? row.logicalNodeId,
    parentLogicalNodeId: row.parentLogicalNodeId ? newIds.get(row.parentLogicalNodeId) ?? row.parentLogicalNodeId : null,
    isNew: newIds.has(row.logicalNodeId)
  })) };
}

async function discoverAttributionModules(
  tx: Queryable,
  input: { organizationId: string; effectiveNodes: Map<string, DtsEffectiveNode>; registry: SchemaRegistry },
): Promise<void> {
  for (const node of input.effectiveNodes.values()) {
    if (node.deleted) continue;
    const matchable = toMatchableNode(node);
    for (const [propertyKey, property] of node.properties) {
      if (property.deleted || isStructuralPropertyKey(propertyKey)) continue;
      const decision = matchProperty(matchable, propertyKey, input.registry);
      if (decision.kind !== "matched" || isScaffoldingDriverLabel(driverModuleFromSchemaNamespace(decision.value.schemaNamespace))
        || isModuleScaffoldingNode({ name: matchable.name, compatible: matchable.compatible[0] ?? null,
          nodePath: matchable.nodeLocator, unitAddress: matchable.unitAddress })) continue;
      await resolveAttributionModuleForBinding(tx, {
        organizationId: input.organizationId,
        driverModule: driverModuleFromSchemaNamespace(decision.value.schemaNamespace),
        compatible: matchable.compatible[0] ?? null,
        instanceName: instanceNameFor(matchable),
        nodeLocator: matchable.nodeLocator,
      });
    }
  }
}

/**
 * Persist one immutable config-set revision: members, source occurrences, logical nodes,
 * provenance effects, schema match, continuity/bindings, and resolve-stage diagnostics.
 * Never mutates a previous revision.
 */
export async function ingestConfigRevision(
  db: Database,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
  options?: ConfigRevisionIngestOptions,
): Promise<DtsConfigRevisionDto> {
  return db.transaction(async (tx) =>
    ingestConfigRevisionInTransaction(tx, manifest, auth, undefined, options),
  );
}

/** Same as `ingestConfigRevision` but for callers already inside a DB transaction. */
export async function ingestConfigRevisionInTransaction(
  tx: Queryable,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
  attribution?: { createdByUserId: string | null | undefined; domain?: TrustedInvocationDomainAttribution },
  options?: ConfigRevisionIngestOptions,
): Promise<DtsConfigRevisionDto> {
  return ingestConfigRevisionTx(tx, manifest, auth, attribution, options);
}

async function ingestConfigRevisionTx(
  tx: Queryable,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
  attribution?: { createdByUserId: string | null | undefined; domain?: TrustedInvocationDomainAttribution },
  options?: ConfigRevisionIngestOptions,
): Promise<DtsConfigRevisionDto> {
  const dtsMembers = manifest.members.filter((member) => member.format !== "json").map((member) => ({
    ...member, fileName: normalizeManifestLogicalPath(member.sourceName ?? member.fileName) ?? "",
  }));
  const normalized = normalizePersistedManifest({
    entryFile: manifest.entryFile,
    includeSearchPaths: manifest.includeSearchPaths,
    overlayOrder: manifest.overlayOrder,
    members: dtsMembers,
  });
  if (!normalized.ok) {
    throw new ApiError("VALIDATION_FAILED", normalized.failure.message, {
      reason: normalized.failure.code,
    });
  }

  await lockOrganizationModuleRecognition(tx, manifest.organizationId);
  const revisionNumber = await nextConfigRevisionNumber(
    tx,
    manifest.configSetId,
  );
  let revision = await insertConfigRevision(tx, {
    id: randomUUID(),
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configSetId: manifest.configSetId,
    revisionNumber,
    status: "resolving",
    createdByUserId: attribution ? attribution.createdByUserId : auth.user.id,
    attribution: attribution?.domain,
    entryFile: normalized.manifest.entryFile,
    includeSearchPaths: normalized.manifest.includeSearchPaths,
    overlayOrder: normalized.manifest.overlayOrder,
  });

  await insertConfigRevisionMembers(tx, revision.id, manifest.members);

  const files = new Map<string, DtsConfigSetFile>();
  for (const member of dtsMembers) {
    files.set(member.fileName, {
      fileVersionId: member.fileVersionId,
      content: member.content,
    });
  }

  const parseStartedAt = Date.now();
  let resolved;
  try {
    resolved = resolveDtsConfigSet({
      entryFile: normalized.manifest.entryFile,
      includeSearchPaths: normalized.manifest.includeSearchPaths,
      overlayOrder: normalized.manifest.overlayOrder,
      files,
    });
    const referenced = (await tx.query<{ fileId: string; fileVersionId: string; sourceName: string; checksum: string }>(
      `select snapshot.file_id as "fileId",snapshot.file_version_id as "fileVersionId",upstream.source_name as "sourceName",upstream.checksum
       from public.project_shared_dtsi_references reference join public.project_shared_dtsi_snapshots snapshot on snapshot.reference_id=reference.id
       join public.shared_dtsi_revision_members upstream on upstream.revision_id=snapshot.revision_id and upstream.member_id=snapshot.member_id
       where reference.organization_id=$1 and reference.project_id=$2 and reference.config_set_id=$3`,
      [manifest.organizationId, manifest.projectId, manifest.configSetId])).rows;
    for (const reference of referenced) {
      const member = dtsMembers.find(row => row.fileId === reference.fileId && row.fileVersionId === reference.fileVersionId && row.fileName === reference.sourceName);
      if (!member || !resolved.sourceFiles.includes(reference.sourceName)
        || createHash("sha256").update(member.content).digest("hex") !== reference.checksum.replace(/^sha256:/, "")) {
        throw new ApiError("CONFLICT", "固定共享引用必须完整保留且由项目入口实际引用；请通过配置组成变更引用。", { reason: "shared-reference-closure-required" });
      }
    }
  } catch (error) {
    const { defaultMetricsRegistry } =
      await import("../../observability/metrics");
    defaultMetricsRegistry.recordDtsPipelineResult({
      stage: "parse",
      status: "failed",
      durationMs: Math.max(0, Date.now() - parseStartedAt),
    });
    throw error;
  }
  {
    const { defaultMetricsRegistry } =
      await import("../../observability/metrics");
    const hasErrors = resolved.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    );
    defaultMetricsRegistry.recordDtsPipelineResult({
      stage: "parse",
      status: hasErrors ? "failed" : "succeeded",
      durationMs: Math.max(0, Date.now() - parseStartedAt),
    });
  }

  // Fail-closed only on genuine structural errors (include-missing / include-cycle /
  // path-escape / label-duplicate / parse failures). Dangling `&label` overlay targets are
  // emitted as `severity: "warning"` (self-anchored to a synthetic node upstream), so they
  // are persisted and surfaced but never block ingest — the uploaded overlay stays fully
  // manageable without forcing the user to supply the missing definitions.
  const hasErrors = resolved.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  const runId = randomUUID();
  await insertValidationRun(tx, {
    id: runId,
    organizationId: manifest.organizationId,
    configRevisionId: revision.id,
    stage: "resolve",
    status: hasErrors ? "failed" : "passed",
  });
  await insertValidationDiagnostics(
    tx,
    runId,
    resolved.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      id: randomUUID(),
      stage: "resolve",
    })),
  );

  if (hasErrors) {
    revision = await updateConfigRevisionStatus(tx, {
      id: revision.id,
      status: "invalid",
      resolvedAt: new Date().toISOString(),
    });
    return revision;
  }

  const occurrencesByOrigin = new Map<string, SourceOccurrence | null>();

  for (const member of dtsMembers) {
    const collected = collectFileOccurrences(
      member.fileVersionId,
      member.content,
    );
    for (const node of collected.nodes) {
      await insertNodeOccurrence(tx, revision.id, node);
    }
    for (const property of collected.properties) {
      await insertPropertyOccurrence(tx, revision.id, property);
    }
    for (const [key, occurrence] of collected.byOrigin) {
      occurrencesByOrigin.set(key, occurrencesByOrigin.has(key) ? null : occurrence);
    }
  }

  const registry = await getCachedOrganizationSchemaRegistry(tx, {
    schemasRoot,
    organizationId: manifest.organizationId,
  });

  const continuity = await buildLogicalRevisionsWithContinuity(tx, {
    effectiveNodes: resolved.effective.nodesByLocator,
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configSetId: manifest.configSetId,
    revisionNumber,
    registry,
    sourceCommit: options?.sourceCommit,
    reviewedSource: options?.reviewedSource,
    continuityBaseConfigRevisionId: options?.continuityBaseConfigRevisionId,
  });

  if (continuity.ambiguous.length) {
    const identityRunId = randomUUID();
    await insertValidationRun(tx, {
      id: identityRunId,
      organizationId: manifest.organizationId,
      configRevisionId: revision.id,
      stage: "identity",
      status: "failed",
    });
    await insertValidationDiagnostics(tx, identityRunId, continuity.ambiguous.map((relation) => ({
      id: randomUUID(),
      code: "logical-continuity-decision-needed",
      severity: "error",
      stage: "identity",
      message: "Logical continuity is ambiguous; no prior-node identity has been selected.",
      fileName: manifest.entryFile,
      guidance: JSON.stringify(relation),
    })));
  }

  for (const logical of continuity.logicalNodesToInsert) {
    if (options?.sourceCommit) throw new ApiError("CONFLICT", "Prepared source change cannot allocate a new DTS logical identity.");
    await insertLogicalNode(tx, logical);
  }
  for (const logicalRevision of continuity.revisions) {
    await insertLogicalNodeRevision(tx, revision.id, logicalRevision);
  }

  let effectOrder = 0;
  for (const node of resolved.effective.nodesByLocator.values()) {
    const logicalRevision = continuity.revisionByLocator.get(node.nodeLocator);
    if (!logicalRevision) continue;

    for (const property of node.properties.values()) {
      for (const entry of property.sourceChain) {
        // Repeated includes reuse the same original occurrence; resolved alias paths
        // must never be guessed from a property name or value in another node.
        const occurrence = entry.origin
          ? occurrencesByOrigin.get(originKey(entry.origin.fileVersionId, entry.origin, entry.propertyName)) : null;
        const propertyOccurrenceId = occurrence?.propertyOccurrenceId ?? null;
        const nodeOccurrenceId = occurrence?.nodeOccurrenceId ?? null;

        await insertOccurrenceEffect(tx, revision.id, {
          id: randomUUID(),
          logicalNodeRevisionId: logicalRevision.id,
          propertyName: entry.propertyName,
          effectKind: entry.effect,
          nodeOccurrenceId,
          propertyOccurrenceId,
          sourceOrder: effectOrder,
        });
        effectOrder += 1;
      }
    }
  }

  if (!options?.sourceCommit && !options?.reviewedSource) {
    await discoverAttributionModules(tx, {
      organizationId: manifest.organizationId,
      effectiveNodes: resolved.effective.nodesByLocator,
      registry,
    });
  }

  const singletonConflicts = await countSingletonCardinalityConflicts(tx, {
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configRevisionId: revision.id,
  });

  if (continuity.ambiguous.length > 0 || singletonConflicts > 0) {
    revision = await updateConfigRevisionStatus(tx, {
      id: revision.id,
      status: "needs_mapping",
      resolvedAt: new Date().toISOString(),
    });
    return revision;
  }

  revision = await updateConfigRevisionStatus(tx, {
    id: revision.id,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  });
  return revision;
}

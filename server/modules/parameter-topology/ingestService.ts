import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AuthContext } from "../auth/types";
import {
  parseDts,
  resolveDtsConfigSet,
  type DtsConfigSetFile,
  type DtsEffectiveNode,
  type DtsNodeCst,
  type DtsPropertyCst,
  type DtsSourceChainEntry,
} from "../dts";
import type { LogicalNodeCandidate, LogicalNodeSnapshot } from "../dts/identity";
import {
  matchDriver,
  matchProperty,
  reviewTasksForDecision,
} from "../parameter-specs/matcher";
import {
  getParameterSpecRow,
  listMatcherOverridesForProject,
  matcherOverrideLookupKey,
  persistedMatcherOverrideLookupKey,
  persistOpenReviewTaskDrafts,
  upsertMatchedDriverSchema,
  upsertMatchedPropertySpec,
  upsertOccurrenceSpecDecision,
  type PersistedMatcherOverride,
} from "../parameter-specs/repository";
import { loadSchemaRegistry } from "../parameter-specs/schemaLoader";
import type { MatchableNode, SchemaRegistry, SpecReviewTaskDraft } from "../parameter-specs/types";
import { resolveModuleIdForBinding } from "../parameter-modules/resolveModuleForBinding";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  createOrReuseBinding,
  persistAmbiguousIdentityMapping,
  applyReviewedContinuityToSnapshots,
  listReviewedContinuityDecisions,
  resolveLogicalContinuity,
  upsertBindingRevisionValues,
  type ContinuityAmbiguous,
} from "./bindingService";
import { normalizePersistedManifest } from "./configRevisionManifest";
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

const schemasRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/dts");

export function offsetToLineColumn(source: string, offset: number): LineColumn {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let i = 0; i < end; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Locator with leading slash (`/` for root), matching `resolveDtsConfigSet` display paths. */
function displayLocator(locator: string): string {
  return locator === "" ? "/" : locator.startsWith("/") ? locator : `/${locator}`;
}

function segmentFor(node: Pick<DtsNodeCst, "name" | "unitAddress" | "refTarget" | "isOverlayRoot">): string {
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
function driverModuleFromSchemaNamespace(schemaNamespace: string | null | undefined): string | null {
  if (!schemaNamespace) return null;
  const segments = schemaNamespace.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1]! : null;
}

function instanceNameFor(matchable: Pick<MatchableNode, "name" | "unitAddress">): string | null {
  if (!matchable.name) return null;
  return matchable.unitAddress ? `${matchable.name}@${matchable.unitAddress}` : matchable.name;
}

function toMatchableNode(node: DtsEffectiveNode): MatchableNode {
  const compatibleProp = node.properties.get("compatible");
  const compatible =
    compatibleProp && !compatibleProp.deleted ? parseCompatibleList(compatibleProp.rawText) : [];
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

type PropertyMatchKey = string;

function propertyMatchKey(
  fileName: string,
  nodeLocator: string,
  propertyName: string,
  rawText: string,
): PropertyMatchKey {
  return `${fileName}\0${nodeLocator}\0${propertyName}\0${rawText}`;
}

type CollectedOccurrences = {
  nodes: PersistedNodeOccurrence[];
  properties: PersistedPropertyOccurrence[];
  propertyQueues: Map<PropertyMatchKey, string[]>;
  nodeByPathAndFile: Map<string, string>;
  nodeIdByPropertyId: Map<string, string>;
};

function collectFileOccurrences(
  fileName: string,
  fileVersionId: string,
  content: string,
): CollectedOccurrences {
  const doc = parseDts(content);
  const nodes: PersistedNodeOccurrence[] = [];
  const properties: PersistedPropertyOccurrence[] = [];
  const propertyQueues = new Map<PropertyMatchKey, string[]>();
  const nodeByPathAndFile = new Map<string, string>();
  const nodeIdByPropertyId = new Map<string, string>();
  let nodeOrder = 0;
  let propertyOrder = 0;

  const walk = (cst: DtsNodeCst, parentLocatorNoSlash: string, parentOccurrenceId: string | null) => {
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
    nodeByPathAndFile.set(`${fileName}\0${nodePath}`, id);

    for (const child of cst.children) {
      if (child.kind === "property") {
        collectProperty(child, id, nodePath);
      } else if (child.kind === "node") {
        walk(child, locatorNoSlash, id);
      }
    }
  };

  function collectProperty(prop: DtsPropertyCst, nodeOccurrenceId: string, ownerPath: string) {
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
    nodeIdByPropertyId.set(propId, nodeOccurrenceId);
    const key = propertyMatchKey(fileName, ownerPath, prop.name, prop.rawText);
    const queue = propertyQueues.get(key) ?? [];
    queue.push(propId);
    propertyQueues.set(key, queue);
  }

  for (const top of doc.topLevel) {
    walk(top, "", null);
  }

  return { nodes, properties, propertyQueues, nodeByPathAndFile, nodeIdByPropertyId };
}

function takePropertyOccurrenceId(
  queues: Map<PropertyMatchKey, string[]>,
  entry: DtsSourceChainEntry,
): string | null {
  const key = propertyMatchKey(entry.fileName, entry.nodeLocator, entry.propertyName, entry.rawText);
  const queue = queues.get(key);
  if (queue && queue.length > 0) {
    return queue.shift() ?? null;
  }
  const loosePrefix = `${entry.fileName}\0${entry.nodeLocator}\0${entry.propertyName}\0`;
  for (const [candidateKey, candidateQueue] of queues) {
    if (candidateKey.startsWith(loosePrefix) && candidateQueue.length > 0) {
      return candidateQueue.shift() ?? null;
    }
  }
  // Overlay `&label` fragments are collected under the ref path (e.g. `/same_label`) while
  // effective sourceChain entries use the resolved target locator (e.g. `/charging_core`).
  const filePrefix = `${entry.fileName}\0`;
  const nameAndRawSuffix = `\0${entry.propertyName}\0${entry.rawText}`;
  for (const [candidateKey, candidateQueue] of queues) {
    if (
      candidateKey.startsWith(filePrefix) &&
      candidateKey.endsWith(nameAndRawSuffix) &&
      candidateQueue.length > 0
    ) {
      return candidateQueue.shift() ?? null;
    }
  }
  return null;
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
  ambiguous: Array<{ previous: LogicalNodeSnapshot; continuity: ContinuityAmbiguous }>;
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
  },
): Promise<ContinuityBuildResult> {
  const previousRows = await listPreviousLogicalNodeSnapshots(tx, {
    configSetId: input.configSetId,
    beforeRevisionNumber: input.revisionNumber,
  });
  const previousSnapshotsBase = previousRows.map(toPreviousSnapshot);

  const sorted = [...input.effectiveNodes.values()]
    .filter((node) => !node.deleted)
    .sort(
      (a, b) =>
        locatorDepth(a.nodeLocator) - locatorDepth(b.nodeLocator) ||
        a.nodeLocator.localeCompare(b.nodeLocator),
    );

  const provisionalByLocator = new Map<string, LogicalNodeCandidate>();
  const driverVersionByLocator = new Map<string, string | null>();

  for (const node of sorted) {
    const matchable = toMatchableNode(node);
    const driverDecision = matchDriver(matchable, input.registry);
    let driverSchemaVersionId: string | null = null;
    if (driverDecision.kind === "matched") {
      const upserted = await upsertMatchedDriverSchema(tx, driverDecision.value);
      driverSchemaVersionId = upserted.driverSchemaVersionId;
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
    previousLogicalNodeIds: previousSnapshotsBase.map((row) => row.logicalNodeId),
  });
  const previousSnapshots = applyReviewedContinuityToSnapshots(
    previousSnapshotsBase,
    candidates,
    reviewedDecisions,
  );
  const claimedProvisional = new Set<string>();
  const stableByProvisional = new Map<string, string>();
  const ambiguous: ContinuityBuildResult["ambiguous"] = [];

  const previousInDepthOrder = [...previousSnapshots].sort(
    (a, b) =>
      locatorDepth(a.nodeLocator) - locatorDepth(b.nodeLocator) ||
      a.nodeLocator.localeCompare(b.nodeLocator),
  );

  for (const previous of previousInDepthOrder) {
    const available = candidates.filter((candidate) => !claimedProvisional.has(candidate.logicalNodeId));
    // Prefer candidates whose parent already resolved to the previous parent's stable id.
    const withStableParents = available.map((candidate) => {
      const parentLoc = parentLocator(candidate.nodeLocator);
      if (!parentLoc) return candidate;
      const provisionalParent = provisionalByLocator.get(parentLoc)?.logicalNodeId;
      const stableParent =
        provisionalParent && stableByProvisional.has(provisionalParent)
          ? stableByProvisional.get(provisionalParent)!
          : candidate.parentLogicalNodeId;
      return { ...candidate, parentLogicalNodeId: stableParent };
    });

    const continuity = resolveLogicalContinuity(previous, withStableParents);
    if (continuity.kind === "matched") {
      claimedProvisional.add(continuity.candidateLogicalNodeId);
      stableByProvisional.set(continuity.candidateLogicalNodeId, continuity.stableLogicalNodeId);
    } else if (continuity.kind === "ambiguous") {
      for (const candidate of continuity.candidates) {
        claimedProvisional.add(candidate.logicalNodeId);
        // Keep provisional ids as the candidate identities exposed to mapping review.
        stableByProvisional.set(candidate.logicalNodeId, candidate.logicalNodeId);
      }
      ambiguous.push({ previous, continuity });
    }
  }

  const previousIds = new Set(previousSnapshots.map((row) => row.logicalNodeId));
  const logicalNodesToInsert: ContinuityBuildResult["logicalNodesToInsert"] = [];
  const insertedLogicalIds = new Set<string>();
  const revisions: PersistedLogicalNodeRevision[] = [];
  const revisionByLocator = new Map<string, PersistedLogicalNodeRevision>();
  const stableLogicalIdByLocator = new Map<string, string>();

  for (const node of sorted) {
    const provisional = provisionalByLocator.get(node.nodeLocator)!;
    const stableId =
      stableByProvisional.get(provisional.logicalNodeId) ?? provisional.logicalNodeId;
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
    const parentStable = parentLoc ? (stableLogicalIdByLocator.get(parentLoc) ?? null) : null;
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
      driverSchemaVersionId: driverVersionByLocator.get(node.nodeLocator) ?? null,
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

function buildOverrideIndex(overrides: PersistedMatcherOverride[]): Map<string, PersistedMatcherOverride> {
  const index = new Map<string, PersistedMatcherOverride>();
  for (const override of overrides) {
    index.set(persistedMatcherOverrideLookupKey(override), override);
  }
  return index;
}

/**
 * Match properties, apply reusable matcher overrides, create bindings, and queue
 * open review tasks with precise locate evidence. Dismissed overrides skip review
 * recreation and never pretend the property matched.
 */
async function matchBindAndQueueReviews(
  tx: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    effectiveNodes: Map<string, DtsEffectiveNode>;
    stableLogicalIdByLocator: Map<string, string>;
    propertyOccurrenceByKey: Map<string, string>;
    registry: SchemaRegistry;
  },
): Promise<SpecReviewTaskDraft[]> {
  const overrides = await listMatcherOverridesForProject(tx, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  const overrideByKey = buildOverrideIndex(overrides);
  const reviewDrafts: SpecReviewTaskDraft[] = [];

  for (const node of input.effectiveNodes.values()) {
    if (node.deleted) continue;
    const logicalNodeId = input.stableLogicalIdByLocator.get(node.nodeLocator);
    if (!logicalNodeId) continue;
    const matchable = toMatchableNode(node);

    for (const [propertyKey, property] of node.properties) {
      if (property.deleted) continue;
      const propertyOccurrenceId =
        input.propertyOccurrenceByKey.get(`${node.nodeLocator}\0${propertyKey}`) ?? null;
      const locate = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        configRevisionId: input.configRevisionId,
        propertyOccurrenceId,
        logicalNodeId,
      };
      const override = overrideByKey.get(
        matcherOverrideLookupKey({
          compatible: matchable.compatible,
          nodeLocator: matchable.nodeLocator,
          propertyKey,
        }),
      );

      if (override?.decision === "dismissed") {
        if (propertyOccurrenceId) {
          await upsertOccurrenceSpecDecision(tx, {
            organizationId: input.organizationId,
            projectId: input.projectId,
            configRevisionId: input.configRevisionId,
            propertyOccurrenceId,
            logicalNodeId,
            propertyKey,
            decision: "dismissed",
            parameterSpecId: null,
            bindingId: null,
            reviewTaskId: override.sourceReviewTaskId,
          });
        }
        continue;
      }

      if (override?.decision === "resolved" && override.parameterSpecId) {
        const spec = await getParameterSpecRow(tx, {
          organizationId: input.organizationId,
          specId: override.parameterSpecId,
        });
        if (!spec?.currentVersionId) continue;
        const overrideModuleId = await resolveModuleIdForBinding(tx, {
          organizationId: input.organizationId,
          driverModule: spec.driverModule,
          compatible: matchable.compatible[0] ?? null,
          instanceName: instanceNameFor(matchable),
        });
        const binding = await createOrReuseBinding(tx, {
          organizationId: input.organizationId,
          key: {
            projectId: input.projectId,
            logicalNodeId,
            parameterSpecId: override.parameterSpecId,
            moduleId: overrideModuleId,
          },
        });
        await upsertBindingRevisionValues(tx, {
          bindingId: binding.id,
          configRevisionId: input.configRevisionId,
          parameterSpecVersionId: spec.currentVersionId,
          values: {
            typedValue: property.value ?? { kind: "raw", rawText: property.rawText },
            canonicalValue: property.value ?? property.normalizedValue,
            rawValue: property.rawText,
            schemaState: "reviewed",
          },
        });
        if (propertyOccurrenceId) {
          await upsertOccurrenceSpecDecision(tx, {
            organizationId: input.organizationId,
            projectId: input.projectId,
            configRevisionId: input.configRevisionId,
            propertyOccurrenceId,
            logicalNodeId,
            propertyKey,
            decision: "resolved",
            parameterSpecId: override.parameterSpecId,
            bindingId: binding.id,
            reviewTaskId: override.sourceReviewTaskId,
          });
        }
        continue;
      }

      const decision = matchProperty(matchable, propertyKey, input.registry);
      if (decision.kind === "matched") {
        const { parameterSpecId, parameterSpecVersionId } = await upsertMatchedPropertySpec(
          tx,
          decision.value,
        );
        const matchedModuleId = await resolveModuleIdForBinding(tx, {
          organizationId: input.organizationId,
          driverModule: driverModuleFromSchemaNamespace(decision.value.schemaNamespace),
          compatible: matchable.compatible[0] ?? null,
          instanceName: instanceNameFor(matchable),
        });
        const binding = await createOrReuseBinding(tx, {
          organizationId: input.organizationId,
          key: {
            projectId: input.projectId,
            logicalNodeId,
            parameterSpecId,
            moduleId: matchedModuleId,
          },
        });
        await upsertBindingRevisionValues(tx, {
          bindingId: binding.id,
          configRevisionId: input.configRevisionId,
          parameterSpecVersionId,
          values: {
            typedValue: property.value ?? { kind: "raw", rawText: property.rawText },
            canonicalValue: property.value ?? property.normalizedValue,
            rawValue: property.rawText,
            schemaState: "matched",
          },
        });
        continue;
      }

      reviewDrafts.push(...reviewTasksForDecision(decision, matchable, propertyKey, locate));
    }
  }

  return reviewDrafts;
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
): Promise<DtsConfigRevisionDto> {
  return db.transaction(async (tx) => ingestConfigRevisionInTransaction(tx, manifest, auth));
}

/** Same as `ingestConfigRevision` but for callers already inside a DB transaction. */
export async function ingestConfigRevisionInTransaction(
  tx: Queryable,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
): Promise<DtsConfigRevisionDto> {
  return ingestConfigRevisionTx(tx, manifest, auth);
}

async function ingestConfigRevisionTx(
  tx: Queryable,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
): Promise<DtsConfigRevisionDto> {
  const normalized = normalizePersistedManifest({
    entryFile: manifest.entryFile,
    includeSearchPaths: manifest.includeSearchPaths,
    overlayOrder: manifest.overlayOrder,
    members: manifest.members,
  });
  if (!normalized.ok) {
    throw new ApiError("VALIDATION_FAILED", normalized.failure.message, 400, {
      reason: normalized.failure.code,
    });
  }

  const revisionNumber = await nextConfigRevisionNumber(tx, manifest.configSetId);
  let revision = await insertConfigRevision(tx, {
    id: randomUUID(),
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configSetId: manifest.configSetId,
    revisionNumber,
    status: "resolving",
    createdByUserId: auth.user.id,
    entryFile: normalized.manifest.entryFile,
    includeSearchPaths: normalized.manifest.includeSearchPaths,
    overlayOrder: normalized.manifest.overlayOrder,
  });

  await insertConfigRevisionMembers(tx, revision.id, manifest.members);

  const files = new Map<string, DtsConfigSetFile>();
  for (const member of manifest.members) {
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
  } catch (error) {
    const { defaultMetricsRegistry } = await import("../../observability/metrics");
    defaultMetricsRegistry.recordDtsPipelineResult({
      stage: "parse",
      status: "failed",
      durationMs: Math.max(0, Date.now() - parseStartedAt),
    });
    throw error;
  }
  {
    const { defaultMetricsRegistry } = await import("../../observability/metrics");
    const hasErrors = resolved.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    defaultMetricsRegistry.recordDtsPipelineResult({
      stage: "parse",
      status: hasErrors ? "failed" : "succeeded",
      durationMs: Math.max(0, Date.now() - parseStartedAt),
    });
  }

  const hasErrors = resolved.diagnostics.some((diagnostic) => diagnostic.severity === "error");
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

  const mergedQueues = new Map<PropertyMatchKey, string[]>();
  const nodeByPathAndFile = new Map<string, string>();
  const nodeIdByPropertyId = new Map<string, string>();

  for (const member of manifest.members) {
    const collected = collectFileOccurrences(member.fileName, member.fileVersionId, member.content);
    for (const node of collected.nodes) {
      await insertNodeOccurrence(tx, revision.id, node);
    }
    for (const property of collected.properties) {
      await insertPropertyOccurrence(tx, revision.id, property);
    }
    for (const [key, queue] of collected.propertyQueues) {
      const existing = mergedQueues.get(key) ?? [];
      existing.push(...queue);
      mergedQueues.set(key, existing);
    }
    for (const [key, id] of collected.nodeByPathAndFile) {
      nodeByPathAndFile.set(key, id);
    }
    for (const [propId, nodeId] of collected.nodeIdByPropertyId) {
      nodeIdByPropertyId.set(propId, nodeId);
    }
  }

  const registry = loadSchemaRegistry(schemasRoot);

  const continuity = await buildLogicalRevisionsWithContinuity(tx, {
    effectiveNodes: resolved.effective.nodesByLocator,
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configSetId: manifest.configSetId,
    revisionNumber,
    registry,
  });

  for (const logical of continuity.logicalNodesToInsert) {
    await insertLogicalNode(tx, logical);
  }
  for (const logicalRevision of continuity.revisions) {
    await insertLogicalNodeRevision(tx, revision.id, logicalRevision);
  }

  const propertyOccurrenceByKey = new Map<string, string>();
  let effectOrder = 0;
  for (const node of resolved.effective.nodesByLocator.values()) {
    const logicalRevision = continuity.revisionByLocator.get(node.nodeLocator);
    if (!logicalRevision) continue;

    for (const property of node.properties.values()) {
      for (const entry of property.sourceChain) {
        const propertyOccurrenceId = takePropertyOccurrenceId(mergedQueues, entry);
        const nodeOccurrenceId =
          (propertyOccurrenceId ? nodeIdByPropertyId.get(propertyOccurrenceId) : undefined) ??
          nodeByPathAndFile.get(`${entry.fileName}\0${entry.nodeLocator}`) ??
          null;

        if (
          propertyOccurrenceId &&
          (entry.effect === "set" || entry.effect === "override") &&
          !property.deleted
        ) {
          propertyOccurrenceByKey.set(`${node.nodeLocator}\0${entry.propertyName}`, propertyOccurrenceId);
        }

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

  const reviewDrafts = await matchBindAndQueueReviews(tx, {
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configRevisionId: revision.id,
    effectiveNodes: resolved.effective.nodesByLocator,
    stableLogicalIdByLocator: continuity.stableLogicalIdByLocator,
    propertyOccurrenceByKey,
    registry,
  });
  await persistOpenReviewTaskDrafts(tx, manifest.organizationId, reviewDrafts);

  for (const item of continuity.ambiguous) {
    await persistAmbiguousIdentityMapping(tx, {
      organizationId: manifest.organizationId,
      projectId: manifest.projectId,
      configRevisionId: revision.id,
      previous: item.previous,
      continuity: item.continuity,
    });
  }

  if (continuity.ambiguous.length > 0) {
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

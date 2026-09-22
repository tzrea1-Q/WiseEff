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
import { getCachedOrganizationSchemaRegistry } from "../parameter-specs/schemaRegistryCache";
import type {
  MatchableNode,
  SchemaRegistry,
  SpecReviewTaskDraft,
} from "../parameter-specs/types";
import { resolveAttributionModuleForBinding } from "../parameter-modules/ensureAttributionModuleForBinding";
import {
  BOARD_INSTANCE_MODULE_NAME,
  isModuleScaffoldingNode,
  isScaffoldingDriverLabel,
} from "../parameter-modules/modulePlacement";
import { isStructuralPropertyKey } from "./parameterSurface";
import { ApiError } from "../../shared/http/errors";
import type { Database, Queryable } from "../../shared/database/client";
import {
  persistAmbiguousIdentityMapping,
  applyReviewedContinuityToSnapshots,
  listReviewedContinuityDecisions,
  resolveLogicalContinuity,
  syncSingletonCardinalityBlockingTasks,
  upsertBindingRevisionValues,
  type ContinuityAmbiguous,
} from "./bindingService";
import { createRecognizedBinding } from "../parameter-specs/effectiveDefinitionService";
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
  /** Seed rebuild owns canonical publication; retain module discovery without legacy spec/binding writes. */
  legacyProjection?: "skip";
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

function isPrivilegeDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42501"
  );
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
    legacyProjection?: "skip";
  },
): Promise<ContinuityBuildResult> {
  const previousRows = await listPreviousLogicalNodeSnapshots(tx, {
    configSetId: input.configSetId,
    beforeRevisionNumber: input.revisionNumber,
    baseConfigRevisionId: input.sourceCommit?.baseConfigRevisionId,
  });
  const previousSnapshotsBase = previousRows.map(toPreviousSnapshot);

  const sorted = [...input.effectiveNodes.values()]
    .filter((node) => !node.deleted)
    .sort(
      (a, b) =>
        locatorDepth(a.nodeLocator) - locatorDepth(b.nodeLocator) ||
        a.nodeLocator.localeCompare(b.nodeLocator),
    );

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
    if (driverDecision.kind === "matched" && input.legacyProjection === "skip") {
      // Existing versions remain continuity evidence; importing a source must not
      // rewrite the legacy definitions protected by the maintenance baseline.
      const existing = await getParameterSpecRow(tx, {
        organizationId: input.organizationId,
        specId: `pspec:driver:${driverDecision.value.schemaNamespace}`,
        driverSchemaVersionId: driverDecision.value.id,
      });
      driverSchemaVersionId = existing?.driverSchemaVersionId ?? null;
    } else if (driverDecision.kind === "matched") {
      await tx.query("savepoint skip_legacy_driver_spec");
      try {
        const upserted = await upsertMatchedDriverSchema(
          tx,
          driverDecision.value,
        );
        driverSchemaVersionId = upserted.driverSchemaVersionId;
        await tx.query("release savepoint skip_legacy_driver_spec");
      } catch (error) {
        await tx.query("rollback to savepoint skip_legacy_driver_spec").catch(() => undefined);
        if (!isPrivilegeDenied(error)) {
          throw error;
        }
      }
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

  const previousInDepthOrder = [...previousSnapshots].sort(
    (a, b) =>
      locatorDepth(a.nodeLocator) - locatorDepth(b.nodeLocator) ||
      a.nodeLocator.localeCompare(b.nodeLocator),
  );

  for (const previous of previousInDepthOrder) {
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

function buildOverrideIndex(
  overrides: PersistedMatcherOverride[],
): Map<string, PersistedMatcherOverride> {
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
    attribution?: TrustedInvocationDomainAttribution;
    legacyProjection?: "skip";
  },
): Promise<SpecReviewTaskDraft[]> {
  const overrides = input.legacyProjection === "skip" ? [] : await listMatcherOverridesForProject(tx, {
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
      // Structural keys (status, compatible, …) are node enablement / topology
      // metadata — never specs, bindings, or review tasks (ADR-0003).
      if (isStructuralPropertyKey(propertyKey)) continue;
      const propertyOccurrenceId =
        input.propertyOccurrenceByKey.get(
          `${node.nodeLocator}\0${propertyKey}`,
        ) ?? null;
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
        const overrideModuleId = await resolveAttributionModuleForBinding(tx, {
          organizationId: input.organizationId,
          driverModule: spec.driverModule,
          compatible: matchable.compatible[0] ?? null,
          instanceName: instanceNameFor(matchable),
          nodeLocator: matchable.nodeLocator,
          attributionSubjectId: spec.attributionSubjectId,
        });
        const { binding } = await createRecognizedBinding(tx, {
          organizationId: input.organizationId,
          projectId: input.projectId,
          logicalNodeId,
          parameterSpecId: override.parameterSpecId,
          parameterSpecVersionId: spec.currentVersionId,
          moduleId: overrideModuleId,
        });
        await upsertBindingRevisionValues(tx, {
          bindingId: binding.id,
          configRevisionId: input.configRevisionId,
          parameterSpecVersionId: spec.currentVersionId,
          values: {
            typedValue: property.value ?? {
              kind: "raw",
              rawText: property.rawText,
            },
            canonicalValue: property.value ?? property.normalizedValue,
            rawValue: property.rawText,
            schemaState: "valid",
          },
          attribution: input.attribution,
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
        // A schema attached to a bus/interconnect scaffolding driver (for
        // example `interrupt-parent` on `arm,amba-bus`) is topology metadata,
        // not a product parameter. Keep its occurrence in the immutable DTS
        // record, but do not create an unclassified binding/module. Unknown
        // properties still reach review, even when their node name resembles
        // a scaffolding segment.
        if (
          isScaffoldingDriverLabel(
            driverModuleFromSchemaNamespace(decision.value.schemaNamespace),
          ) ||
          isModuleScaffoldingNode({
            name: matchable.name,
            compatible: matchable.compatible[0] ?? null,
            nodePath: matchable.nodeLocator,
            unitAddress: matchable.unitAddress,
          })
        ) {
          continue;
        }
        let matchedSpec: Awaited<ReturnType<typeof upsertMatchedPropertySpec>> | undefined;
        if (input.legacyProjection !== "skip") {
          await tx.query("savepoint skip_legacy_property_spec");
          try {
            matchedSpec = await upsertMatchedPropertySpec(tx, decision.value);
            await tx.query("release savepoint skip_legacy_property_spec");
          } catch (error) {
            await tx.query("rollback to savepoint skip_legacy_property_spec").catch(() => undefined);
            if (!isPrivilegeDenied(error)) {
              throw error;
            }
            continue;
          }
        }
        const matchedModuleId = await resolveAttributionModuleForBinding(tx, {
          organizationId: input.organizationId,
          driverModule: driverModuleFromSchemaNamespace(
            decision.value.schemaNamespace,
          ),
          compatible: matchable.compatible[0] ?? null,
          instanceName: instanceNameFor(matchable),
          nodeLocator: matchable.nodeLocator,
          attributionSubjectId: matchedSpec?.attributionSubjectId,
        });
        if (!matchedSpec) continue;
        const {
          parameterSpecId,
          parameterSpecVersionId,
        } = matchedSpec;
        const { binding } = await createRecognizedBinding(tx, {
          organizationId: input.organizationId,
          projectId: input.projectId,
          logicalNodeId,
          parameterSpecId,
          parameterSpecVersionId,
          moduleId: matchedModuleId,
        });
        await upsertBindingRevisionValues(tx, {
          bindingId: binding.id,
          configRevisionId: input.configRevisionId,
          parameterSpecVersionId,
          values: {
            typedValue: property.value ?? {
              kind: "raw",
              rawText: property.rawText,
            },
            canonicalValue: property.value ?? property.normalizedValue,
            rawValue: property.rawText,
            schemaState: "valid",
          },
          attribution: input.attribution,
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
            parameterSpecId,
            bindingId: binding.id,
            reviewTaskId: null,
          });
        }
        continue;
      }

      // An unmatched property is never recognized from a historical binding.
      // Continuity may carry logical-node identity, but it cannot prove the
      // current canonical subject, unique active version, or authoritative
      // placement. Keep this occurrence as review evidence until the current
      // registry resolves it through the matched path above.
      if (input.legacyProjection !== "skip") {
        reviewDrafts.push(
          ...reviewTasksForDecision(decision, matchable, propertyKey, locate),
        );
      }
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
    legacyProjection: options?.legacyProjection,
  });

  for (const logical of continuity.logicalNodesToInsert) {
    if (options?.sourceCommit) throw new ApiError("CONFLICT", "Prepared source change cannot allocate a new DTS logical identity.");
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
        // Repeated includes reuse the same original occurrence; resolved alias paths
        // must never be guessed from a property name or value in another node.
        const occurrence = entry.origin
          ? occurrencesByOrigin.get(originKey(entry.origin.fileVersionId, entry.origin, entry.propertyName)) : null;
        const propertyOccurrenceId = occurrence?.propertyOccurrenceId ?? null;
        const nodeOccurrenceId = occurrence?.nodeOccurrenceId ?? null;

        if (
          propertyOccurrenceId &&
          (entry.effect === "set" || entry.effect === "override") &&
          !property.deleted
        ) {
          propertyOccurrenceByKey.set(
            `${node.nodeLocator}\0${entry.propertyName}`,
            propertyOccurrenceId,
          );
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

  const reviewDrafts = options?.sourceCommit ? [] : await matchBindAndQueueReviews(tx, {
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configRevisionId: revision.id,
    effectiveNodes: resolved.effective.nodesByLocator,
    stableLogicalIdByLocator: continuity.stableLogicalIdByLocator,
    propertyOccurrenceByKey,
    registry,
    attribution: attribution?.domain,
    legacyProjection: options?.legacyProjection,
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

  const singletonConflicts = await syncSingletonCardinalityBlockingTasks(tx, {
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

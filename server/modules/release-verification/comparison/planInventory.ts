import { isDeepStrictEqual } from "node:util";
import type { Database } from "../../../shared/database/client";
import type { MappingSourceIdentity } from "../../catalog-cutover/mapping";
import type { FrozenP0Graph } from "../../catalog-cutover/classifier";
import { readAgtComparisonSourceInventory } from "../../agent/parameterCatalogComparisonContribution";
import { readDbgComparisonSourceInventory } from "../../debugging/parameterCatalogComparisonContribution";
import { readDtsComparisonSourceInventory } from "../../dts-reload/parameterCatalogComparisonContribution";
import { readKnwComparisonSourceInventory } from "../../knowledge/parameterCatalogComparisonContribution";
import { readLogComparisonSourceInventory } from "../../logs/parameterCatalogComparisonContribution";
import { readOpsComparisonSourceInventory } from "../../operations/parameterCatalogComparisonContribution";
import { readFilComparisonSourceInventory } from "../../parameter-files/parameterCatalogComparisonContribution";
import { readModComparisonSourceInventory } from "../../parameter-modules/parameterCatalogComparisonContribution";
import { readCghComparisonSourceInventory } from "../../parameter-specs/parameterCatalogComparisonContribution";
import { readTopComparisonSourceInventory } from "../../parameter-topology/parameterCatalogComparisonContribution";
import { readPrjComparisonSourceInventory } from "../../parameters/parameterCatalogComparisonContribution";
import { COMPARISON_FAMILIES, FAMILY_COMPARISON_IDS, compareText, checksumCanonicalBytes, serializeCanonical,
  type ComparisonFamily, type ComparisonId } from "./corpusContributionSchema";
import { corpusRefusal } from "./errors";

export type ComparisonInventoryRecord = {
  readonly kind: string; readonly id: string; readonly applicable: readonly ComparisonId[];
  readonly [field: string]: unknown;
};
export type ComparisonSourceInventory = Readonly<Record<ComparisonFamily, readonly ComparisonInventoryRecord[]>>;
export type ComparisonPlanSourceBinding = {
  readonly hostRunId: string; readonly handoffDigest: string;
  /** Explicit namespace from the original private management configuration,
   * not a value inferred from PostgreSQL, an artifact, or a report. */
  readonly sourceSystem: string; readonly managementConfigurationDigest: string;
  readonly target: { readonly systemIdentifier: string; readonly databaseOid: string };
  readonly sourceSha: string; readonly candidateSha: string;
};
/** Implemented by the maintenance composition owner over its original issued
 * host/config custody and the actual source transaction. It remains open
 * through plan generation and the root's journal commit. */
export type ComparisonPlanSourceBoundary = { observe(): Promise<ComparisonPlanSourceBinding> };
declare const captured: unique symbol;
export type CapturedComparisonInventory = { readonly [captured]: true };
const captures = new WeakMap<CapturedComparisonInventory, {
  source: ComparisonSourceInventory; graph: FrozenP0Graph; binding: ComparisonPlanSourceBinding; boundary: ComparisonPlanSourceBoundary;
}>();

const checksum = (value: unknown) => checksumCanonicalBytes(serializeCanonical(value));

/** Source readers have no canonical-comparison or classification side effect.
 * The maintenance root owns the consistent source boundary and supplies its
 * real Database. This module neither creates a transaction nor changes roles.
 */
export async function readComparisonSourceInventory(database: Database, identities: readonly MappingSourceIdentity[]): Promise<ComparisonSourceInventory> {
  // Clone each return before the next await; retained driver/test buffers are
  // not allowed to mutate a previously observed family in this collection.
  const CGH = structuredClone(await readCghComparisonSourceInventory(database));
  const TOP = structuredClone(await readTopComparisonSourceInventory(database));
  const PRJ = structuredClone(await readPrjComparisonSourceInventory(database));
  const FIL = structuredClone(await readFilComparisonSourceInventory(database));
  const AGT = structuredClone(await readAgtComparisonSourceInventory(database));
  const LOG = structuredClone(await readLogComparisonSourceInventory(database));
  const DBG = structuredClone(await readDbgComparisonSourceInventory(database));
  const DTS = structuredClone(await readDtsComparisonSourceInventory(database));
  const KNW = structuredClone(await readKnwComparisonSourceInventory(database));
  const MOD = structuredClone(await readModComparisonSourceInventory(database));
  const OPS = structuredClone(await readOpsComparisonSourceInventory(database));
  const all = { CGH, TOP, PRJ, FIL, AGT, LOG, DBG, DTS, KNW, MOD, OPS };
  for (const family of COMPARISON_FAMILIES) {
    const seen = new Set<string>();
    for (const record of all[family]) {
      const key = JSON.stringify([record.kind, record.id]);
      if (!record.id || !record.kind || seen.has(key) || !record.applicable.length ||
        new Set(record.applicable).size !== record.applicable.length ||
        record.applicable.some(id => !(FAMILY_COMPARISON_IDS[family] as readonly string[]).includes(id))) {
        throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "invalid source inventory membership");
      }
      seen.add(key);
    }
    all[family].sort((a, b) => compareText(a.kind, b.kind) || compareText(a.id, b.id));
  }
  const selected: Record<ComparisonFamily, readonly ComparisonInventoryRecord[]> = { ...all };
  for (const family of COMPARISON_FAMILIES) selected[family] = all[family].map(record => {
    let references = Reflect.get(record, "sourceReferences") as unknown;
    if (family === "KNW") {
      const reference = record as ComparisonInventoryRecord;
      const matches = CGH.filter(spec => spec.kind === "parameter-definition-spec" && spec.id === reference.sourceId &&
        spec.sourceObservations.some(observation => observation.organizationId === reference.organizationId));
      if (matches.length !== 1 || matches[0]!.sourceReferences.length !== 1) {
        throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "referenced source owner missing or ambiguous");
      }
      const anchor = matches[0]!.sourceReferences[0]!;
      if (anchor.sourceKind !== "parameter-spec" || anchor.sourceId !== reference.sourceId ||
        !(anchor.ownerScopeKind === "platform" && anchor.ownerScopeId === "platform" ||
          anchor.ownerScopeKind === "organization" && anchor.ownerScopeId === reference.organizationId)) {
        throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "referenced source owner outside scope");
      }
      references = [anchor];
    }
    if (!Array.isArray(references)) return record;
    const sourceReferences = references.map((reference: unknown) => {
      if (!reference || typeof reference !== "object") throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "source association unavailable");
      const anchor = reference as Record<string, unknown>;
      const matches = identities.filter(identity => identity.sourceKind === anchor.sourceKind && identity.sourceId === anchor.sourceId &&
        identity.ownerScopeKind === anchor.ownerScopeKind && identity.ownerScopeId === anchor.ownerScopeId);
      if (matches.length !== 1) throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "source tuple missing or ambiguous");
      return structuredClone(matches[0]!);
    });
    return { ...record, sourceReferences };
  });
  return selected;
}

/** An issued read result, not authority. No caller JSON, rule or expected
 * outcome is accepted. P0 consumes this original in-process selection; the
 * durable P0 checkpoint later carries only its hashes and deterministic rules.
 */
export async function captureComparisonPlanInventory(database: Database, boundary: ComparisonPlanSourceBoundary, offeredGraph: FrozenP0Graph): Promise<CapturedComparisonInventory> {
  const graph = structuredClone(offeredGraph);
  const binding = structuredClone(await boundary.observe());
  const identities = graph.identities.map(({ id, ...identity }) => ({ legacyIdentityId: id, ...identity }));
  if (identities.some(identity => identity.sourceSystem !== binding.sourceSystem)) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "source namespace differs from its original declaration");
  const source = await readComparisonSourceInventory(database, identities);
  if (!isDeepStrictEqual(source, await readComparisonSourceInventory(database, identities))) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "source inventory changed during capture");
  }
  if (!isDeepStrictEqual(binding, await boundary.observe())) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "source boundary changed during capture");
  const handle = Object.freeze({}) as CapturedComparisonInventory;
  captures.set(handle, { source, graph, binding, boundary });
  return handle;
}

export function readCapturedComparisonInventory(handle: CapturedComparisonInventory) {
  const value = captures.get(handle);
  if (!value) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "source inventory was not captured by its owner");
  return structuredClone({ source: value.source, graph: value.graph, binding: value.binding });
}

export async function assertComparisonPlanInventoryCurrent(handle: CapturedComparisonInventory, candidateSha: string) {
  const value = captures.get(handle);
  if (!value || value.binding.candidateSha !== candidateSha || !isDeepStrictEqual(value.binding, await value.boundary.observe())) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "source boundary is unavailable for this plan");
  }
}

export function comparisonInventorySummary(handle: CapturedComparisonInventory) {
  const { source, binding } = readCapturedComparisonInventory(handle);
  return { version: "pcat-comparison-selection/v2" as const,
    binding,
    families: COMPARISON_FAMILIES.map(family => ({ family, sourceInventoryCount: source[family].length,
      sourceInventoryChecksum: checksum(source[family]),
      cases: source[family].flatMap(record => record.applicable.map(comparisonId => ({
        comparisonId, protectedReference: { kind: record.kind, id: record.id }, inputChecksum: checksum(record),
      }))),
    })) };
}

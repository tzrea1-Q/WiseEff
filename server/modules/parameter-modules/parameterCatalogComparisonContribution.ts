import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import type { AuthContext } from "../auth/types";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime/pinCache";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  type CatalogReleasePin,
} from "../parameter-catalog-contract";
import {
  checksumCanonicalBytes,
  serializeCanonical,
  COMPARISON_CASE_CONTEXT_V2_CONTRACT_VERSION,
  COMPARISON_CASE_CONTRIBUTION_V2_CONTRACT_VERSION,
  comparisonCaseIdV2For,
  type ComparisonCaseBatchV2,
  type ComparisonCaseContributionV2,
  type ComparisonCaseInventoryV2,
  type ComparisonCaseSelectionV2,
  type QueryObservation,
} from "../release-verification/comparison/corpusContributionSchema";
import {
  readCompletedModComparisonManifestForComparison,
  readPinnedCatalogSubjectsForComparison,
  readPinnedGovernanceRegistrationsForComparison,
  type ComparisonCatalogSubject,
  type ComparisonGovernanceRegistration,
  type CompletedMappingManifest,
} from "../parameter-catalog-api/productionWire";
import { handleLegacyCatalogRequest } from "../parameter-catalog-api/legacy";
import type { LegacyCatalogOptions } from "../parameter-catalog-api/legacy";
import { routeManifest } from "../contracts/routeManifest";
import { getRootPostgresPool, type Database } from "../../shared/database/client";
import { createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { readRegistry } from "./repository";
import { listDriverRegistry } from "./service";
import { listDismissedCompatibleIdentitiesForComparison } from "./comparisonInventoryRepository";

export const MOD_COMPARISON_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const MOD_COMPARISON_FAMILY = "MOD";

export const MOD_COMPARISON_IDS = [
  "PCAT-CMP-D02-SUBJECT-IDENTITY",
  "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
] as const;

export type ModComparisonId = (typeof MOD_COMPARISON_IDS)[number];
export type ModComparisonPhase = "pre-activation" | "post-p13";
export type ModInventoryMode = "fresh" | "populated";
export type ModComparisonResult =
  | "exact-equivalent"
  | "declared-expected-difference"
  | "unexplained-difference"
  | "unqueryable/protected-reference-missing";

export const MOD_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type ModProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type ModQueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type ModExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type ModComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: ModComparisonId;
  readonly protectedReference: ModProtectedReference;
  readonly legacyObservation: ModQueryObservation;
  readonly canonicalObservation: ModQueryObservation;
  readonly result: ModComparisonResult;
  readonly expectedDifference: ModExpectedDifference | null;
};

export type ModComparisonContributionInput = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly phase: ModComparisonPhase;
  readonly inventoryMode: ModInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly expectedCatalogReleasePin?: CatalogReleasePin;
};

export type ModComparisonContribution = {
  readonly contractVersion: typeof MOD_COMPARISON_CONTRACT_VERSION;
  readonly family: typeof MOD_COMPARISON_FAMILY;
  readonly phase: ModComparisonPhase;
  readonly inventoryMode: ModInventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly ModComparisonCase[];
  readonly checksum: string;
};

type InventoryRecord =
  | (ModProtectedReference & {
      readonly kind: "parameter-module-dismissed-compatible";
      readonly applicable: readonly ModComparisonId[];
      readonly organizationId: string;
      readonly legacyCompatible: string;
    })
  | (ModProtectedReference & {
      readonly kind: "parameter-module" | "parameter-module-mapping" | "subject-registration" | "subject-placement";
      readonly applicable: readonly ModComparisonId[];
      readonly organizationId?: string;
    });

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    );
  }
  return value;
}

export function serializeModComparisonContribution(
  contribution: Omit<ModComparisonContribution, "checksum"> | ModComparisonContribution,
): Buffer {
  const { checksum: _checksum, ...rest } = contribution as ModComparisonContribution;
  void _checksum;
  return Buffer.from(`${JSON.stringify(sortKeys(rest))}\n`, "utf8");
}

export function checksumModComparisonBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "mod-comparison-reader",
      organizationId,
      name: "MOD comparison",
      email: "mod-comparison@wiseeff.local",
      title: "comparison",
      isActive: true,
    },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "platform-admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

async function queryOrganizationIds(database: Database): Promise<readonly string[]> {
  const result = await database.query<{ id: string }>("select id from organizations order by id");
  if (!Array.isArray(result.rows)) {
    throw new Error("MOD inventory organization query did not return rows");
  }
  return result.rows.map((row) => row.id);
}

function createLegacyOptions(database: Database, organizationId: string): LegacyCatalogOptions {
  const auth = inventoryAuth(organizationId);
  return {
    catalogReleaseId: "catalog-unready",
    sunsetHttpDate: "Fri, 31 Dec 2027 00:00:00 GMT",
    getQueryable: async () => database as unknown as Awaited<ReturnType<LegacyCatalogOptions["getQueryable"]>>,
    resolveInvocation: async () => createUserInvocation(auth),
  };
}

async function queryModInventory(database: Database): Promise<InventoryRecord[]> {
  const organizations = await queryOrganizationIds(database);
  const byKey = new Map<string, InventoryRecord>();
  const scopes = organizations.length > 0 ? organizations : ["platform"];
  for (const organizationId of scopes) {
    const auth = inventoryAuth(organizationId);
    const registry = await readRegistry(database, organizationId, null);
    for (const module of registry.modules) {
      byKey.set(`parameter-module:${module.id}`, {
        kind: "parameter-module",
        id: module.id,
        organizationId,
        applicable: ["PCAT-CMP-D02-SUBJECT-IDENTITY"],
      });
    }
    for (const mapping of registry.mappings) {
      byKey.set(`parameter-module-mapping:${mapping.id}`, {
        kind: "parameter-module-mapping",
        id: mapping.id,
        organizationId,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
      });
    }
    const dismissedCompatibles = await listDismissedCompatibleIdentitiesForComparison(database, organizationId);
    for (const dismissed of dismissedCompatibles) {
      // The cutover registry protects the legacy row ID; the retired HTTP route still addresses its compatible.
      byKey.set(`parameter-module-dismissed-compatible:${dismissed.id}`, {
        kind: "parameter-module-dismissed-compatible",
        id: dismissed.id,
        organizationId: dismissed.organizationId,
        legacyCompatible: dismissed.compatible,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
      });
    }
    const drivers = await listDriverRegistry(database, auth);
    for (const item of drivers.items) {
      byKey.set(`subject-registration:${item.moduleId}`, {
        kind: "subject-registration",
        id: item.moduleId,
        organizationId,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
      });
      if (item.defaultBusinessCategoryId) {
        byKey.set(`subject-placement:${item.moduleId}`, {
          kind: "subject-placement",
          id: item.moduleId,
          organizationId,
          applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
        });
      }
    }
  }
  return [...byKey.values()];
}

function fillLegacyPath(path: string, identity: string): string {
  return path
    .replace(":moduleId", encodeURIComponent(identity))
    .replace(":mappingId", encodeURIComponent(identity))
    .replace(":compatible", encodeURIComponent(identity));
}

async function observeLegacyHttp(
  database: Database,
  organizationId: string,
  comparisonId: ModComparisonId,
  reference: ModProtectedReference,
  routeIdentity = reference.id,
): Promise<ModQueryObservation> {
  const route = routeManifest.find((entry) => {
    if (!entry.id.startsWith("parameterModules.")) {
      return false;
    }
    if (comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY") {
      return entry.id === "parameterModules.getRegistry";
    }
    if (reference.kind === "subject-registration" || reference.kind === "subject-placement") {
      return entry.id === "parameterModules.listDriverRegistry" || entry.id === "parameterModules.registerDriver";
    }
    if (reference.kind === "parameter-module-mapping") {
      return entry.id === "parameterModules.createMapping";
    }
    if (reference.kind === "parameter-module-dismissed-compatible") {
      return entry.id === "parameterModules.restoreCompatible";
    }
    return entry.id === "parameterModules.getRegistry";
  });
  if (!route) {
    return { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE, detail: "legacy-route-missing" };
  }
  const result = await handleLegacyCatalogRequest(
    {
      method: route.method,
      path: fillLegacyPath(route.path, routeIdentity),
      params: {},
      query: comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" ? { id: reference.id } : {},
      headers: {},
      requestId: randomUUID(),
      body: {},
    },
    createLegacyOptions(database, organizationId),
  );
  if (reference.kind === "parameter-module-dismissed-compatible" && result.status !== 410) {
    return {
      status: "query-failure",
      code: MOD_UNQUERYABLE_FAILURE_CODE,
      detail: `legacy-dismissed-compatible-http-${result.status}`,
    };
  }
  if (result.status >= 500) {
    return { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
      detail: `legacy-http-${result.status}` };
  }
  return {
    status: "value",
    value: {
      httpStatus: result.status,
      retired: result.status === 410,
    },
  };
}

async function observeLegacyModule(
  database: Database,
  organizationId: string,
  moduleId: string,
): Promise<ModQueryObservation> {
  const registry = await readRegistry(database, organizationId, null);
  const item = registry.modules.find((row) => row.id === moduleId);
  if (!item) {
    return {
      status: "query-failure",
      code: MOD_UNQUERYABLE_FAILURE_CODE,
      detail: "legacy-module-missing",
    };
  }
  return {
    status: "value",
    value: {
      id: item.id,
      kind: item.kind,
      origin: item.origin,
      parentId: item.parentId,
      attributionSubjectId: item.attributionSubjectId,
      sourceKey: item.sourceKey,
    },
  };
}

function classifyCase(input: {
  readonly comparisonId: ModComparisonId;
  readonly legacyObservation: ModQueryObservation;
  readonly canonicalObservation: ModQueryObservation;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly planPin: string;
}): { result: ModComparisonResult; expectedDifference: ModExpectedDifference | null } {
  if (input.legacyObservation.status === "query-failure") {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }
  if (input.canonicalObservation.status === "query-failure") {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }

  if (
    input.legacyObservation.status === "value" &&
    input.canonicalObservation.status === "value" &&
    JSON.stringify(sortKeys(input.legacyObservation.value)) ===
      JSON.stringify(sortKeys(input.canonicalObservation.value))
  ) {
    return { result: "exact-equivalent", expectedDifference: null };
  }

  const subject = input.canonicalObservation.status === "value"
    ? input.canonicalObservation.value.subject : undefined;
  if (input.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" &&
      (!subject || typeof subject !== "object" ||
        typeof (subject as { id?: unknown }).id !== "string" || !(subject as { id: string }).id)) {
    return { result: "unqueryable/protected-reference-missing", expectedDifference: null };
  }

  const expectedDifference: ModExpectedDifference = {
    rClass: "R9",
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    typedTarget: {
      kind:
        input.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY"
          ? "catalog-subject"
          : "subject-placement",
      id: input.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY"
        ? (subject as { id: string }).id : input.mappingHeadId,
    },
    ruleId: input.comparisonId,
    planPin: input.planPin,
  };
  return { result: "declared-expected-difference", expectedDifference };
}

function retainQueryFailure(observation: ModQueryObservation): ModQueryObservation {
  return observation.status === "query-failure" && observation.code !== MOD_UNQUERYABLE_FAILURE_CODE
    ? { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: `${observation.detail}:${observation.code}` }
    : observation;
}

function sortInventory(records: InventoryRecord[]): InventoryRecord[] {
  return [...records].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.applicable.join("\0"), right.applicable.join("\0")),
  );
}

function sortCases(cases: ModComparisonCase[]): ModComparisonCase[] {
  return [...cases].sort(
    (left, right) =>
      compareText(MOD_COMPARISON_FAMILY, MOD_COMPARISON_FAMILY) ||
      compareText(left.comparisonId, right.comparisonId) ||
      compareText(left.protectedReference.kind, right.protectedReference.kind) ||
      compareText(left.protectedReference.id, right.protectedReference.id) ||
      compareText(left.caseId, right.caseId),
  );
}

/**
 * Production MOD comparison contribution. Queries real PostgreSQL through
 * S4-REG / S8-LEG and the module-registry consumer inventory.
 */
export async function provideModParameterCatalogComparisonContribution(
  input: ModComparisonContributionInput,
): Promise<ModComparisonContribution> {
  if (input.phase !== "pre-activation" && input.phase !== "post-p13") {
    throw new Error("MOD comparison phase must be pre-activation or post-p13");
  }
  if (input.inventoryMode !== "fresh" && input.inventoryMode !== "populated") {
    throw new Error("MOD comparison inventoryMode must be fresh or populated");
  }
  if (!/^[a-f0-9]{40}$/u.test(input.candidateSha)) {
    throw new Error("MOD comparison candidateSha must be a full Git SHA");
  }
  const expectedPin = input.expectedCatalogReleasePin;
  if (!expectedPin) throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: expected Catalog release pin missing`);
  if (typeof expectedPin.id !== "string" || !expectedPin.id ||
      typeof expectedPin.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(expectedPin.digest)) {
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: expected Catalog release pin invalid`);
  }

  const organizations = await queryOrganizationIds(input.database);
  const organizationId = organizations[0] ?? "platform";
  let registrations: Awaited<ReturnType<typeof readPinnedGovernanceRegistrationsForComparison>>;
  try {
    registrations = await readPinnedGovernanceRegistrationsForComparison(input.pool, organizations, expectedPin);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(MOD_UNQUERYABLE_FAILURE_CODE)) throw error;
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: canonical Registration read failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const moduleRecords = await queryModInventory(input.database);
  const canonicalRecords: InventoryRecord[] = [...registrations.entries()].flatMap(([org, rows]) =>
    rows.flatMap((row) => [
      { kind: "subject-registration" as const, id: row.id, organizationId: org,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"] as const },
      { kind: "subject-placement" as const, id: row.placement.id, organizationId: org,
        applicable: ["PCAT-CMP-D03-REGISTRATION-PLACEMENT"] as const },
    ]),
  );
  const canonicalByIdentity = new Map<string, ComparisonGovernanceRegistration>();
  for (const [org, rows] of registrations) {
    for (const registration of rows) {
      for (const id of [registration.id, registration.placement.id, registration.placement.moduleId]) {
        if (!id) continue;
        const key = `${org}\0${id}`;
        const existing = canonicalByIdentity.get(key);
        if (existing && existing.id !== registration.id) {
          throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: canonical identity collision in ${org}`);
        }
        canonicalByIdentity.set(key, registration);
      }
    }
  }
  const subjectIdsByOrganization = new Map<string, Set<CatalogSubjectId>>();
  for (const record of moduleRecords) {
    if (record.kind !== "parameter-module") continue;
    if (!record.organizationId) throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: module organization missing`);
    const registration = canonicalByIdentity.get(`${record.organizationId}\0${record.id}`);
    if (registration?.placement.moduleId !== record.id) continue;
    const ids = subjectIdsByOrganization.get(record.organizationId) ?? new Set<CatalogSubjectId>();
    ids.add(CatalogSubjectId(registration.subjectId));
    subjectIdsByOrganization.set(record.organizationId, ids);
  }
  let catalogSubjects: Awaited<ReturnType<typeof readPinnedCatalogSubjectsForComparison>>;
  try {
    catalogSubjects = await readPinnedCatalogSubjectsForComparison(input.pool, input.database,
      [...subjectIdsByOrganization].map(([org, ids]) => ({
        organizationId: org, auth: inventoryAuth(org), subjectIds: [...ids],
      })), expectedPin);
  } catch (error) {
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: canonical Subject read failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const inventory = sortInventory([...moduleRecords, ...canonicalRecords]);

  if (input.inventoryMode === "fresh" && inventory.length !== 0) {
    throw new Error(
      `MOD fresh inventory must be empty after a real PostgreSQL query; received ${inventory.length} records`,
    );
  }

  const cases: ModComparisonCase[] = [];
  for (const record of inventory) {
    const protectedReference = { kind: record.kind, id: record.id };
    const legacyOrganizationId = record.kind === "parameter-module-dismissed-compatible"
      ? record.organizationId
      : record.organizationId ?? organizationId;
    const routeIdentity = record.kind === "parameter-module-dismissed-compatible"
      ? record.legacyCompatible
      : record.id;
    for (const comparisonId of record.applicable) {
      if (
        comparisonId !== "PCAT-CMP-D02-SUBJECT-IDENTITY" &&
        comparisonId !== "PCAT-CMP-D03-REGISTRATION-PLACEMENT"
      ) {
        throw new Error(`MOD comparison rejected unknown comparison ID ${comparisonId}`);
      }
      const legacyObservation = retainQueryFailure(
        record.kind === "parameter-module"
          ? await observeLegacyModule(input.database, legacyOrganizationId, record.id)
          : await observeLegacyHttp(
              input.database,
              legacyOrganizationId,
              comparisonId,
              protectedReference,
              routeIdentity,
            ),
      );
      let canonicalObservation: ModQueryObservation;
      if (comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY") {
        const match = canonicalByIdentity.get(`${legacyOrganizationId}\0${record.id}`);
        const subjectRows = catalogSubjects.get(legacyOrganizationId);
        const subject = match && subjectRows?.get(match.subjectId);
        const legacyKind = legacyObservation.status === "value" ? legacyObservation.value.kind : undefined;
        const expectedKind = legacyKind === "driver-group" ? "driver"
          : legacyKind === "node-type" ? "node-type" : null;
        let detail: string | null = null;
        if (!match || match.placement.moduleId !== record.id) detail = "no-exact-subject-association";
        else if (!subjectRows || !subjectRows.has(match.subjectId)) detail = "canonical-subject-response-missing";
        else if (!subject) detail = "canonical-subject-not-published";
        else if (subject.id !== match.subjectId) detail = "canonical-subject-identity-mismatch";
        else if (expectedKind !== subject.kind) detail = "canonical-subject-kind-mismatch";
        canonicalObservation = detail
          ? { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE, detail }
          : {
              status: "value",
              value: {
                catalogReleaseId: expectedPin.id,
                catalogReleaseDigest: expectedPin.digest,
                organizationId: legacyOrganizationId,
                association: { registrationId: match!.id, placementId: match!.placement.id, moduleId: record.id },
                subject: {
                  id: subject!.id,
                  type: subject!.kind,
                  canonicalName: subject!.canonicalKey,
                  selector: subject!.membership.selector,
                  lifecycle: subject!.membership.lifecycle,
                  membershipReleaseId: subject!.membership.release.id,
                  aliases: subject!.aliases.map((alias) => ({
                    id: alias.id, selector: alias.selector,
                    lifecycle: alias.membership.lifecycle,
                    membershipReleaseId: alias.membership.release.id,
                  })),
                },
              },
            };
      } else {
        const rows = registrations.get(legacyOrganizationId);
        if (!rows) throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: organization scope missing`);
        const match = canonicalByIdentity.get(`${legacyOrganizationId}\0${record.id}`);
        canonicalObservation = {
          status: "value",
          value: {
            catalogReleaseId: expectedPin.id,
            catalogReleaseDigest: expectedPin.digest,
            organizationId: legacyOrganizationId,
            itemCount: rows.length,
            ...(match ? { registration: {
              id: match.id,
              subjectId: match.subjectId,
              status: match.status,
              method: match.method,
              placementId: match.placement.id,
              placement: {
                id: match.placement.id,
                displayName: match.placement.displayName,
                parentPlacementId: match.placement.parentPlacementId,
                moduleId: match.placement.moduleId ?? null,
              },
            } } : {}),
          },
        };
      }

      canonicalObservation = retainQueryFailure(canonicalObservation);
      const classified = classifyCase({
        comparisonId,
        legacyObservation,
        canonicalObservation,
        mappingHeadId: input.mappingHeadId,
        mappingHeadVersion: input.mappingHeadVersion,
        planPin: input.planPin,
      });

      cases.push({
        caseId: `${MOD_COMPARISON_FAMILY}:${comparisonId}:${record.kind}:${record.id}`,
        comparisonId,
        protectedReference,
        legacyObservation,
        canonicalObservation,
        result: classified.result,
        expectedDifference: classified.expectedDifference,
      });
    }
  }

  const sortedCases = sortCases(cases);
  const finalPin = await captureCurrentCatalogPin(input.pool);
  if (finalPin?.id !== expectedPin.id || finalPin.digest !== expectedPin.digest) {
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: Catalog release changed during MOD comparison`);
  }
  const inventoryBytes = Buffer.from(`${JSON.stringify(sortKeys(inventory))}\n`, "utf8");
  const sourceInventoryChecksum = checksumModComparisonBytes(inventoryBytes);
  const unsigned: Omit<ModComparisonContribution, "checksum"> = {
    contractVersion: MOD_COMPARISON_CONTRACT_VERSION,
    family: MOD_COMPARISON_FAMILY,
    phase: input.phase,
    inventoryMode: input.inventoryMode,
    candidateSha: input.candidateSha,
    planPin: input.planPin,
    mappingHeadId: input.mappingHeadId,
    mappingHeadVersion: input.mappingHeadVersion,
    mappingHeadChecksum: input.mappingHeadChecksum,
    catalogSnapshotChecksum: input.catalogSnapshotChecksum,
    sourceInventoryCount: inventory.length,
    sourceInventoryChecksum,
    cases: sortedCases,
  };
  const bytes = serializeModComparisonContribution(unsigned);
  return {
    ...unsigned,
    checksum: checksumModComparisonBytes(bytes),
  };
}

export type ModComparisonCaseBatchV2Input = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly runId: string;
  readonly invocation: TrustedInvocationContext;
};

const v2IdentityKey = (input: {
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly ownerScopeKind: string;
  readonly ownerScopeId: string;
}): string => `${input.sourceKind}\0${input.sourceId}\0${input.ownerScopeKind}\0${input.ownerScopeId}`;

const makeModD02CaseV2 = (input: {
  readonly manifest: CompletedMappingManifest;
  readonly inventory: readonly ComparisonCaseInventoryV2[];
  readonly sourceInventoryChecksum: string;
  readonly selection: ComparisonCaseSelectionV2 | null;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly ownerScopeId: string;
  readonly legacyObservation: QueryObservation;
  readonly canonicalObservation: QueryObservation;
  readonly forcedFailure?: string;
}): ComparisonCaseContributionV2 => {
  const protectedReference = { kind: input.sourceKind, id: input.sourceId };
  let result: ComparisonCaseContributionV2["result"];
  let expectedDifference: ComparisonCaseContributionV2["expectedDifference"] = null;
  const canonicalSubject = input.canonicalObservation.status === "value"
    ? input.canonicalObservation.value.subject
    : undefined;
  const canonicalSubjectId = canonicalSubject && typeof canonicalSubject === "object" &&
      typeof (canonicalSubject as { id?: unknown }).id === "string"
    ? (canonicalSubject as { id: string }).id
    : undefined;
  const selectedTargetMatches = input.selection?.mappingVersion.targetKind === "catalog-subject" &&
    input.selection.mappingVersion.targetId !== null &&
    input.selection.mappingVersion.targetId === canonicalSubjectId;
  const archivedSelection = input.selection?.disposition === "archived" &&
    (input.selection.rClass === "R1" || input.selection.rClass === "R10") &&
    input.selection.mappingVersion.rClass === input.selection.rClass &&
    typeof input.selection.mappingVersion.archiveId === "string" &&
    input.selection.mappingVersion.archiveId.length > 0 &&
    input.selection.mappingVersion.targetKind === null &&
    input.selection.mappingVersion.targetId === null;
  const observationsEqual = input.legacyObservation.status === "value" &&
    input.canonicalObservation.status === "value" &&
    serializeCanonical(input.legacyObservation.value).equals(
      serializeCanonical(input.canonicalObservation.value),
    );
  const unqueryableReason = input.forcedFailure ??
    (!input.selection ? "completed-manifest-selection-missing" :
      input.legacyObservation.status === "query-failure" ? input.legacyObservation.detail :
        input.canonicalObservation.status === "query-failure" ? input.canonicalObservation.detail :
          !canonicalSubjectId ? "canonical-subject-observation-missing" :
            !selectedTargetMatches && !archivedSelection
              ? "selected-mapping-does-not-support-mod-d02-comparison"
              : null);
  if (unqueryableReason) {
    result = "unqueryable/protected-reference-missing";
  } else if (observationsEqual) {
    result = "exact-equivalent";
  } else if (selectedTargetMatches) {
    result = "declared-expected-difference";
    expectedDifference = {
      rClass: input.selection!.rClass,
      mappingVersionId: input.selection!.mappingVersion.id,
      typedTarget: { kind: "catalog-subject", id: canonicalSubjectId! },
      ruleId: "PCAT-CMP-D02-SUBJECT-IDENTITY",
      planPin: input.manifest.planDigest,
    };
  } else if (archivedSelection) {
    // P7 proves this selected version and Archive, but that evidence does not
    // prove a D02 Subject target or an expected-difference rule.
    result = "unexplained-difference";
  } else {
    result = "unqueryable/protected-reference-missing";
  }
  const caseId = comparisonCaseIdV2For({
    selectionRunId: input.manifest.selectionRunId,
    phase: "pre-activation",
    family: "MOD",
    comparisonId: "PCAT-CMP-D02-SUBJECT-IDENTITY",
    protectedReference,
    ownerScopeKind: "organization",
    ownerScopeId: input.ownerScopeId,
    legacyIdentityId: input.selection?.legacyIdentityId ?? null,
  });
  const unsigned: Omit<ComparisonCaseContributionV2, "checksum"> = {
    contractVersion: COMPARISON_CASE_CONTRIBUTION_V2_CONTRACT_VERSION,
    family: "MOD",
    caseId,
    comparisonId: "PCAT-CMP-D02-SUBJECT-IDENTITY",
    protectedReference,
    protectedReferenceOwnerScopeKind: "organization",
    protectedReferenceOwnerScopeId: input.ownerScopeId,
    legacyObservation: input.legacyObservation,
    canonicalObservation: input.canonicalObservation,
    result,
    expectedDifference,
    unqueryableReason: result === "unqueryable/protected-reference-missing" ? unqueryableReason : null,
    context: {
      contractVersion: COMPARISON_CASE_CONTEXT_V2_CONTRACT_VERSION,
      phase: "pre-activation",
      selectionRunId: input.manifest.selectionRunId,
      selectionPlanDigest: input.manifest.planDigest,
      selectionTargetArtifactSha: input.manifest.targetArtifactSha,
      selectionCatalogReleaseId: input.manifest.catalogRelease.id,
      selectionCatalogReleaseDigest: input.manifest.catalogRelease.digest,
      selectionManifestDigest: input.manifest.fullRunDigest,
      selectionP7CheckpointDigest: input.manifest.p7CheckpointDigest,
      selectionProjectionDigest: input.manifest.projection.digest,
      selectionProjectionCoverage: input.manifest.projection.coverage,
      selectionProjectionCount: input.manifest.projection.selectionCount,
      selection: input.selection,
      sourceInventoryCount: input.inventory.length,
      sourceInventoryChecksum: input.sourceInventoryChecksum,
    },
  };
  return {
    ...unsigned,
    checksum: checksumCanonicalBytes(serializeCanonical(unsigned)),
  };
};

/** Real, organization-scoped MOD D02 inventory bound to a persisted completed-run selection. */
export async function provideModParameterCatalogComparisonCaseBatchV2(
  input: ModComparisonCaseBatchV2Input,
): Promise<ComparisonCaseBatchV2> {
  if (getRootPostgresPool(input.database) !== input.pool) {
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: database and pool are not the same root connection`);
  }
  if (!input.runId) {
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: run id is required`);
  }
  const scope = await readCompletedModComparisonManifestForComparison(input);
  const { auth, manifest } = scope;
  const organizationId = auth.organization.id;
  const principalId = auth.user.id;
  const expectedPin: CatalogReleasePin = {
    id: CatalogReleaseId(manifest.catalogRelease.id),
    digest: CatalogReleaseDigest(manifest.catalogRelease.digest),
  };

  const registry = await readRegistry(input.database, organizationId, null);
  const modules = [...registry.modules].sort((left, right) =>
    compareText(left.id, right.id) || compareText(left.kind, right.kind));
  const inventory: ComparisonCaseInventoryV2[] = modules.map((module) => ({
    kind: "parameter-module",
    id: module.id,
    ownerScopeKind: "organization",
    ownerScopeId: organizationId,
  }));
  const inventoryBytes = serializeCanonical(inventory);
  const sourceInventoryChecksum = checksumCanonicalBytes(inventoryBytes);
  const modSelections = manifest.projection.selections
    .filter((selection) => selection.sourceKind === "parameter-module")
    .sort((left, right) => compareText(left.legacyIdentityId, right.legacyIdentityId));
  const selectionKeys = new Map<string, typeof modSelections>();
  for (const selection of modSelections) {
    const key = v2IdentityKey(selection);
    const existing = selectionKeys.get(key) ?? [];
    selectionKeys.set(key, [...existing, selection]);
  }

  let registrations: Awaited<ReturnType<typeof readPinnedGovernanceRegistrationsForComparison>>;
  try {
    registrations = await readPinnedGovernanceRegistrationsForComparison(
      input.pool,
      [organizationId],
      expectedPin,
      principalId,
    );
  } catch (error) {
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: scoped Governance read failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const registrationsByModule = new Map<string, ComparisonGovernanceRegistration[]>();
  for (const registration of registrations.get(organizationId) ?? []) {
    const moduleId = registration.placement.moduleId;
    if (!moduleId) continue;
    const existing = registrationsByModule.get(moduleId) ?? [];
    registrationsByModule.set(moduleId, [...existing, registration]);
  }
  const subjectIds = [...new Set(modules.flatMap((module) =>
    (registrationsByModule.get(module.id) ?? [])
      .filter((registration) => registration.placement.moduleId === module.id)
      .map((registration) => CatalogSubjectId(registration.subjectId)),
  ))];
  let subjects = new Map<string, ReadonlyMap<string, ComparisonCatalogSubject | null>>();
  if (subjectIds.length > 0) {
    try {
      subjects = await readPinnedCatalogSubjectsForComparison(input.pool, input.database, [{
        organizationId,
        auth,
        subjectIds,
      }], expectedPin);
    } catch (error) {
      throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: scoped Subject read failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  const subjectRows = subjects.get(organizationId);
  const cases: ComparisonCaseContributionV2[] = [];
  const observedModuleKeys = new Set<string>();
  for (const module of modules) {
    const source = { sourceKind: "parameter-module", sourceId: module.id,
      ownerScopeKind: "organization", ownerScopeId: organizationId };
    const key = v2IdentityKey(source);
    observedModuleKeys.add(key);
    const selections = selectionKeys.get(key) ?? [];
    const legacyObservation: QueryObservation = {
      status: "value",
      value: {
        id: module.id,
        kind: module.kind,
        origin: module.origin,
        parentId: module.parentId,
        attributionSubjectId: module.attributionSubjectId,
        sourceKey: module.sourceKey,
      },
    };
    const linked = registrationsByModule.get(module.id) ?? [];
    const registration = linked.length === 1 ? linked[0] : undefined;
    const subject = registration ? subjectRows?.get(registration.subjectId) : undefined;
    let canonicalObservation: QueryObservation;
    if (linked.length !== 1) {
      canonicalObservation = {
        status: "query-failure",
        code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: linked.length === 0 ? "no-exact-subject-association" : "multiple-subject-associations-for-module",
      };
    } else if (!subjectRows?.has(registration!.subjectId)) {
      canonicalObservation = { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: "canonical-subject-response-missing" };
    } else if (!subject || subject.id !== registration!.subjectId) {
      canonicalObservation = { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: "canonical-subject-not-published" };
    } else if (registration!.status !== "active") {
      canonicalObservation = { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: "subject-registration-not-active" };
    } else if (subject.membership.lifecycle !== "active") {
      canonicalObservation = { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: "canonical-subject-not-active" };
    } else {
      const expectedKind = module.kind === "driver-group" ? "driver"
        : module.kind === "node-type" ? "node-type" : null;
      if (!expectedKind || expectedKind !== subject.kind) {
        canonicalObservation = { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
          detail: "canonical-subject-kind-mismatch" };
      } else {
      canonicalObservation = {
        status: "value",
        value: {
          catalogReleaseId: expectedPin.id,
          catalogReleaseDigest: expectedPin.digest,
          organizationId,
          association: { registrationId: registration!.id,
            placementId: registration!.placement.id, moduleId: module.id,
            registrationStatus: registration!.status, registrationMethod: registration!.method },
          subject: {
            id: subject.id,
            type: subject.kind,
            canonicalName: subject.canonicalKey,
            selector: subject.membership.selector,
            lifecycle: subject.membership.lifecycle,
            membershipReleaseId: subject.membership.release.id,
          },
        },
      };
      }
    }
    if (selections.length === 0) {
      cases.push(makeModD02CaseV2({
        manifest, inventory, sourceInventoryChecksum,
        selection: null,
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
        ownerScopeId: organizationId,
        legacyObservation,
        canonicalObservation,
        forcedFailure: "completed-manifest-selection-missing",
      }));
      continue;
    }
    for (const selection of selections) {
      cases.push(makeModD02CaseV2({
        manifest, inventory, sourceInventoryChecksum,
        selection,
        sourceKind: selection.sourceKind,
        sourceId: selection.sourceId,
        ownerScopeId: selection.ownerScopeId,
        legacyObservation,
        canonicalObservation,
        forcedFailure: selections.length > 1 ? "multiple-manifest-selections-for-module" : undefined,
      }));
    }
  }
  for (const selection of modSelections) {
    const key = v2IdentityKey(selection);
    if (observedModuleKeys.has(key)) continue;
    cases.push(makeModD02CaseV2({
      manifest, inventory, sourceInventoryChecksum,
      selection,
      sourceKind: selection.sourceKind,
      sourceId: selection.sourceId,
      ownerScopeId: selection.ownerScopeId,
      legacyObservation: { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: "selected-module-missing-from-scoped-inventory" },
      canonicalObservation: { status: "query-failure", code: MOD_UNQUERYABLE_FAILURE_CODE,
        detail: "selected-module-missing-from-scoped-inventory" },
    }));
  }
  const currentPin = await captureCurrentCatalogPin(input.pool);
  if (currentPin?.id !== expectedPin.id || currentPin.digest !== expectedPin.digest) {
    throw new Error(`${MOD_UNQUERYABLE_FAILURE_CODE}: Catalog release changed during scoped MOD D02 read`);
  }
  cases.sort((left, right) => compareText(left.caseId, right.caseId));
  const blockers = cases
    .filter((item) => item.result === "unqueryable/protected-reference-missing")
    .map((item) => `${item.caseId}:${item.unqueryableReason ?? "unqueryable-reason-missing"}`);
  return {
    contractVersion: "pcat-comparison-case-batch/v2",
    family: "MOD",
    comparisonId: "PCAT-CMP-D02-SUBJECT-IDENTITY",
    phase: "pre-activation",
    organizationId,
    selectionRunId: manifest.selectionRunId,
    selectionProjectionDigest: manifest.projection.digest,
    selectionProjectionCount: manifest.projection.selectionCount,
    modSelectionIdentityIds: modSelections.map((selection) => selection.legacyIdentityId),
    inventory,
    sourceInventoryCount: inventory.length,
    sourceInventoryChecksum,
    cases,
    blockers,
  };
}

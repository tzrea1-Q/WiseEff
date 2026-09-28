import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import type { AuthContext } from "../auth/types";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime/pinCache";
import { CatalogSubjectId, type CatalogReleasePin } from "../parameter-catalog-contract";
import {
  readPinnedCatalogSubjectsForComparison,
  readPinnedGovernanceRegistrationsForComparison,
  type ComparisonGovernanceRegistration,
} from "../parameter-catalog-api/productionWire";
import { handleLegacyCatalogRequest } from "../parameter-catalog-api/legacy";
import type { LegacyCatalogOptions } from "../parameter-catalog-api/legacy";
import { routeManifest } from "../contracts/routeManifest";
import type { Database } from "../../shared/database/client";
import { createUserInvocation } from "../auth/trustedInvocation";
import {
  getParameterModuleRegistry,
  listDriverRegistry,
} from "./service";
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
    const registry = await getParameterModuleRegistry(database, auth);
    for (const module of registry.item.modules) {
      byKey.set(`parameter-module:${module.id}`, {
        kind: "parameter-module",
        id: module.id,
        organizationId,
        applicable: ["PCAT-CMP-D02-SUBJECT-IDENTITY"],
      });
    }
    for (const mapping of registry.item.mappings) {
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
        organizationId,
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
  const listed = await getParameterModuleRegistry(database, inventoryAuth(organizationId));
  const item = listed.item.modules.find((row) => row.id === moduleId);
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

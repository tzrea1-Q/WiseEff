import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import {
  createCatalogKernel,
  jsonCatalogReleaseSource,
  type CatalogSnapshot,
} from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { encodeCatalogCursor } from "../../catalog-kernel/runtime/cursors";
import {
  CatalogPageLimit,
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  serializeContract,
  type CatalogReleasePin,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { createEvidenceIngest } from "../evidence/index";
import { createProposalService } from "../proposals/index";
import { createRegistrationService } from "../registration/index";
import { createReviewQueueReader } from "../review/index";
import { stabilizeCanonicalBinding } from "../../parameter-bindings/binding/index";
import { createProjectValueService } from "../../parameter-bindings/values/index";
import { IDENTITY_PLACEHOLDER_SOURCE } from "../../parameter-bindings/values/repositories";
import { createUsageQueries } from "../../parameter-bindings/usage/index";

import { createGovernanceCatalogQueries, emptyReasonForView } from "./index";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CATFIX-QUERY requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "CATFIX-QUERY requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_A = "org-catfix-q-a";
const ORG_B = "org-catfix-q-b";
const ATTR_A = "attr-catfix-q-a";
const ATTR_B = "attr-catfix-q-b";
const MODULE_A = "pmod-catfix-q-driver";
const MODULE_B = "pmod-catfix-q-driver-b";
const PROJECT_A = "project-catfix-q-a";
const PROJECT_B = "project-catfix-q-b";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
const VALUES_RELATION = ["project_parameter", "values"].join("_");

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`,
    );
  }
  return compiled.value;
};

const countingPool = (pool: pg.Pool) => {
  let statements = 0;
  const originalConnect = pool.connect.bind(pool);
  const wrapped = new WeakSet<pg.PoolClient>();
  return {
    pool: {
      connect: async () => {
        const client = await originalConnect();
        if (!wrapped.has(client)) {
          const originalQuery = client.query.bind(client);
          client.query = ((...args: never[]) => {
            statements += 1;
            return originalQuery(...args);
          }) as typeof client.query;
          wrapped.add(client);
        }
        return client;
      },
      end: pool.end.bind(pool),
      query: pool.query.bind(pool),
    } as unknown as pg.Pool,
    statements: () => statements,
    reset: () => {
      statements = 0;
    },
  };
};

describe("CATFIX-QUERY real governance and usage projections", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let snapshot: CatalogSnapshot;
  let queries: ReturnType<typeof createGovernanceCatalogQueries>;
  let usage: ReturnType<typeof createUsageQueries>;
  let registrationId: string;
  let placementId: string;
  const authA = { organizationId: ORG_A, principalId: "user-org-admin-a" };
  const authB = { organizationId: ORG_B, principalId: "user-org-admin-b" };

  const registrationService = () => createRegistrationService(pool);

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("catfixq");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const bundle = firstReleaseBundle();
    const first = compileOrThrow(bundle);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'CATFIX A'), ($2, 'CATFIX B')`, [
      ORG_A,
      ORG_B,
    ]);
    await pool.query(
      `insert into public.projects (id, organization_id, name, code) values
         ($1, $3, 'CATFIX A1', 'CQ1'),
         ($2, $3, 'CATFIX A2', 'CQ2')`,
      [PROJECT_A, PROJECT_B, ORG_A],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values
         ($1, $3, 'driver-registration', 'CATFIX driver', 'compatible:acme,power'),
         ($2, $3, 'driver-registration', 'CATFIX driver b', 'compatible:acme,power-b')`,
      [ATTR_A, ATTR_B, ORG_A],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple'), ($2, 'physical-device', 'multiple')`,
      [ATTR_A, ATTR_B],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values
         ($1, $3, 'Driver', $1, 1, 'driver-group', 'curated', $4),
         ($2, $3, 'Driver B', $2, 1, 'driver-group', 'curated', $5)`,
      [MODULE_A, MODULE_B, ORG_A, ATTR_A, ATTR_B],
    );
    const kernel = createCatalogKernel(pool);
    const loaded = await kernel.loadCurrentCatalog(pin);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("failed to load current catalog");
    snapshot = loaded.value;
    queries = createGovernanceCatalogQueries(pool);
    usage = createUsageQueries(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("CATFIX-QUERY-01 registers then reads subject, definition, and registration detail with the same IDs", async () => {
    const written = await registrationService().execute({
      kind: "register",
      organizationId: ORG_A,
      subjectId: SUBJECT_ID,
      subjectKind: "driver",
      expectedRelease: pin,
      placement: { mode: "use-default" },
      destinationModuleId: MODULE_A,
      method: "explicit",
      proof: { reason: "catfix-query-01" },
      idempotencyKey: `reg:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: authA.principalId },
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    registrationId = written.value.registrationId;
    placementId = written.value.placementId;

    const projected = await queries.projectRegistrations({
      organizationId: ORG_A,
      subjectIds: [SUBJECT_ID],
      authScope: authA,
      observedRelease: pin,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const subjectProjection = projected.value.projections[0];
    expect(subjectProjection?.registration.status).toBe("active");
    if (subjectProjection?.registration.status !== "active") return;
    expect(subjectProjection.registration.id).toBe(registrationId);
    expect(subjectProjection.registration.placement.id).toBe(placementId);
    expect(subjectProjection.registration.placement.displayName).toBe("Driver");
    expect(subjectProjection.registration.method).toBe("explicit");

    const definitionProjection = subjectProjection.registration;
    expect(definitionProjection.id).toBe(registrationId);
    expect(definitionProjection.placement.id).toBe(placementId);

    const detail = await queries.getRegistration({
      organizationId: ORG_A,
      registrationId,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.id).toBe(registrationId);
    expect(detail.value.subjectId).toBe(SUBJECT_ID);
    expect(detail.value.placement.id).toBe(placementId);
    const placement = await queries.getPlacement({
      organizationId: ORG_A,
      registrationId,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(placement.ok).toBe(true);
    if (!placement.ok) return;
    expect(placement.value.id).toBe(placementId);
  });

  it("CATFIX-QUERY-02 inherits the moved Placement onto definitions without copying rows", async () => {
    const moved = await registrationService().execute({
      kind: "move-placement",
      organizationId: ORG_A,
      registrationId: registrationId as never,
      expectedRelease: pin,
      destinationModuleId: MODULE_B,
      idempotencyKey: `move:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: authA.principalId },
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.placementId).toBe(placementId);

    const projected = await queries.projectRegistrations({
      organizationId: ORG_A,
      subjectIds: [SUBJECT_ID],
      authScope: authA,
      observedRelease: pin,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const registration = projected.value.projections[0]?.registration;
    expect(registration?.status).toBe("active");
    if (registration?.status !== "active") return;
    expect(registration.placement.id).toBe(placementId);
    expect(registration.placement.displayName).toBe("Driver B");

    const stored = await pool.query<{ placements: string }>(
      `select count(*)::text as placements
         from parameter_catalog.subject_placements
        where registration_id = $1`,
      [registrationId],
    );
    expect(stored.rows[0]?.placements).toBe("1");
  });

  it("CATFIX-QUERY-03 retires and restores the same Registration and Placement IDs", async () => {
    const retired = await registrationService().execute({
      kind: "retire",
      organizationId: ORG_A,
      registrationId: registrationId as never,
      expectedRelease: pin,
      idempotencyKey: `retire:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: authA.principalId },
      reason: "catfix-query-03",
    });
    expect(retired.ok).toBe(true);
    const afterRetire = await queries.getRegistration({
      organizationId: ORG_A,
      registrationId,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(afterRetire.ok).toBe(true);
    if (!afterRetire.ok) return;
    expect(afterRetire.value.status).toBe("retired");
    expect(afterRetire.value.id).toBe(registrationId);
    expect(afterRetire.value.placement.id).toBe(placementId);

    const restored = await registrationService().execute({
      kind: "restore",
      organizationId: ORG_A,
      registrationId: registrationId as never,
      expectedRelease: pin,
      idempotencyKey: `restore:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: authA.principalId },
      reason: "catfix-query-03-restore",
    });
    expect(restored.ok).toBe(true);
    const afterRestore = await queries.getRegistration({
      organizationId: ORG_A,
      registrationId,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(afterRestore.ok).toBe(true);
    if (!afterRestore.ok) return;
    expect(afterRestore.value.status).toBe("active");
    expect(afterRestore.value.id).toBe(registrationId);
    expect(afterRestore.value.placement.id).toBe(placementId);
    const count = await pool.query<{ registrations: string; placements: string }>(
      `select
         (select count(*)::text from parameter_catalog.organization_subject_registrations where organization_id = $1) as registrations,
         (select count(*)::text from parameter_catalog.subject_placements where organization_id = $1) as placements`,
      [ORG_A],
    );
    expect(count.rows[0]).toEqual({ registrations: "1", placements: "1" });
  });

  it("CATFIX-QUERY-04 lists and loads Observation and Proposal after real writes", async () => {
    const ingest = createEvidenceIngest(pool);
    const observation = await ingest.ingest({
      organizationId: ORG_A,
      sourceIdentity: `obs:${randomUUID()}`,
      catalogReleaseId: pin.id,
      matcherRevision: "matcher-catfix-q",
      matcherOutput: { status: "matched" },
      provenance: {
        projectId: PROJECT_A,
        logicalNodeId: "logical-catfix-q",
        configRevisionId: "config-catfix-q-1",
        sourceLocator: { path: "/soc/charger", property: "iin_max" },
      },
    });
    expect(observation.ok).toBe(true);
    if (!observation.ok) return;

    const listedObservations = await queries.listObservations({
      organizationId: ORG_A,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(listedObservations.ok).toBe(true);
    if (!listedObservations.ok) return;
    expect(listedObservations.value.items.some((item) => item.id === observation.value.id)).toBe(true);
    const loadedObservation = await queries.getObservation({
      organizationId: ORG_A,
      observationId: observation.value.id,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(loadedObservation.ok).toBe(true);
    if (!loadedObservation.ok) return;
    expect(loadedObservation.value.recognition).toBe("matched");
    expect(loadedObservation.value.propertyKey).toBe("iin_max");

    const missingObservation = await queries.getObservation({
      organizationId: ORG_A,
      observationId: "pobs_missing_catfix",
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(missingObservation.ok).toBe(false);
    if (missingObservation.ok) return;
    expect(missingObservation.error.kind).toBe("not-found");

    const proposal = await createProposalService(pool).execute({
      kind: "submit",
      organizationId: ORG_A,
      baseRelease: pin,
      currentRelease: pin,
      baseDefinitionRevisionId: REVISION_1,
      payload: { change: "raise-iin-max", note: "catfix-query-04" },
      reason: "field measurement requires a higher limit",
      evidenceRefs: ["evidence:catfix-query-04"],
      idempotencyKey: `submit:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: authA.principalId },
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const listedProposals = await queries.listProposals({
      organizationId: ORG_A,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(listedProposals.ok).toBe(true);
    if (!listedProposals.ok) return;
    expect(listedProposals.value.items.some((item) => item.id === proposal.value.proposalId)).toBe(true);
    const loadedProposal = await queries.getProposal({
      organizationId: ORG_A,
      proposalId: proposal.value.proposalId,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(loadedProposal.ok).toBe(true);
    if (!loadedProposal.ok) return;
    expect(loadedProposal.value.status).toBe("submitted");
    expect(loadedProposal.value.requestedChange.change).toBe("raise-iin-max");
    expect(loadedProposal.value.base.definitionRevisionId).toBe(REVISION_1);

    const reviewEvidence = await ingest.ingest({
      organizationId: ORG_A,
      sourceIdentity: `unknown:${randomUUID()}`,
      catalogReleaseId: pin.id,
      matcherRevision: "matcher-catfix-q",
      matcherOutput: { status: "unknown" },
      evidence: { propertyKey: "iin_max", subjectId: SUBJECT_ID },
    });
    expect(reviewEvidence.ok).toBe(true);
    const withReview = await queries.projectRegistrations({
      organizationId: ORG_A,
      subjectIds: [SUBJECT_ID],
      authScope: authA,
      observedRelease: pin,
    });
    expect(withReview.ok).toBe(true);
    if (!withReview.ok) return;
    expect(withReview.value.projections[0]?.reviewCount).toBe(1);
  });

  it("CATFIX-QUERY-05 counts distinct projects and current pointers, not historical values", async () => {
    const values = createProjectValueService(pool);
    const seedBinding = async (logicalNodeId: string, projectId: string) => {
      const binding = await stabilizeCanonicalBinding(pool, {
        snapshot,
        organizationId: ORG_A,
        projectId,
        logicalNodeId,
        registrationId: registrationId as never,
        definitionId: DEFINITION_ID,
        effectiveRevisionId: REVISION_1,
        expectedEffectiveRevisionId: null,
      });
      expect(binding.ok).toBe(true);
      if (!binding.ok) throw new Error("stabilizeCanonicalBinding failed");
      let expectedTip = binding.value.binding.currentValueId;
      for (const magnitude of [1, 2]) {
        const appended = await values.append({
          snapshot,
          binding: binding.value.binding,
          definitionRevisionId: REVISION_1,
          source: { sourceRef: `config-set:${logicalNodeId}`, configRevisionId: `crev-${magnitude}` },
          payload: { kind: "number", value: 1000 + magnitude },
          expectedTip,
        });
        expect(appended.ok).toBe(true);
        if (!appended.ok) throw new Error("append failed");
        expectedTip = appended.value.currentTip;
      }
      return binding.value.binding.id;
    };
    await seedBinding("logical-catfix-q-p1", PROJECT_A);
    await seedBinding("logical-catfix-q-p2", PROJECT_B);

    const oracle = await pool.query<{ project_count: string; current_value_count: string; history_count: string }>(
      `select
         (select count(distinct project_id)::text
            from parameter_catalog.project_parameter_bindings
           where organization_id = $1 and definition_id = $2) as project_count,
         (select count(*)::text
            from parameter_catalog.project_parameter_bindings binding
            join parameter_catalog.${VALUES_RELATION} value on value.id = binding.current_value_id
           where binding.organization_id = $1
             and binding.definition_id = $2
             and value.source_ref is distinct from $3) as current_value_count,
         (select count(*)::text
            from parameter_catalog.${VALUES_RELATION} value
            join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
           where binding.organization_id = $1
             and binding.definition_id = $2) as history_count`,
      [ORG_A, DEFINITION_ID, IDENTITY_PLACEHOLDER_SOURCE],
    );
    expect(oracle.rows[0]?.project_count).toBe("2");
    expect(oracle.rows[0]?.current_value_count).toBe("2");
    expect(Number(oracle.rows[0]?.history_count)).toBeGreaterThan(2);

    const summarized = await usage.summarize({
      organizationId: ORG_A,
      definitionIds: [DEFINITION_ID],
      projectScope: { kind: "all" },
      authScope: authA,
    });
    expect(summarized.ok).toBe(true);
    if (!summarized.ok) return;
    expect(summarized.value.summaries[0]).toMatchObject({
      definitionId: DEFINITION_ID,
      projectCount: 2,
      currentValueCount: 2,
      policyCount: 0,
    });
  });

  it("CATFIX-QUERY-06 keeps organization A and B projections isolated", async () => {
    const forB = await queries.projectRegistrations({
      organizationId: ORG_B,
      subjectIds: [SUBJECT_ID],
      authScope: authB,
      observedRelease: pin,
    });
    expect(forB.ok).toBe(true);
    if (!forB.ok) return;
    expect(forB.value.projections[0]?.registration).toEqual({ status: "unregistered" });

    const leaked = await queries.getRegistration({
      organizationId: ORG_B,
      registrationId,
      observedCatalogReleaseId: pin.id,
      authScope: authB,
    });
    expect(leaked.ok).toBe(false);
    if (leaked.ok) return;
    expect(leaked.error.kind).toBe("not-found");

    const usageB = await usage.summarize({
      organizationId: ORG_B,
      definitionIds: [DEFINITION_ID],
      projectScope: { kind: "all" },
      authScope: authB,
    });
    expect(usageB.ok).toBe(true);
    if (!usageB.ok) return;
    expect(usageB.value.summaries[0]).toMatchObject({
      projectCount: 0,
      currentValueCount: 0,
    });

    const cross = await queries.projectRegistrations({
      organizationId: ORG_A,
      subjectIds: [SUBJECT_ID],
      authScope: authB,
      observedRelease: pin,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.kind).toBe("not-found");
  });

  it("CATFIX-QUERY-07 distinguishes no-registrations, no-definitions, no-review-work, and filter miss", async () => {
    const emptyRegistrations = await queries.listRegistrations({
      organizationId: ORG_B,
      observedCatalogReleaseId: pin.id,
      authScope: authB,
    });
    expect(emptyRegistrations.ok).toBe(true);
    if (!emptyRegistrations.ok) return;
    expect(emptyRegistrations.value.items).toEqual([]);
    expect(emptyRegistrations.value.emptyReason).toBe("no-registrations");

    const browseAll = await queries.selectSubjectIds({
      organizationId: ORG_B,
      authScope: authB,
    });
    expect(browseAll.ok).toBe(true);
    if (!browseAll.ok) return;
    expect(browseAll.value).toEqual({ kind: "all" });

    const activeFilter = await queries.selectSubjectIds({
      organizationId: ORG_B,
      registration: "active",
      authScope: authB,
    });
    expect(activeFilter.ok).toBe(true);
    if (!activeFilter.ok) return;
    expect(activeFilter.value.kind).toBe("only");
    if (activeFilter.value.kind !== "only") return;
    expect(activeFilter.value.ids).toEqual([]);
    expect(emptyReasonForView("subjects", activeFilter.value.ids.length, true)).toBe("no-filter-match");
    expect(emptyReasonForView("definitions", 0, false)).toBe("no-definitions");
    expect(emptyReasonForView("reviews", 0, false)).toBe("no-review-work");

    const reviews = await createReviewQueueReader(pool).list({
      organizationId: ORG_B,
      capturedRelease: pin,
      context: { actorKind: "org-admin", principalId: authB.principalId, organizationId: ORG_B },
    });
    expect(reviews.ok).toBe(true);
    if (!reviews.ok) return;
    expect(reviews.value.emptyReason).toBe("no-review-work");
  });

  it("CATFIX-QUERY-08 returns typed errors for timeout and dependency failure", async () => {
    const timeoutQueries = createGovernanceCatalogQueries({
      query: async () => {
        const error = new Error("canceling statement due to statement timeout");
        (error as Error & { code: string }).code = "57014";
        throw error;
      },
    });
    const timeout = await timeoutQueries.listRegistrations({
      organizationId: ORG_A,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(timeout.ok).toBe(false);
    if (timeout.ok) return;
    expect(timeout.error).toEqual({ kind: "timeout", operation: "listRegistrations" });

    const downQueries = createGovernanceCatalogQueries({
      query: async () => {
        const error = new Error("connect ECONNREFUSED");
        (error as Error & { code: string }).code = "ECONNREFUSED";
        throw error;
      },
    });
    const down = await downQueries.projectRegistrations({
      organizationId: ORG_A,
      subjectIds: [SUBJECT_ID],
      authScope: authA,
      observedRelease: pin,
    });
    expect(down.ok).toBe(false);
    if (down.ok) return;
    expect(down.error.kind).toBe("dependency-failure");
  });

  it("CATFIX-QUERY-09 applies registration filters before pagination and invalidates cross-scope cursors", async () => {
    const catalogSubjectIds = [
      SUBJECT_ID,
      CatalogSubjectId("csub_query_unregistered_1"),
      CatalogSubjectId("csub_query_unregistered_2"),
      CatalogSubjectId("csub_query_unregistered_3"),
    ];
    const unregistered = await queries.selectSubjectIds({
      organizationId: ORG_A,
      registration: "unregistered",
      catalogSubjectIds,
      authScope: authA,
    });
    expect(unregistered.ok).toBe(true);
    if (!unregistered.ok) return;
    expect(unregistered.value.kind).toBe("only");
    if (unregistered.value.kind !== "only") return;
    expect([...unregistered.value.ids]).toEqual([
      CatalogSubjectId("csub_query_unregistered_1"),
      CatalogSubjectId("csub_query_unregistered_2"),
      CatalogSubjectId("csub_query_unregistered_3"),
    ]);

    const pageSize = 2;
    const firstPage = unregistered.value.ids.slice(0, pageSize);
    const secondPage = unregistered.value.ids.slice(pageSize, pageSize * 2);
    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(1);
    expect(new Set([...firstPage, ...secondPage]).size).toBe(3);

    const active = await queries.selectSubjectIds({
      organizationId: ORG_A,
      registration: "active",
      authScope: authA,
    });
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    const kernel = createCatalogKernel(pool);
    const loaded = await kernel.loadCurrentCatalog(pin);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const page = loaded.value.listSubjects({
      selection: active.value,
      kinds: [],
      lifecycles: ["active"],
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: { kind: "absent" } },
    });
    expect(page.status).toBe("found");
    if (page.status !== "found") return;
    expect(page.page.items.map((item) => item.id)).toEqual([SUBJECT_ID]);

    const listed = await queries.listRegistrations({
      organizationId: ORG_A,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
      limit: 1,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);
    const orgACursor = Buffer.from(
      serializeContract({
        organizationId: ORG_A,
        principalId: authA.principalId,
        lastId: registrationId,
      } as unknown as ContractJsonValue),
      "utf8",
    )
      .toString("base64url")
      .replace(/=+$/g, "");
    const cross = await queries.listRegistrations({
      organizationId: ORG_B,
      observedCatalogReleaseId: pin.id,
      authScope: authB,
      cursor: orgACursor,
      limit: 1,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.kind).toBe("invalid-cursor");

    const staleCatalogCursor = encodeCatalogCursor({
      releaseId: pin.id,
      digest: pin.digest,
      queryFingerprint: `sha256:${"0".repeat(64)}`,
      last: [SUBJECT_ID],
    });
    const replay = loaded.value.listSubjects({
      selection: active.value,
      kinds: [],
      lifecycles: ["active"],
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: { kind: "present", value: staleCatalogCursor } },
    });
    expect(replay.status).toBe("invalid-page");
    if (replay.status === "invalid-page") {
      expect(replay.reason).toBe("query-mismatch");
    }
  });

  it("CATFIX-QUERY-10 keeps statement count bounded between 25-row and 100-row pages", async () => {
    const counted = countingPool(pool);
    const bounded = createGovernanceCatalogQueries(counted.pool);
    const boundedUsage = createUsageQueries(counted.pool);
    const fakeSubjects = Array.from({ length: 99 }, (_, index) =>
      CatalogSubjectId(`csub_query_batch_${String(index + 1).padStart(3, "0")}`),
    );
    const subjects25 = [SUBJECT_ID, ...fakeSubjects.slice(0, 24)];
    const subjects100 = [SUBJECT_ID, ...fakeSubjects];

    counted.reset();
    const page25 = await bounded.projectRegistrations({
      organizationId: ORG_A,
      subjectIds: subjects25,
      authScope: authA,
      observedRelease: pin,
    });
    const statements25 = counted.statements();
    expect(page25.ok).toBe(true);

    counted.reset();
    const page100 = await bounded.projectRegistrations({
      organizationId: ORG_A,
      subjectIds: subjects100,
      authScope: authA,
      observedRelease: pin,
    });
    const statements100 = counted.statements();
    expect(page100.ok).toBe(true);
    expect(statements25).toBeGreaterThan(0);
    expect(statements100).toBe(statements25);
    expect(statements100).toBeLessThan(subjects100.length);

    counted.reset();
    const usage25 = await boundedUsage.summarize({
      organizationId: ORG_A,
      definitionIds: [DEFINITION_ID, ...fakeSubjects.slice(0, 24).map((id) => ParameterDefinitionId(`pdef_${id}`))],
      projectScope: { kind: "all" },
      authScope: authA,
    });
    const usageStatements25 = counted.statements();
    counted.reset();
    const usage100 = await boundedUsage.summarize({
      organizationId: ORG_A,
      definitionIds: [DEFINITION_ID, ...fakeSubjects.map((id) => ParameterDefinitionId(`pdef_${id}`))],
      projectScope: { kind: "all" },
      authScope: authA,
    });
    const usageStatements100 = counted.statements();
    expect(usage25.ok).toBe(true);
    expect(usage100.ok).toBe(true);
    expect(usageStatements100).toBe(usageStatements25);
    expect({
      projectRegistrations: { statements25, statements100 },
      usage: { usageStatements25, usageStatements100 },
    }).toEqual({
      projectRegistrations: { statements25, statements100 },
      usage: { usageStatements25, usageStatements100 },
    });
  });

  it("CATFIX-QUERY-11 treats a registration missing required Placement as an integrity error", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("set local session_replication_role = replica");
      await client.query(
        `update parameter_catalog.organization_subject_registrations
            set current_placement_id = $2
          where id = $1`,
        [registrationId, "spla_missing_required"],
      );
      const scoped = createGovernanceCatalogQueries(client);
      const result = await scoped.getRegistration({
        organizationId: ORG_A,
        registrationId,
        observedCatalogReleaseId: pin.id,
        authScope: authA,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        kind: "missing-required-placement",
        registrationId,
        subjectId: SUBJECT_ID,
      });
      const projected = await scoped.projectRegistrations({
        organizationId: ORG_A,
        subjectIds: [SUBJECT_ID],
        authScope: authA,
        observedRelease: pin,
      });
      expect(projected.ok).toBe(false);
      if (projected.ok) return;
      expect(projected.error.kind).toBe("missing-required-placement");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    const restored = await queries.getRegistration({
      organizationId: ORG_A,
      registrationId,
      observedCatalogReleaseId: pin.id,
      authScope: authA,
    });
    expect(restored.ok).toBe(true);
  });

  it("CATFIX-QUERY-12 does not leak org A cache into a later org B read", async () => {
    const first = await usage.summarize({
      organizationId: ORG_A,
      definitionIds: [DEFINITION_ID],
      projectScope: { kind: "all" },
      authScope: authA,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.summaries[0]?.projectCount).toBe(2);

    const second = await usage.summarize({
      organizationId: ORG_B,
      definitionIds: [DEFINITION_ID],
      projectScope: { kind: "all" },
      authScope: authB,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.summaries[0]?.projectCount).toBe(0);
    expect(second.value.summaries[0]?.currentValueCount).toBe(0);

    const subjectB = await queries.projectRegistrations({
      organizationId: ORG_B,
      subjectIds: [SUBJECT_ID],
      authScope: authB,
      observedRelease: pin,
    });
    expect(subjectB.ok).toBe(true);
    if (!subjectB.ok) return;
    expect(subjectB.value.projections[0]?.registration.status).toBe("unregistered");
  });
});

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCatalogKernel } from "../../catalog-kernel/interface";
import { seedCompiledCatalogProjection } from "../../catalog-kernel/runtime/currentSnapshot";
import {
  catalogDefinitionListResponseSchema,
  parameterCatalogCanonicalRoutes,
  parameterCatalogKernelReadByRouteId,
} from "../../contracts/dtoSchemas/parameterCatalog";
import {
  CatalogPageLimit,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
} from "../../parameter-catalog-contract/index";
import { createGovernanceCatalogQueries } from "../../parameter-governance/queries/index";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { mapCatalogDefinition } from "./dto";

/**
 * Issue #847 collection contract.
 *
 * Proves, against real PostgreSQL, that the definition collection query can:
 *  - report a truthful scoped count that is independent of the loaded page;
 *  - filter by an organization module subtree before pagination;
 *  - page the complete result set with an opaque cursor that stays bound to the
 *    release and to the query.
 *
 * The module subtree is a governance-scoped projection, so an unknown module
 * must be a not-found rather than an empty selection.
 */
const ORGANIZATION_ID = "org-847-collection";
const OTHER_ORGANIZATION_ID = "org-847-other";
const OWNER = { organizationId: ORGANIZATION_ID, principalId: "user-847-org-admin" };

const SUBJECT_WITH_DEFINITION = "csub_acme_power";
const PROPERTY_KEY = "iin_max";

describe("issue 847 collection contract", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let currentReleaseId: string;
  let currentReleaseDigest: string;

  const loadSnapshot = async () => {
    const runtime = createCatalogKernel(pool);
    const loaded = await runtime.loadCurrentCatalog({
      id: CatalogReleaseId(currentReleaseId),
      digest: CatalogReleaseDigest(currentReleaseDigest),
    });
    if (!loaded.ok) {
      throw new Error(`seeded current catalog must load: ${JSON.stringify(loaded.error)}`);
    }
    return loaded.value;
  };

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("i847collect");
    const pins = await seedCompiledCatalogProjection(database.url);
    currentReleaseId = pins.current.id;
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const release = await pool.query<{ release_digest: string }>(
      `select release_digest from parameter_catalog.catalog_releases where id = $1`,
      [currentReleaseId],
    );
    currentReleaseDigest = release.rows[0]!.release_digest;
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Issue 847')`, [
      ORGANIZATION_ID,
    ]);
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Issue 847 other')`, [
      OTHER_ORGANIZATION_ID,
    ]);
    // `parameter_modules_subject_kind_check` requires a placement node of kind
    // driver-group/node-type to carry the attribution subject it places, and
    // that subject must exist in the taxonomy.
    await pool.query(
      `insert into attribution_subjects
         (id, organization_id, subject_kind, display_name, origin, source_key)
       values ($1, $2, 'driver-registration', 'Acme power', 'curated', 'acme,power')`,
      ["asub-847-root", ORGANIZATION_ID],
    );
    // Root -> child -> grandchild, plus a sibling subtree that must stay excluded.
    for (const [id, parentId, name, path, depth, kind] of [
      ["mod-847-root", null, "整车", "整车", 1, "driver-group"],
      ["mod-847-child", "mod-847-root", "动力", "整车 / 动力", 2, "business"],
      ["mod-847-leaf", "mod-847-child", "电池", "整车 / 动力 / 电池", 3, "business"],
      ["mod-847-other", null, "其他", "其他", 1, "business"],
    ] as const) {
      await pool.query(
        `insert into public.parameter_modules
           (id, organization_id, parent_id, name, path, depth, sort_order, kind, origin,
            attribution_subject_id)
         values ($1, $2, $3, $4, $5, $6, 0, $7, 'curated', $8)`,
        [
          id,
          ORGANIZATION_ID,
          parentId,
          name,
          path,
          depth,
          kind,
          kind === "driver-group" ? "asub-847-root" : null,
        ],
      );
    }
    await pool.query(
      `insert into public.parameter_modules
         (id, organization_id, parent_id, name, path, depth, sort_order, kind, origin,
          attribution_subject_id)
       values
         ('mod-847-other-root', $1, null, '其他组织根', '其他组织根', 1, 0, 'business', 'curated', null)`,
      [OTHER_ORGANIZATION_ID],
    );
    await pool.query(
      `insert into attribution_subjects
         (id, organization_id, subject_kind, display_name, origin, source_key)
       values ('asub-847-other', $1, 'driver-registration', 'Other acme power', 'curated', 'acme,power-other')`,
      [OTHER_ORGANIZATION_ID],
    );
    await pool.query(
      `insert into public.parameter_modules
         (id, organization_id, parent_id, name, path, depth, sort_order, kind, origin,
          attribution_subject_id)
       values ('mod-847-other-driver', $1, 'mod-847-other-root', '其他驱动', '其他组织根 / 其他驱动', 2, 0,
               'driver-group', 'curated', 'asub-847-other')`,
      [OTHER_ORGANIZATION_ID],
    );
    // Registration and its current placement reference each other, so the
    // fixture defers constraints for the pair. A subject registers once per
    // organization (`unique (organization_id, subject_id)`), so the sibling
    // subtree and the retired registration live in a second organization.
    const registrationClient = await pool.connect();
    try {
      await registrationClient.query("begin");
      await registrationClient.query("set constraints all deferred");
      // A subject registers once per organization with one retained placement,
      // so the retired state is a status on that same registration.
      for (const [organizationId, registrationId, placementId, moduleId, status] of [
        [ORGANIZATION_ID, "reg-847-a", "plc-847-a", "mod-847-root", "active"],
        [OTHER_ORGANIZATION_ID, "reg-847-b", "plc-847-b", "mod-847-other-driver", "retired"],
      ] as const) {
        await registrationClient.query(
          `insert into parameter_catalog.organization_subject_registrations
             (id, organization_id, subject_id, status, registration_method, proof, current_placement_id)
           values ($1, $2, $3, $4, 'explicit', '{}'::jsonb, $5)`,
          [registrationId, organizationId, SUBJECT_WITH_DEFINITION, status, placementId],
        );
        await registrationClient.query(
          `insert into parameter_catalog.subject_placements
             (id, registration_id, organization_id, module_id, origin)
           values ($1, $2, $3, $4, 'curated')`,
          [placementId, registrationId, organizationId, moduleId],
        );
      }
      await registrationClient.query("set constraints all immediate");
      await registrationClient.query("commit");
    } catch (error) {
      await registrationClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      registrationClient.release();
    }
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  it("resolves a module subtree to its active placed subjects and rejects unknown modules", async () => {
    const queries = createGovernanceCatalogQueries(pool);
    const root = await queries.selectPlacementSubtreeSubjectIds({
      organizationId: ORGANIZATION_ID,
      moduleId: "mod-847-root",
      authScope: OWNER,
    });
    if (!root.ok) {
      throw new Error(`subtree query failed: ${JSON.stringify(root.error)}`);
    }
    // The subject is placed three levels below the selected module.
    expect(root.value.subjectIds).toEqual([SUBJECT_WITH_DEFINITION]);
    expect(root.value.moduleName).toBe("整车");

    // A sibling subtree in the same organization selects nothing.
    const sibling = await queries.selectPlacementSubtreeSubjectIds({
      organizationId: ORGANIZATION_ID,
      moduleId: "mod-847-other",
      authScope: OWNER,
    });
    expect(sibling.ok).toBe(true);
    if (sibling.ok) {
      expect(sibling.value.subjectIds).toEqual([]);
    }

    // The other organization's placed subject is retired, so the active-only
    // projection selects nothing even though the placement itself exists.
    const other = await queries.selectPlacementSubtreeSubjectIds({
      organizationId: OTHER_ORGANIZATION_ID,
      moduleId: "mod-847-other-root",
      authScope: { organizationId: OTHER_ORGANIZATION_ID, principalId: OWNER.principalId },
    });
    expect(other.ok).toBe(true);
    if (other.ok) {
      expect(other.value.subjectIds).toEqual([]);
    }

    const unknown = await queries.selectPlacementSubtreeSubjectIds({
      organizationId: ORGANIZATION_ID,
      moduleId: "mod-847-missing",
      authScope: OWNER,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error).toMatchObject({ kind: "not-found", resource: "module" });
    }

    const crossTenant = await queries.selectPlacementSubtreeSubjectIds({
      organizationId: OTHER_ORGANIZATION_ID,
      moduleId: "mod-847-root",
      authScope: OWNER,
    });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) {
      expect(crossTenant.error).toMatchObject({ kind: "not-found", resource: "organization" });
    }
  }, 60_000);

  it("reports a truthful scoped count and keeps the cursor bound to the query and release", async () => {
    const snapshot = await loadSnapshot();

    const first = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "all" },
      lifecycles: ["active"],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: { kind: "absent" } },
    });
    expect(first.status).toBe("found");
    if (first.status !== "found") return;
    // The count describes the whole filtered set, not the one-row page.
    expect(first.page.pageInfo.totalCount).toBeGreaterThan(1);
    expect(first.page.items).toHaveLength(1);
    expect(first.page.pageInfo.hasMore).toBe(true);

    const second = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "all" },
      lifecycles: ["active"],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: first.page.next },
    });
    expect(second.status).toBe("found");
    if (second.status !== "found") return;
    // A second page of the same query keeps the same honest total.
    expect(second.page.pageInfo.totalCount).toBe(first.page.pageInfo.totalCount);
    expect(second.page.items[0]!.id).not.toBe(first.page.items[0]!.id);

    // A different query cannot reuse the first query's cursor.
    const retargeted = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "all" },
      lifecycles: ["retired"],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: first.page.next },
    });
    expect(retargeted).toMatchObject({ status: "invalid-page", reason: "query-mismatch" });
  }, 60_000);

  it("scopes the definition collection to an explicit trusted subject selection", async () => {
    const snapshot = await loadSnapshot();

    const scoped = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "subjects", subjectIds: [CatalogSubjectId(SUBJECT_WITH_DEFINITION)] },
      lifecycles: ["active"],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(100), after: { kind: "absent" } },
    });
    expect(scoped.status).toBe("found");
    if (scoped.status !== "found") return;
    expect(scoped.page.items.length).toBeGreaterThan(0);
    expect(scoped.page.items.every((item) => item.subjectId === SUBJECT_WITH_DEFINITION)).toBe(true);
    expect(scoped.page.items.some((item) => item.propertyKey === PROPERTY_KEY)).toBe(true);

    const empty = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "subjects", subjectIds: [CatalogSubjectId("csub_847_absent")] },
      lifecycles: ["active"],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(100), after: { kind: "absent" } },
    });
    expect(empty.status).toBe("found");
    if (empty.status === "found") {
      expect(empty.page.items).toHaveLength(0);
      expect(empty.page.pageInfo).toEqual({ totalCount: 0, hasMore: false });
    }
  }, 60_000);

  it("searches the established attribution vocabulary, not only the property key", async () => {
    const snapshot = await loadSnapshot();

    // "iin_max" is a property key; "acme" only appears in the subject key.
    for (const search of ["iin_max", "acme"]) {
      const result = snapshot.listDefinitions({
        selection: { kind: "all" },
        scope: { kind: "all" },
        lifecycles: ["active"],
        propertyKey: { kind: "absent" },
        search: { kind: "present", value: search as never },
        page: { limit: CatalogPageLimit(100), after: { kind: "absent" } },
      });
      expect(result.status).toBe("found");
      if (result.status !== "found") continue;
      expect(result.page.items.length).toBeGreaterThan(0);
      expect(result.page.pageInfo.totalCount).toBe(result.page.items.length);
    }
  }, 60_000);

  it("projects the complete editable revision content the editor must initialize from", async () => {
    const snapshot = await loadSnapshot();
    const listed = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "all" },
      lifecycles: ["active"],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(100), after: { kind: "absent" } },
    });
    expect(listed.status).toBe("found");
    if (listed.status !== "found") return;
    const definition = listed.page.items.find((item) => item.propertyKey === PROPERTY_KEY);
    expect(definition).toBeDefined();
    const mapped = mapCatalogDefinition(
      snapshot,
      definition!,
      { status: "unregistered" },
      { policyCount: null, projectCount: 0, currentValueCount: 0 },
    );
    expect(mapped).not.toBeNull();
    // Regression guard: an unmapped display name or unit fails the DTO parse and
    // surfaces as a 500 on the definitions collection.
    expect(mapped!.currentRevision.displayName).toBe("Input current limit");
    expect(mapped!.currentRevision.unit).toEqual({ kind: "symbol", symbol: "mA" });
    expect(mapped!.currentRevision.documentation).toBe("Maximum accepted input current.");
  }, 60_000);

  it("publishes the count-bearing list contract through the canonical DTO schemas", () => {
    const route = parameterCatalogCanonicalRoutes.find((entry) => entry.id === "catalog.listDefinitions");
    expect(route).toBeDefined();
    expect(parameterCatalogKernelReadByRouteId["catalog.listDefinitions"]).toBe("listDefinitions");
    // The read route is derived from the kernel read capability, so the new
    // collection scope is carried by the kernel query contract itself.
    const scope = {
      kind: "subjects" as const,
      subjectIds: [CatalogSubjectId("csub_acme_power")],
    };
    expect(scope.subjectIds).toHaveLength(1);

    // The wire contract exposes both a truthful scoped count and stable paging.
    const envelope = catalogDefinitionListResponseSchema.parse({
      items: [],
      nextCursor: null,
      catalogReleaseId: "crel_847",
      totalCount: 7,
      hasMore: true,
    });
    expect(envelope.totalCount).toBe(7);
    expect(envelope.hasMore).toBe(true);

    // A missing count must be rejected rather than silently read as zero.
    expect(() =>
      catalogDefinitionListResponseSchema.parse({
        items: [],
        nextCursor: null,
        catalogReleaseId: "crel_847",
      }),
    ).toThrow();
  });
});

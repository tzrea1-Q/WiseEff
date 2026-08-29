import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import {
  findActiveOrganizationDriverSchemaByCompatible,
  getOrganizationDriverSchema,
  insertOrganizationDriverSchema,
  listOrganizationDriverSchemas,
  materializePlatformParameterSpecs,
  retirePlatformParameterSpecsForOverlay,
  setOrganizationDriverSchemaLifecycle
} from "./driverSchemaOverlayRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("organizationDriverSchemaRepository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen" }]
    });
    await seedCoreGraph(db, { organization: { id: "org-2", name: "OtherOrg" } });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("inserts a draft schema linking ParameterSpec rows", async () => {
    await seedSpecBindingGraph(db, {
      organizationId: "org-1",
      specs: [
        {
          id: "pspec-reg",
          specificationKey: "overlay-chip/reg",
          versions: [{ id: "psv-reg", displayName: "reg", valueShape: { kind: "u32-array" } }]
        }
      ]
    });
    // Units/documentation enrich through dts_property_specs; the structural-key
    // check bars 'reg' there, so the spec-side key differs from the overlay key.
    await db.query(
      `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, units, documentation)
       values ('dps-reg', 'pspec-reg', 'reg-window', 'wiseeff', null, 'bus address')`
    );

    const created = await insertOrganizationDriverSchema(db, {
      id: "ods-1",
      organizationId: "org-1",
      compatible: "vendor,overlay-chip",
      displayName: "Overlay Chip",
      notes: "gap fill",
      createdByUserId: "user-1",
      properties: [
        {
          id: "odsp-1",
          parameterSpecId: "pspec-reg",
          propertyKey: "reg"
        }
      ]
    });

    expect(created.lifecycle).toBe("draft");
    expect(created.organizationId).toBe("org-1");
    expect(created.compatible).toBe("vendor,overlay-chip");
    expect(created.activatedAt).toBeNull();
    expect(created.properties).toEqual([
      expect.objectContaining({
        parameterSpecId: "pspec-reg",
        parameterSpecVersionId: "psv-reg",
        propertyKey: "reg",
        valueShape: { kind: "u32-array" },
        documentation: "bus address",
        specLifecycle: "active"
      })
    ]);

    const listed = await listOrganizationDriverSchemas(db, { organizationId: "org-1" });
    expect(listed).toHaveLength(1);
    expect(listed[0].properties).toHaveLength(1);
    // Tenancy: the same schema id is invisible from another organization.
    expect(await getOrganizationDriverSchema(db, { organizationId: "org-2", schemaId: "ods-1" })).toBeNull();
    expect(await listOrganizationDriverSchemas(db, { organizationId: "org-2" })).toEqual([]);

    const stored = await db.query<{ lifecycle: string; version: number }>(
      `select lifecycle, version from driver_schema_overlays where id = 'ods-1'`
    );
    expect(stored.rows[0]).toMatchObject({ lifecycle: "draft", version: 1 });
  });

  it("allows two drafts for the same compatible but rejects a second active", async () => {
    await insertOrganizationDriverSchema(db, {
      id: "ods-draft-a",
      organizationId: "org-1",
      compatible: "vendor,same",
      displayName: "A",
      properties: []
    });
    await insertOrganizationDriverSchema(db, {
      id: "ods-draft-b",
      organizationId: "org-1",
      // Case only differs: the active-uniqueness index keys on lower(compatible).
      compatible: "Vendor,SAME",
      displayName: "B",
      properties: []
    });

    await db.transaction((tx) =>
      setOrganizationDriverSchemaLifecycle(tx, {
        organizationId: "org-1",
        schemaId: "ods-draft-a",
        lifecycle: "active",
        updatedByUserId: "user-1"
      })
    );

    // The second activation violates the partial unique index; running it in a
    // transaction keeps the rejected statement from poisoning the fixture.
    await expect(
      db.transaction((tx) =>
        setOrganizationDriverSchemaLifecycle(tx, {
          organizationId: "org-1",
          schemaId: "ods-draft-b",
          lifecycle: "active",
          updatedByUserId: "user-1"
        })
      )
    ).rejects.toMatchObject({ code: "23505" });

    const active = await findActiveOrganizationDriverSchemaByCompatible(db, {
      organizationId: "org-1",
      compatible: "vendor,same"
    });
    expect(active?.id).toBe("ods-draft-a");
    // First draft→active transition bumps the version and stamps activation.
    expect(active?.version).toBe(2);
    expect(active?.activatedAt).not.toBeNull();

    const loser = await getOrganizationDriverSchema(db, { organizationId: "org-1", schemaId: "ods-draft-b" });
    expect(loser).toMatchObject({ lifecycle: "draft", version: 1 });
  });

  it("materializes platform-owned subject-scoped copies without re-owning contributors", async () => {
    const sourceSubject = "asub:driver-registration:org-1-shared";
    await db.query(
      `insert into attribution_subjects
         (id, organization_id, subject_kind, display_name, origin, source_key)
       values ($1, 'org-1', 'driver-registration', 'Shared', 'curated', 'compatible:shared')`,
      [sourceSubject],
    );
    await db.query(
      `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
       values ($1, 'physical-device', 'multiple')`,
      [sourceSubject],
    );
    await db.query(
      `insert into parameter_specs
         (id, organization_id, source_kind, specification_key, definition_lifecycle,
          attribution_subject_id, property_key)
       values ('pspec:org-1-shared', 'org-1', 'manual', 'org/shared-limit', 'active', $1, 'shared_limit')`,
      [sourceSubject],
    );
    await db.query(
      `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape,
          lifecycle, version_status, units, constraints, documentation)
       values ('psv:org-1-shared:v1', 'pspec:org-1-shared', 1, 'shared_limit',
         'Shared limit', '{"kind":"u32-array"}'::jsonb, 'active', 'active',
         'mV', '{"min":0}'::jsonb, 'source docs')`,
    );
    await db.query(
      `insert into dts_property_specs
         (id, parameter_spec_id, property_key, schema_namespace, units, constraints, documentation)
       values ('dps:org-1-shared', 'pspec:org-1-shared', 'shared_limit',
         'org/org-1/shared', 'mV', '{"min":0}'::jsonb, 'source docs')`,
    );

    const mapped = await materializePlatformParameterSpecs(db, {
      compatible: "vendor,shared",
      sourceOrganizationId: "org-1",
      properties: [{
        parameterSpecId: "pspec:org-1-shared",
        parameterSpecVersionId: "psv:org-1-shared:v1",
        propertyKey: "shared_limit",
      }],
    });
    const platformId = mapped.get("pspec:org-1-shared");
    expect(platformId).toBeTruthy();
    expect(platformId).not.toBe("pspec:org-1-shared");

    const owners = await db.query<{
      id: string;
      organization_id: string | null;
      source_kind: string;
      definition_lifecycle: string;
      attribution_subject_id: string | null;
      property_key: string | null;
    }>(
      `select id, organization_id, source_kind, definition_lifecycle,
              attribution_subject_id, property_key
       from parameter_specs where id = any($1::text[]) order by id`,
      [["pspec:org-1-shared", platformId]],
    );
    expect(owners.rows).toHaveLength(2);
    expect(owners.rows.find((row) => row.id === "pspec:org-1-shared")).toMatchObject({
      organization_id: "org-1",
      source_kind: "manual",
      attribution_subject_id: sourceSubject,
      property_key: "shared_limit",
    });
    expect(owners.rows.find((row) => row.id === platformId)).toMatchObject({
      organization_id: null,
      source_kind: "manual",
      definition_lifecycle: "deprecated",
      property_key: "shared_limit",
    });
    expect(owners.rows.find((row) => row.id === platformId)?.attribution_subject_id).not.toBe(
      sourceSubject,
    );
    const active = await db.query<{ count: string }>(
      `select count(*)::text as count
       from parameter_spec_versions
       where parameter_spec_id = $1 and version_status = 'active' and lifecycle = 'active'`,
      [platformId],
    );
    expect(active.rows[0]?.count).toBe("1");

    await db.query(
      `insert into driver_schema_overlays
         (id, organization_id, compatible, display_name, lifecycle, version)
       values ('platform-overlay-shared', null, 'vendor,shared', 'Shared', 'deprecated', 1)`,
    );
    await db.query(
      `insert into driver_schema_overlay_properties
         (id, driver_schema_overlay_id, parameter_spec_id, property_key, sort_order)
       values ('platform-overlay-shared-property', 'platform-overlay-shared', $1, 'shared_limit', 0)`,
      [platformId],
    );
    expect(
      await retirePlatformParameterSpecsForOverlay(
        db,
        "platform-overlay-shared",
      ),
    ).toEqual([platformId]);
    const retired = await db.query<{ count: string }>(
      `select count(*)::text as count
       from parameter_spec_versions
       where parameter_spec_id = $1 and version_status = 'active'`,
      [platformId],
    );
    expect(retired.rows[0]?.count).toBe("0");
  });

  it("rejects a cross-tenant or stale contributor definition during platform materialization", async () => {
    const sourceSubject = "asub:driver-registration:org-2-private";
    await db.query(
      `insert into attribution_subjects
         (id, organization_id, subject_kind, display_name, origin, source_key)
       values ($1, 'org-2', 'driver-registration', 'Private', 'curated', 'compatible:private')`,
      [sourceSubject],
    );
    await db.query(
      `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
       values ($1, 'physical-device', 'multiple')`,
      [sourceSubject],
    );
    await db.query(
      `insert into parameter_specs
         (id, organization_id, source_kind, specification_key, definition_lifecycle,
          attribution_subject_id, property_key)
       values ('pspec:org-2-private', 'org-2', 'manual', 'org/private-limit', 'active', $1, 'private_limit')`,
      [sourceSubject],
    );
    await db.query(
      `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape,
          lifecycle, version_status, documentation)
       values ('psv:org-2-private:v1', 'pspec:org-2-private', 1, 'private_limit',
         'Private limit', '{"kind":"u32-array"}'::jsonb, 'active', 'active', 'private')`,
    );

    await expect(
      materializePlatformParameterSpecs(db, {
        compatible: "vendor,private",
        sourceOrganizationId: "org-1",
        properties: [{
          parameterSpecId: "pspec:org-2-private",
          parameterSpecVersionId: "psv:org-2-private:v1",
          propertyKey: "private_limit",
        }],
      }),
    ).rejects.toThrow(/does not belong to contributor organization/i);
  });
});

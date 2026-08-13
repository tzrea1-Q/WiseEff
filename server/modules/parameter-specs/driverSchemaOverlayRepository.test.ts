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
});

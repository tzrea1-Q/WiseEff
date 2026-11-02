import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedCompiledCatalogProjection } from "../../catalog-kernel/runtime/currentSnapshot";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";

describe("owned subject placements", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("ownedplacement");
    await seedCompiledCatalogProjection(database.url);
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
  }, 180_000);
  afterAll(async () => { await client?.end(); await database?.drop(); });
  beforeEach(async () => {
    await client.query("begin");
    await client.query("set constraints all deferred");
    await client.query(`insert into public.organizations(id,name) values ('owned-org','Owned'),('other-org','Other')`);
    await client.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin)
      values ('owned-module','owned-org','One','owned-module',1,'business','curated'),
             ('other-module','owned-org','Two','other-module',1,'business','curated')`);
    await client.query(`insert into parameter_catalog.catalog_releases
      (id,release_sequence,release_version,release_digest,compiled_model_digest,toolchain_digest,published_at)
      values ('owned-release',999999,'owned-release','owned-release','compiled','toolchain',now())`);
    await client.query(`insert into parameter_catalog.catalog_subjects(id,introduced_release_id,kind,canonical_key,owner_subject_id)
      values ('owned-driver','owned-release','driver','vendor,owned-driver',null),
             ('owned-child','owned-release','node-type','owned-child','owned-driver')`);
    await client.query(`insert into parameter_catalog.catalog_release_subjects(release_id,subject_id,lifecycle,selector_snapshot,selector_provenance)
      values ('owned-release','owned-driver','active','{}','{}'),('owned-release','owned-child','active','{}','{}')`);
    await client.query(`insert into parameter_catalog.catalog_drivers(subject_id,nature,cardinality)
      values ('owned-driver','physical-device','multiple')`);
    await client.query("insert into parameter_catalog.catalog_node_types(subject_id) values ('owned-child')");
    await client.query(`insert into parameter_catalog.organization_subject_registrations
      (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
      values ('driver-registration','owned-org','owned-driver','active','explicit','{}','driver-placement'),
             ('child-registration','owned-org','owned-child','active','explicit','{}','child-placement'),
             ('other-child-registration','other-org','owned-child','active','explicit','{}','other-child-placement')`);
    await client.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
      values ('driver-placement','driver-registration','owned-org','owned-module','curated'),
             ('child-placement','child-registration','owned-org',null,'curated'),
             ('other-child-placement','other-child-registration','other-org',null,'curated')`);
    await client.query("set constraints all immediate");
  });
  afterEach(async () => { await client.query("rollback"); });

  it("derives the module from the owner in the same organization and follows moves", async () => {
    const read = () => client.query(`select registration_id,module_id,via_owner_registration_id
      from parameter_catalog.registration_effective_module where subject_id='owned-child' order by registration_id`);
    expect((await read()).rows).toEqual([
      { registration_id: "child-registration", module_id: "owned-module", via_owner_registration_id: "driver-registration" },
      { registration_id: "other-child-registration", module_id: null, via_owner_registration_id: null },
    ]);
    await client.query("update parameter_catalog.subject_placements set module_id='other-module' where id='driver-placement'");
    expect((await read()).rows[0]).toEqual({ registration_id: "child-registration", module_id: "other-module", via_owner_registration_id: "driver-registration" });
  });

  it("rejects moving a child placement to a module", async () => {
    await expect(client.query("update parameter_catalog.subject_placements set module_id='other-module' where id='child-placement'"))
      .rejects.toMatchObject({ code: "23514", constraint: "subject_placement_kind_ck" });
  });

  it("rejects a new child placement with a module", async () => {
    await client.query("insert into public.organizations(id,name) values ('new-org','New')");
    await client.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin)
      values ('new-module','new-org','New','new-module',1,'business','curated')`);
    await client.query("set constraints all deferred");
    await client.query(`insert into parameter_catalog.organization_subject_registrations
      (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
      values ('new-registration','new-org','owned-child','active','explicit','{}','new-placement')`);
    await client.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
      values ('new-placement','new-registration','new-org','new-module','curated')`);
    await expect(client.query("set constraints all immediate"))
      .rejects.toMatchObject({ code: "23514", constraint: "subject_placement_kind_ck" });
  });

  it("keeps an unchanged placement valid after an existing subject gains an owner", async () => {
    await client.query("set constraints all deferred");
    await client.query(`insert into parameter_catalog.catalog_subjects(id,introduced_release_id,kind,canonical_key)
      values ('legacy-child','owned-release','node-type','legacy-child')`);
    await client.query(`insert into parameter_catalog.catalog_release_subjects(release_id,subject_id,lifecycle,selector_snapshot,selector_provenance)
      values ('owned-release','legacy-child','active','{}','{}')`);
    await client.query("insert into parameter_catalog.catalog_node_types(subject_id) values ('legacy-child')");
    await client.query(`insert into parameter_catalog.organization_subject_registrations
      (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
      values ('legacy-registration','owned-org','legacy-child','active','explicit','{}','legacy-placement')`);
    await client.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
      values ('legacy-placement','legacy-registration','owned-org','owned-module','curated')`);
    await client.query("set constraints all immediate");
    await client.query("select parameter_catalog.claim_catalog_subject_owner('legacy-child','owned-driver')");
    await client.query("update parameter_catalog.subject_placements set origin='auto' where id='legacy-placement'");
    await expect(client.query("update parameter_catalog.subject_placements set module_id='other-module' where id='legacy-placement'"))
      .rejects.toMatchObject({ code: "23514", constraint: "subject_placement_kind_ck" });
  });
});

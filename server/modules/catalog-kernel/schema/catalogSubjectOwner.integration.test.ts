import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { loadProjection, seedCompiledCatalogProjection } from "../runtime/currentSnapshot";
import { readCurrentCatalogPointer } from "../install/currentPointer";

describe("Catalog subject ownership", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("owner0321");
    await seedCompiledCatalogProjection(database.url);
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
  }, 180_000);
  afterAll(async () => { await client?.end(); await database?.drop(); });
  beforeEach(async () => { await client.query("begin"); });
  afterEach(async () => { await client.query("rollback"); });

  it("scopes subject and alias names", async () => {
    await client.query(`insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key, owner_subject_id)
      values ('owner-a', 'future', 'driver', 'vendor,owner-a', null),
             ('owner-b', 'future', 'driver', 'vendor,owner-b', null),
             ('child-a', 'future', 'node-type', 'battery1', 'owner-a'),
             ('child-b', 'future', 'node-type', 'battery1', 'owner-b'),
             ('child-free', 'future', 'node-type', 'battery1', null)`);
    await client.query(`insert into parameter_catalog.catalog_subject_aliases (id, introduced_release_id, subject_id, selector_kind, normalized_selector)
      values ('alias-a', 'future', 'child-a', 'node-type-name', 'battery_alias'),
             ('alias-b', 'future', 'child-b', 'node-type-name', 'battery_alias')`);
    await expect(client.query(`insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key)
      values ('duplicate-free', 'future', 'node-type', 'battery1')`)).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects duplicate aliases and cross-root collisions within an owner", async () => {
    await client.query(`insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key)
      values ('alias-subject-a', 'future', 'node-type', 'node_a'), ('alias-subject-b', 'future', 'node-type', 'node_b')`);
    await client.query(`insert into parameter_catalog.catalog_subject_aliases (id, introduced_release_id, subject_id, selector_kind, normalized_selector)
      values ('one-alias', 'future', 'alias-subject-a', 'node-type-name', 'same_alias')`);
    await client.query("savepoint duplicate_alias");
    await expect(client.query(`insert into parameter_catalog.catalog_subject_aliases (id, introduced_release_id, subject_id, selector_kind, normalized_selector)
      values ('two-alias', 'future', 'alias-subject-b', 'node-type-name', 'same_alias')`)).rejects.toMatchObject({ code: "23505" });
    await client.query("rollback to savepoint duplicate_alias");
    await expect(client.query(`insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key)
      values ('cross-root', 'future', 'node-type', 'same_alias')`)).rejects.toMatchObject({ code: "23505" });
  });

  it("allows a canonical name in one driver to equal an alias in another", async () => {
    await client.query(`insert into parameter_catalog.catalog_subjects (id,introduced_release_id,kind,canonical_key,owner_subject_id)
      values ('scope-driver-a','future','driver','vendor,scope-a',null),('scope-driver-b','future','driver','vendor,scope-b',null),
             ('scope-child-a','future','node-type','node_a','scope-driver-a')`);
    await client.query(`insert into parameter_catalog.catalog_subject_aliases (id,introduced_release_id,subject_id,selector_kind,normalized_selector)
      values ('scope-alias-a','future','scope-child-a','node-type-name','shared_name')`);
    await client.query(`insert into parameter_catalog.catalog_subjects (id,introduced_release_id,kind,canonical_key,owner_subject_id)
      values ('scope-child-b','future','node-type','shared_name','scope-driver-b')`);
    await expect(client.query(`insert into parameter_catalog.catalog_subjects (id,introduced_release_id,kind,canonical_key,owner_subject_id)
      values ('scope-child-c','future','node-type','shared_name','scope-driver-a')`)).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects an alias whose subject gains an owner after the alias was inserted", async () => {
    await client.query(`insert into parameter_catalog.catalog_subject_aliases (id,introduced_release_id,subject_id,selector_kind,normalized_selector)
      values ('late-alias','future','late-child','node-type-name','late_alias')`);
    await client.query(`insert into parameter_catalog.catalog_subjects (id,introduced_release_id,kind,canonical_key,owner_subject_id)
      values ('late-child','future','node-type','late_child','late-driver')`);
    await expect(client.query("set constraints parameter_catalog.catalog_alias_owner_matches_subject_ck immediate")).rejects.toMatchObject({ code: "23514" });
  });

  it("allows only the synchronizer claim and never reassigns or clears it", async () => {
    await client.query(`insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key)
      values ('claim-owner-a', 'future', 'driver', 'vendor,claim-a'),
             ('claim-owner-b', 'future', 'driver', 'vendor,claim-b'),
             ('claim-child', 'future', 'node-type', 'claim_child')`);
    await client.query(`insert into parameter_catalog.catalog_subject_aliases (id, introduced_release_id, subject_id, selector_kind, normalized_selector)
      values ('claim-alias', 'future', 'claim-child', 'node-type-name', 'claim_alias')`);
    await client.query("savepoint direct_update");
    await expect(client.query(`update parameter_catalog.catalog_subjects set owner_subject_id = 'claim-owner-a' where id = 'claim-child'`))
      .rejects.toMatchObject({ code: "55000" });
    await client.query("rollback to savepoint direct_update");
    expect((await client.query(`select parameter_catalog.claim_catalog_subject_owner('claim-child', 'claim-owner-a') as claimed`)).rows[0]).toEqual({ claimed: true });
    expect((await client.query(`select owner_subject_id from parameter_catalog.catalog_subject_aliases where id = 'claim-alias'`)).rows[0]).toEqual({ owner_subject_id: "claim-owner-a" });
    expect((await client.query(`select parameter_catalog.claim_catalog_subject_owner('claim-child', 'claim-owner-a') as claimed`)).rows[0]).toEqual({ claimed: false });
    await client.query("savepoint reassign");
    await expect(client.query(`select parameter_catalog.claim_catalog_subject_owner('claim-child', 'claim-owner-b')`)).rejects.toMatchObject({ code: "55000" });
    await client.query("rollback to savepoint reassign");
    await expect(client.query(`update parameter_catalog.catalog_subjects set owner_subject_id = null where id = 'claim-child'`)).rejects.toMatchObject({ code: "55000" });
  });

  it("rejects an owner that is not a driver", async () => {
    await client.query("savepoint wrong_child_kind");
    await expect(client.query(`insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key, owner_subject_id)
      values ('wrong-kind', 'future', 'driver', 'vendor,wrong-kind', 'another-driver')`)).rejects.toMatchObject({ code: "23514" });
    await client.query("rollback to savepoint wrong_child_kind");
    await client.query(`insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key, owner_subject_id)
      values ('not-driver', 'future', 'node-type', 'other', null),
             ('bad-child', 'future', 'node-type', 'child', 'not-driver')`);
    await expect(client.query("set constraints parameter_catalog.catalog_subject_owner_driver_fk immediate")).rejects.toMatchObject({ code: "23503" });
  });

  it("exposes the claim function only to the synchronizer, without direct owner updates", async () => {
    const privileges = await client.query(`select
      has_function_privilege('public','parameter_catalog.claim_catalog_subject_owner(text,text)','execute') as public_claim,
      has_function_privilege('parameter_governance_writer_role','parameter_catalog.claim_catalog_subject_owner(text,text)','execute') as writer_claim,
      has_function_privilege('catalog_synchronizer_role','parameter_catalog.claim_catalog_subject_owner(text,text)','execute') as sync_claim,
      has_column_privilege('catalog_synchronizer_role','parameter_catalog.catalog_subjects','owner_subject_id','update') as sync_update`);
    expect(privileges.rows).toEqual([{ public_claim: false, writer_claim: false, sync_claim: true, sync_update: false }]);
  });

  it("allows the least-privilege offline reader to load ownership and the current pointer", async () => {
    await client.query("set local role wiseeff_mod_d02_source_reader");
    const pointer = await readCurrentCatalogPointer(client);
    expect(pointer.kind).toBe("installed");
    if (pointer.kind === "installed") expect(await loadProjection(client, pointer.current.id, "current")).not.toBeNull();
  });

  it("allows the synchronizer role to create and claim owned nodes without direct update grants", async () => {
    await client.query("set local role catalog_synchronizer_role");
    await client.query(`insert into parameter_catalog.catalog_subjects (id,introduced_release_id,kind,canonical_key)
      values ('role-driver','future','driver','vendor,role-driver'),('role-child','future','node-type','role_child')`);
    await client.query(`insert into parameter_catalog.catalog_drivers(subject_id,nature,cardinality)
      values ('role-driver','physical-device','multiple')`);
    await client.query(`insert into parameter_catalog.catalog_node_types(subject_id) values ('role-child')`);
    expect((await client.query(`select parameter_catalog.claim_catalog_subject_owner('role-child','role-driver') as claimed`)).rows[0]).toEqual({ claimed: true });
    await client.query("set constraints parameter_catalog.catalog_subject_owner_driver_fk immediate");
  });
});

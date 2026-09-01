import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";

const databaseAvailable = await isTestDatabaseAvailable();

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function captureDatabaseError(action: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(pg.DatabaseError);
    return error as pg.DatabaseError;
  }
  throw new Error("Expected PostgreSQL to reject the operation");
}

describe.skipIf(!databaseAvailable)("canonical Catalog deferred constraints", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("pcatdefer");
    client = await connect(database.url);
    await client.query(`
      insert into public.organizations (id, name) values
        ('org-pcat', 'Catalog test'),
        ('org-pcat-2', 'Catalog test two');
      insert into public.projects (id, organization_id, name, code) values
        ('project-pcat', 'org-pcat', 'Catalog project', 'PCAT'),
        ('project-pcat-2', 'org-pcat-2', 'Catalog project two', 'PCAT2');
      insert into public.attribution_subjects (
        id, organization_id, subject_kind, display_name, source_key
      ) values
        ('legacy-subject-one', 'org-pcat', 'driver-registration', 'Driver', 'compatible:test,one'),
        ('legacy-subject-two', 'org-pcat-2', 'driver-registration', 'Driver', 'compatible:test,two'),
        ('legacy-node-type', 'org-pcat', 'node-type-definition', 'Node type', 'nodetype:test-node');
      insert into public.driver_registrations (
        attribution_subject_id, driver_nature, instance_cardinality
      ) values
        ('legacy-subject-one', 'physical-device', 'multiple'),
        ('legacy-subject-two', 'physical-device', 'multiple');
      insert into public.node_type_definitions (attribution_subject_id, bare_node_name)
      values ('legacy-node-type', 'test-node');
      insert into public.parameter_modules (
        id, organization_id, name, path, depth, kind, origin, attribution_subject_id
      ) values (
        'pmod-driver', 'org-pcat', 'Driver', 'pmod-driver', 1, 'driver-group', 'curated', 'legacy-subject-one'
      ), (
        'pmod-driver-2', 'org-pcat-2', 'Driver', 'pmod-driver-2', 1, 'driver-group', 'curated', 'legacy-subject-two'
      ), (
        'pmod-node-type', 'org-pcat', 'Node type', 'pmod-node-type', 1, 'node-type', 'curated', 'legacy-node-type'
      );
      begin;
      insert into parameter_catalog.catalog_subjects (id, kind, canonical_key)
      values ('csub-driver', 'driver', 'driver:test');
      insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
      values ('csub-driver', 'platform', '{"minimum":1,"maximum":1}');
      insert into parameter_catalog.catalog_subjects (id, kind, canonical_key)
      values ('csub-node-type', 'node-type', 'node-type:test');
      insert into parameter_catalog.catalog_node_types (subject_id, family)
      values ('csub-node-type', 'device');
      set constraints all immediate;
      commit;
    `);
  });

  afterEach(async () => {
    await client?.query("rollback").catch(() => undefined);
    await client?.end().catch(() => undefined);
    await database?.drop();
  });

  it("commits Registration plus exactly one Placement in either insert order", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.organization_subject_registrations (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values (
        'reg-active', 'org-pcat', 'csub-driver', 'active', 'explicit', '{}', 'placement-active'
      );
      insert into parameter_catalog.subject_placements (
        id, registration_id, organization_id, module_id, origin
      ) values (
        'placement-active', 'reg-active', 'org-pcat', 'pmod-driver', 'curated'
      );
      set constraints all immediate;
      commit;
    `);

    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.subject_placements (
        id, registration_id, organization_id, module_id, origin
      ) values (
        'placement-retired', 'reg-retired', 'org-pcat-2', 'pmod-driver-2', 'curated'
      );
      insert into parameter_catalog.organization_subject_registrations (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values (
        'reg-retired', 'org-pcat-2', 'csub-driver', 'retired', 'review', '{}', 'placement-retired'
      );
      set constraints all immediate;
      commit;
    `);

    const result = await client.query<{ registrations: string; placements: string }>(`
      select
        (select count(*)::text from parameter_catalog.organization_subject_registrations) as registrations,
        (select count(*)::text from parameter_catalog.subject_placements) as placements
    `);
    expect(result.rows).toEqual([{ registrations: "2", placements: "2" }]);
  });

  it.each([
    {
      name: "missing subtype",
      subjectSql:
        "insert into parameter_catalog.catalog_subjects (id, kind, canonical_key) values ('csub-bad', 'driver', 'driver:bad')",
      subtypeSql: "select 1"
    },
    {
      name: "both subtypes",
      subjectSql:
        "insert into parameter_catalog.catalog_subjects (id, kind, canonical_key) values ('csub-bad', 'driver', 'driver:bad')",
      subtypeSql: `
        insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
        values ('csub-bad', 'platform', '{}');
        insert into parameter_catalog.catalog_node_types (subject_id, family)
        values ('csub-bad', 'device')
      `
    },
    {
      name: "mismatched subtype",
      subjectSql:
        "insert into parameter_catalog.catalog_subjects (id, kind, canonical_key) values ('csub-bad', 'node-type', 'node-type:bad')",
      subtypeSql: `
        insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
        values ('csub-bad', 'platform', '{}')
      `
    }
  ])("rejects a Catalog Subject with $name at deferred constraint evaluation", async ({ subjectSql, subtypeSql }) => {
    await client.query("begin");
    await client.query(subjectSql);
    await client.query(subtypeSql);
    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_subject_exact_subtype_ck");
    await client.query("rollback");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_subjects where id = 'csub-bad'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a Definition head owned by another Definition at COMMIT time with zero residue", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-def', 'definitions', 'sha256:def-release', 'sha256:def-compiled', 'sha256:def-toolchain');

      insert into parameter_catalog.parameter_definitions (
        id, subject_id, property_key, current_revision_id
      ) values
        ('pdef-a', 'csub-driver', 'property-a', 'drev-b'),
        ('pdef-b', 'csub-driver', 'property-b', 'drev-b');

      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values
        ('drev-a', 'pdef-a', 1, 'crel-def', 'sha256:drev-a', '{}'),
        ('drev-b', 'pdef-b', 1, 'crel-def', 'sha256:drev-b', '{}');
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("parameter_definition_current_revision_fk");
    await client.query("rollback");

    const residue = await client.query<{ definitions: string; revisions: string }>(`
      select
        (select count(*)::text from parameter_catalog.parameter_definitions where id in ('pdef-a', 'pdef-b')) as definitions,
        (select count(*)::text from parameter_catalog.definition_revisions where id in ('drev-a', 'drev-b')) as revisions
    `);
    expect(residue.rows).toEqual([{ definitions: "0", revisions: "0" }]);
  });

  it("rejects a Registration without its retained Placement at deferred constraint evaluation", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.organization_subject_registrations (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values (
        'reg-orphan', 'org-pcat', 'csub-driver', 'retired', 'explicit', '{}', 'placement-missing'
      )
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("registration_current_placement_fk");
    await client.query("rollback");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.organization_subject_registrations where id = 'reg-orphan'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects ReviewEvidence attributed to a different Organization than its Observation", async () => {
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-evidence', 'evidence', 'sha256:evidence', 'sha256:evidence-compiled', 'sha256:evidence-toolchain');
      insert into parameter_catalog.parameter_observations (
        id, organization_id, project_id, logical_node_id, config_revision_id,
        source_identity, source_locator, catalog_release_id, matcher_revision, evidence_fingerprint
      ) values (
        'pobs-one', 'org-pcat', 'project-pcat', 'logical-node-evidence', 'config-evidence',
        'source-evidence', '{}', 'crel-evidence', 'matcher-evidence', 'sha256:evidence-fingerprint'
      );
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.parameter_review_evidence (
          id, organization_id, observation_id, reason, candidate_safe_digest, evidence
        ) values (
          'prev-cross-org', 'org-pcat-2', 'pobs-one', 'unknown', 'sha256:candidate-safe', '{}'
        )
      `)
    );
    expect(error.code).toBe("23503");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.parameter_review_evidence where id = 'prev-cross-org'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a successor that omits a predecessor Subject and preserves the old pointer", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-a', '1.0.0', 'sha256:release-a', 'sha256:compiled-a', 'sha256:toolchain-a');
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-a', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-a', 'sha256:compiled-fp-a', 'sha256:database-fp-a', 'attempt-a', 'audit-a');
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-a');
      set constraints all immediate;
      commit;
    `);

    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, predecessor_release_id,
        compiled_model_digest, toolchain_digest
      ) values (
        'crel-b', '2.0.0', 'sha256:release-b', 'crel-a',
        'sha256:compiled-b', 'sha256:toolchain-b'
      );
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-b', 'sha256:compiled-fp-b', 'sha256:database-fp-b', 'attempt-b', 'audit-b');
      update parameter_catalog.catalog_state set current_catalog_release_id = 'crel-b';
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_state_current_release_complete_ck");
    await client.query("rollback");

    const state = await client.query<{ current_catalog_release_id: string }>(
      "select current_catalog_release_id from parameter_catalog.catalog_state"
    );
    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_releases where id = 'crel-b'"
    );
    expect(state.rows[0]?.current_catalog_release_id).toBe("crel-a");
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a successor that omits a predecessor alias and preserves the old pointer", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_subject_aliases (
        id, subject_id, selector_kind, normalized_selector
      ) values ('calias-driver', 'csub-driver', 'driver-compatible', 'test,driver');
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-alias-a', 'alias-1', 'sha256:alias-a', 'sha256:alias-compiled-a', 'sha256:alias-toolchain-a');
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-alias-a', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.catalog_release_subject_aliases (
        release_id, subject_id, alias_id, lifecycle, selector_provenance
      ) values ('crel-alias-a', 'csub-driver', 'calias-driver', 'active', '{}');
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-alias-a', 'sha256:alias-compiled-fp-a', 'sha256:alias-database-fp-a', 'alias-attempt-a', 'alias-audit-a');
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-alias-a');
      set constraints all immediate;
      commit;
    `);

    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, predecessor_release_id,
        compiled_model_digest, toolchain_digest
      ) values (
        'crel-alias-b', 'alias-2', 'sha256:alias-b', 'crel-alias-a',
        'sha256:alias-compiled-b', 'sha256:alias-toolchain-b'
      );
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-alias-b', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-alias-b', 'sha256:alias-compiled-fp-b', 'sha256:alias-database-fp-b', 'alias-attempt-b', 'alias-audit-b');
      update parameter_catalog.catalog_state set current_catalog_release_id = 'crel-alias-b';
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_state_current_release_complete_ck");
    await client.query("rollback");

    const state = await client.query<{ current_catalog_release_id: string }>(
      "select current_catalog_release_id from parameter_catalog.catalog_state"
    );
    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_releases where id = 'crel-alias-b'"
    );
    expect(state.rows[0]?.current_catalog_release_id).toBe("crel-alias-a");
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects an active alias whose release Subject is retired", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_subject_aliases (
        id, subject_id, selector_kind, normalized_selector
      ) values ('calias-retired', 'csub-driver', 'driver-compatible', 'test,retired');
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-retired-alias', 'retired-alias', 'sha256:retired-alias', 'sha256:retired-compiled', 'sha256:retired-toolchain');
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
      ) values ('crel-retired-alias', 'csub-driver', 'retired', '{}', '{}', '{}');
      insert into parameter_catalog.catalog_release_subject_aliases (
        release_id, subject_id, alias_id, lifecycle, selector_provenance
      ) values ('crel-retired-alias', 'csub-driver', 'calias-retired', 'active', '{}');
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-retired-alias', 'sha256:retired-compiled-fp', 'sha256:retired-database-fp', 'retired-attempt', 'retired-audit');
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-retired-alias');
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_state_current_release_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ state: string; release: string }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_state) as state,
        (select count(*)::text from parameter_catalog.catalog_releases where id = 'crel-retired-alias') as release
    `);
    expect(residue.rows).toEqual([{ state: "0", release: "0" }]);
  });

  it.each([
    { name: "missing", headSql: "select 1" },
    {
      name: "split",
      headSql: `
        insert into parameter_catalog.catalog_release_definition_heads (
          release_id, definition_id, revision_id
        ) values ('crel-head', 'pdef-head', 'drev-head-other')
      `
    }
  ])("rejects a current release with $name Definition heads", async ({ headSql }) => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-head', 'head', 'sha256:head', 'sha256:head-compiled', 'sha256:head-toolchain');
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-head', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.parameter_definitions (
        id, subject_id, property_key, current_revision_id
      ) values ('pdef-head', 'csub-driver', 'head-property', 'drev-head-current');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values
        ('drev-head-current', 'pdef-head', 1, 'crel-head', 'sha256:head-current', '{}'),
        ('drev-head-other', 'pdef-head', 2, 'crel-head', 'sha256:head-other', '{}');
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-head', 'sha256:head-compiled-fp', 'sha256:head-database-fp', 'head-attempt', 'head-audit');
    `);
    await client.query(headSql);
    await client.query(`
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-head')
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_state_current_release_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ definitions: string; state: string }>(`
      select
        (select count(*)::text from parameter_catalog.parameter_definitions where id = 'pdef-head') as definitions,
        (select count(*)::text from parameter_catalog.catalog_state) as state
    `);
    expect(residue.rows).toEqual([{ definitions: "0", state: "0" }]);
  });

  it("permits a pre-traffic switch-back after a successor introduced a new Definition", async () => {
    await client.query(`
      begin;
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-switch-a', 'switch-a', 'sha256:switch-a', 'sha256:switch-compiled-a', 'sha256:switch-toolchain-a');
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-switch-a', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.parameter_definitions (
        id, subject_id, property_key, current_revision_id
      ) values ('pdef-switch-old', 'csub-driver', 'old-property', 'drev-switch-a');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values ('drev-switch-a', 'pdef-switch-old', 1, 'crel-switch-a', 'sha256:switch-rev-a', '{}');
      insert into parameter_catalog.catalog_release_definition_heads (
        release_id, definition_id, revision_id
      ) values ('crel-switch-a', 'pdef-switch-old', 'drev-switch-a');
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-switch-a', 'sha256:switch-compiled-fp-a', 'sha256:switch-database-fp-a', 'switch-attempt-a', 'switch-audit-a');
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-switch-a');
      set constraints all immediate;
      commit;

      begin;
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, predecessor_release_id,
        compiled_model_digest, toolchain_digest
      ) values (
        'crel-switch-b', 'switch-b', 'sha256:switch-b', 'crel-switch-a',
        'sha256:switch-compiled-b', 'sha256:switch-toolchain-b'
      );
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-switch-b', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values ('drev-switch-b', 'pdef-switch-old', 2, 'crel-switch-b', 'sha256:switch-rev-b', '{}');
      update parameter_catalog.parameter_definitions
      set current_revision_id = 'drev-switch-b'
      where id = 'pdef-switch-old';
      insert into parameter_catalog.parameter_definitions (
        id, subject_id, property_key, current_revision_id
      ) values ('pdef-switch-new', 'csub-driver', 'new-property', 'drev-switch-new');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values ('drev-switch-new', 'pdef-switch-new', 1, 'crel-switch-b', 'sha256:switch-rev-new', '{}');
      insert into parameter_catalog.catalog_release_definition_heads (
        release_id, definition_id, revision_id
      ) values
        ('crel-switch-b', 'pdef-switch-old', 'drev-switch-b'),
        ('crel-switch-b', 'pdef-switch-new', 'drev-switch-new');
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-switch-b', 'sha256:switch-compiled-fp-b', 'sha256:switch-database-fp-b', 'switch-attempt-b', 'switch-audit-b');
      update parameter_catalog.catalog_state set current_catalog_release_id = 'crel-switch-b';
      set constraints all immediate;
      commit;
    `);

    await client.query("begin");
    await client.query(`
      update parameter_catalog.parameter_definitions
      set current_revision_id = 'drev-switch-a'
      where id = 'pdef-switch-old';
      update parameter_catalog.catalog_state set current_catalog_release_id = 'crel-switch-a'
    `);
    await client.query("set constraints all immediate");
    await client.query("commit");

    const state = await client.query<{
      current_catalog_release_id: string;
      old_head: string;
      future_definition_count: string;
    }>(`
      select
        (select current_catalog_release_id from parameter_catalog.catalog_state) as current_catalog_release_id,
        (select current_revision_id from parameter_catalog.parameter_definitions where id = 'pdef-switch-old') as old_head,
        (select count(*)::text from parameter_catalog.parameter_definitions where id = 'pdef-switch-new') as future_definition_count
    `);
    expect(state.rows).toEqual([{
      current_catalog_release_id: "crel-switch-a",
      old_head: "drev-switch-a",
      future_definition_count: "1"
    }]);
  });

  it("rejects cross-kind Placement and leaves no Registration or Placement residue", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.organization_subject_registrations (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values (
        'reg-wrong-kind', 'org-pcat', 'csub-node-type', 'active', 'explicit', '{}', 'placement-wrong-kind'
      );
      insert into parameter_catalog.subject_placements (
        id, registration_id, organization_id, module_id, origin
      ) values (
        'placement-wrong-kind', 'reg-wrong-kind', 'org-pcat', 'pmod-driver', 'curated'
      );
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("subject_placement_kind_ck");
    await client.query("rollback");

    const residue = await client.query<{ registrations: string; placements: string }>(`
      select
        (select count(*)::text from parameter_catalog.organization_subject_registrations where id = 'reg-wrong-kind') as registrations,
        (select count(*)::text from parameter_catalog.subject_placements where id = 'placement-wrong-kind') as placements
    `);
    expect(residue.rows).toEqual([{ registrations: "0", placements: "0" }]);
  });

  it("rejects a second Placement for one Registration", async () => {
    await client.query(`
      begin;
      insert into parameter_catalog.organization_subject_registrations (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values ('reg-single', 'org-pcat', 'csub-driver', 'active', 'explicit', '{}', 'placement-single');
      insert into parameter_catalog.subject_placements (
        id, registration_id, organization_id, module_id, origin
      ) values ('placement-single', 'reg-single', 'org-pcat', 'pmod-driver', 'curated');
      set constraints all immediate;
      commit;
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.subject_placements (
          id, registration_id, organization_id, module_id, origin
        ) values ('placement-second', 'reg-single', 'org-pcat', 'pmod-node-type', 'curated')
      `)
    );
    expect(error.code).toBe("23505");
    expect(error.constraint).toBe("subject_placements_registration_id_key");

    const placements = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.subject_placements where registration_id = 'reg-single'"
    );
    expect(placements.rows[0]?.count).toBe("1");
  });

  it("commits a Binding and first immutable ProjectValue together under deferred ownership keys", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-binding', 'binding', 'sha256:binding-release', 'sha256:binding-compiled', 'sha256:binding-toolchain');

      insert into parameter_catalog.parameter_definitions (
        id, subject_id, property_key, current_revision_id
      ) values ('pdef-binding', 'csub-driver', 'clock-frequency', 'drev-binding');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values ('drev-binding', 'pdef-binding', 1, 'crel-binding', 'sha256:drev-binding', '{}');

      insert into parameter_catalog.organization_subject_registrations (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values ('reg-binding', 'org-pcat', 'csub-driver', 'active', 'explicit', '{}', 'placement-binding');
      insert into parameter_catalog.subject_placements (
        id, registration_id, organization_id, module_id, origin
      ) values ('placement-binding', 'reg-binding', 'org-pcat', 'pmod-driver', 'curated');

      insert into parameter_catalog.project_parameter_bindings (
        id, organization_id, project_id, logical_node_id, registration_id, subject_id,
        definition_id, effective_revision_id, current_value_id, catalog_release_id
      ) values (
        'binding-one', 'org-pcat', 'project-pcat', 'logical-node-one', 'reg-binding', 'csub-driver',
        'pdef-binding', 'drev-binding', 'pvalue-one', 'crel-binding'
      );
      insert into parameter_catalog.project_parameter_values (
        id, binding_id, definition_id, definition_revision_id,
        source_ref, config_revision_id, value_digest, value_kind, value
      ) values (
        'pvalue-one', 'binding-one', 'pdef-binding', 'drev-binding',
        'source-one', 'config-one', 'sha256:value-one', 'number', '1000000'::jsonb
      );
      set constraints all immediate;
      commit;
    `);

    const result = await client.query<{ binding: string; current_value: string }>(`
      select binding.id as binding, value.id as current_value
      from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_values value
        on value.binding_id = binding.id
       and value.id = binding.current_value_id
      where binding.id = 'binding-one'
    `);
    expect(result.rows).toEqual([{ binding: "binding-one", current_value: "pvalue-one" }]);

    const immutable = await captureDatabaseError(
      client.query(
        "update parameter_catalog.project_parameter_values set value = '2000000'::jsonb where id = 'pvalue-one'"
      )
    );
    expect(immutable.code).toBe("55000");
  });
});

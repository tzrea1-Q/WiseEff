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

async function waitForDatabaseLock(observer: pg.Client, processId: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(`
      select coalesce(
        (
          select wait_event_type = 'Lock'
          from pg_catalog.pg_stat_activity
          where pid = $1
        ),
        false
      ) as waiting
    `, [processId]);
    if (result.rows[0]?.waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session ${processId} did not wait for the expected database lock`);
}

async function seedLegacyMappingRoots(client: pg.Client): Promise<void> {
  await client.query(`
    insert into parameter_catalog.catalog_releases (
      id, release_version, release_digest, compiled_model_digest, toolchain_digest
    ) values (
      'crel-legacy', 'legacy', 'sha256:legacy-release', 'sha256:legacy-compiled', 'sha256:legacy-toolchain'
    );
    insert into parameter_catalog.legacy_identities (
      id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
    ) values
      ('lid-a', 'legacy', 'parameter-spec', 'organization', 'org-pcat', 'source-a'),
      ('lid-b', 'legacy', 'parameter-spec', 'organization', 'org-pcat-2', 'source-b');
    insert into parameter_catalog.parameter_catalog_cutover_runs (
      id, source_snapshot_fingerprint, target_artifact_sha, target_catalog_release_digest,
      migration_contract_version, plan_digest, current_phase, state
    ) values
      (
        'cutover-a', 'sha256:snapshot-a', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'sha256:legacy-release', 'v1', 'sha256:plan-a', 'P6', 'running'
      ),
      (
        'cutover-b', 'sha256:snapshot-b', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'sha256:legacy-release', 'v1', 'sha256:plan-b', 'P6', 'running'
      );
  `);
}

async function seedTwoCanonicalBindings(client: pg.Client): Promise<void> {
  await client.query(`
    begin;
    insert into parameter_catalog.catalog_releases (
      id, release_version, release_digest, compiled_model_digest, toolchain_digest
    ) values (
      'crel-binding-owners', 'binding-owners', 'sha256:binding-owners',
      'sha256:binding-owners-compiled', 'sha256:binding-owners-toolchain'
    );
    insert into parameter_catalog.parameter_definitions (
      id, subject_id, property_key, current_revision_id
    ) values
      ('pdef-owner-a', 'csub-driver', 'owner-a', 'drev-owner-a'),
      ('pdef-owner-b', 'csub-driver', 'owner-b', 'drev-owner-b');
    insert into parameter_catalog.definition_revisions (
      id, definition_id, revision_number, catalog_release_id, content_digest, content
    ) values
      ('drev-owner-a', 'pdef-owner-a', 1, 'crel-binding-owners', 'sha256:drev-owner-a', '{}'),
      ('drev-owner-b', 'pdef-owner-b', 1, 'crel-binding-owners', 'sha256:drev-owner-b', '{}');
    insert into parameter_catalog.organization_subject_registrations (
      id, organization_id, subject_id, status, registration_method, proof, current_placement_id
    ) values (
      'reg-binding-owners', 'org-pcat', 'csub-driver', 'active', 'explicit', '{}', 'placement-binding-owners'
    );
    insert into parameter_catalog.subject_placements (
      id, registration_id, organization_id, module_id, origin
    ) values (
      'placement-binding-owners', 'reg-binding-owners', 'org-pcat', 'pmod-driver', 'curated'
    );
    insert into parameter_catalog.project_parameter_bindings (
      id, organization_id, project_id, logical_node_id, registration_id, subject_id,
      definition_id, effective_revision_id, current_value_id, catalog_release_id
    ) values
      (
        'binding-owner-a', 'org-pcat', 'project-pcat', 'logical-owner', 'reg-binding-owners',
        'csub-driver', 'pdef-owner-a', 'drev-owner-a', 'pvalue-owner-a', 'crel-binding-owners'
      ),
      (
        'binding-owner-b', 'org-pcat', 'project-pcat', 'logical-owner', 'reg-binding-owners',
        'csub-driver', 'pdef-owner-b', 'drev-owner-b', 'pvalue-owner-b', 'crel-binding-owners'
      );
    insert into parameter_catalog.project_parameter_values (
      id, binding_id, definition_id, definition_revision_id,
      source_ref, config_revision_id, value_digest, value_kind, value
    ) values
      (
        'pvalue-owner-a', 'binding-owner-a', 'pdef-owner-a', 'drev-owner-a',
        'source-owner-a', 'config-owner-a', 'sha256:value-owner-a', 'number', '1'
      ),
      (
        'pvalue-owner-b', 'binding-owner-b', 'pdef-owner-b', 'drev-owner-b',
        'source-owner-b', 'config-owner-b', 'sha256:value-owner-b', 'number', '2'
      );
    set constraints all immediate;
    commit;
  `);
}

async function seedLegacyOwnershipTargets(client: pg.Client): Promise<void> {
  await seedLegacyMappingRoots(client);
  await seedTwoCanonicalBindings(client);
  await client.query(`
    begin;
    insert into parameter_catalog.binding_history_events (
      id, binding_id, old_effective_revision_id, new_effective_revision_id,
      old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
    ) values (
      'bhist-owner-target', 'binding-owner-a', 'drev-owner-a', 'drev-owner-a',
      null, 'pvalue-owner-a', 'owner target', 'audit-bhist-owner', 'crel-binding-owners'
    );
    insert into parameter_catalog.parameter_review_evidence (
      id, organization_id, reason, candidate_safe_digest, evidence
    ) values (
      'prev-owner-target', 'org-pcat', 'unknown', 'sha256:candidate-owner', '{}'
    );
    insert into parameter_catalog.definition_proposals (
      id, organization_id, author_principal_id, base_catalog_release_id,
      status, current_proposal_revision_id, etag_version
    ) values (
      'dprop-owner-target', 'org-pcat', 'principal-owner', 'crel-binding-owners',
      'draft', 'dprev-owner-target', 1
    );
    insert into parameter_catalog.definition_proposal_revisions (
      id, proposal_id, revision_number, payload, reason, evidence_refs
    ) values (
      'dprev-owner-target', 'dprop-owner-target', 1, '{}', 'owner target', '[]'
    );
    insert into parameter_catalog.legacy_identities (
      id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
    ) values
      (
        'lid-subject-org-two', 'legacy', 'parameter-subject',
        'organization', 'org-pcat-2', 'source-subject-org-two'
      ),
      (
        'lid-placement-org-two', 'legacy', 'parameter-placement',
        'organization', 'org-pcat-2', 'source-placement-org-two'
      ),
      (
        'lid-binding-project-two', 'legacy', 'project-parameter-binding',
        'project', 'project-pcat-2', 'source-binding-project-two'
      ),
      (
        'lid-binding-revision-project-two', 'legacy', 'project-parameter-binding-revision',
        'project', 'project-pcat-2', 'source-binding-revision-project-two'
      );
    set constraints all immediate;
    commit;
  `);
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
      values ('csub-driver', 'physical-device', 'multiple');
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
        values ('csub-bad', 'physical-device', 'multiple');
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
        values ('csub-bad', 'physical-device', 'multiple')
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

  it.each([
    {
      name: "nature outside the frozen S1-BND enum",
      subjectId: "csub-invalid-driver-nature",
      canonicalKey: "driver:invalid-nature",
      nature: "platform",
      cardinality: "multiple",
      constraint: "catalog_driver_nature_ck"
    },
    {
      name: "cardinality outside the frozen S1-BND enum",
      subjectId: "csub-invalid-driver-cardinality",
      canonicalKey: "driver:invalid-cardinality",
      nature: "physical-device",
      cardinality: "{}",
      constraint: "catalog_driver_cardinality_ck"
    }
  ])("rejects a Driver $name", async ({ subjectId, canonicalKey, nature, cardinality, constraint }) => {
    await client.query("begin");
    await client.query(
      "insert into parameter_catalog.catalog_subjects (id, kind, canonical_key) values ($1, 'driver', $2)",
      [subjectId, canonicalKey]
    );
    const error = await captureDatabaseError(
      client.query(
        "insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality) values ($1, $2, $3)",
        [subjectId, nature, cardinality]
      )
    );
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe(constraint);
    await client.query("rollback");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_subjects where id = $1",
      [subjectId]
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a Subject alias selector kind outside the frozen S0-ID registry", async () => {
    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.catalog_subject_aliases (
          id, subject_id, selector_kind, normalized_selector
        ) values ('calias-invalid-kind', 'csub-driver', 'vendor-identifier', 'vendor,device')
      `)
    );
    expect(error.code).toBe("23514");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_subject_aliases where id = 'calias-invalid-kind'"
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

  it.each([
    {
      name: "Catalog Release",
      catalogReleaseId: "crel-observation-b",
      matcherRevision: "matcher-a"
    },
    {
      name: "matcher revision",
      catalogReleaseId: "crel-binding-owners",
      matcherRevision: "matcher-b"
    }
  ])("rejects an ObservationMatch that borrows another Observation's $name pin", async ({
    catalogReleaseId,
    matcherRevision
  }) => {
    await seedTwoCanonicalBindings(client);
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-observation-b', 'observation-b', 'sha256:observation-b',
        'sha256:observation-b-compiled', 'sha256:observation-b-toolchain'
      );
      insert into parameter_catalog.parameter_observations (
        id, organization_id, project_id, logical_node_id, config_revision_id,
        source_identity, source_locator, catalog_release_id, matcher_revision, evidence_fingerprint
      ) values
        (
          'pobs-a', 'org-pcat', 'project-pcat', 'logical-observation-a', 'config-observation-a',
          'source-observation-a', '{}', 'crel-binding-owners', 'matcher-a', 'sha256:observation-a'
        ),
        (
          'pobs-b', 'org-pcat', 'project-pcat', 'logical-observation-b', 'config-observation-b',
          'source-observation-b', '{}', 'crel-observation-b', 'matcher-b', 'sha256:observation-b'
        )
    `);

    const error = await captureDatabaseError(
      client.query(
        `
          insert into parameter_catalog.parameter_observation_matches (
            id, observation_id, organization_id, registration_id, subject_id,
            definition_id, definition_revision_id, binding_id,
            catalog_release_id, matcher_revision
          ) values (
            'pmatch-cross-observation', 'pobs-a', 'org-pcat', 'reg-binding-owners', 'csub-driver',
            'pdef-owner-a', 'drev-owner-a', 'binding-owner-a', $1, $2
          )
        `,
        [catalogReleaseId, matcherRevision]
      )
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("parameter_observation_match_observation_fk");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.parameter_observation_matches where id = 'pmatch-cross-observation'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a ReviewEvidence reason outside the frozen S0-ID registry", async () => {
    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.parameter_review_evidence (
          id, organization_id, reason, candidate_safe_digest, evidence
        ) values (
          'prev-invalid-reason', 'org-pcat', 'legacy-review', 'sha256:candidate-safe', '{}'
        )
      `)
    );
    expect(error.code).toBe("23514");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.parameter_review_evidence where id = 'prev-invalid-reason'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a ReviewResolution Registration owned by another Organization", async () => {
    await seedTwoCanonicalBindings(client);
    await client.query(`
      insert into parameter_catalog.parameter_review_items (
        id, organization_id, evidence_fingerprint, matcher_revision,
        catalog_release_id, reason, status, etag_version
      ) values (
        'review-item-registration-owner', 'org-pcat-2', 'sha256:review-registration-owner',
        'matcher-registration-owner', 'crel-binding-owners', 'unknown', 'open', 1
      )
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.parameter_review_resolutions (
          id, review_item_id, resolution_type, before_etag_version, after_etag_version,
          accountable_principal_id, initiator_type, captured_catalog_release_id,
          request_fingerprint, registration_id, success_audit_ref
        ) values (
          'review-resolution-registration-owner', 'review-item-registration-owner',
          'register-subject', 1, 2, 'principal-registration-owner', 'user',
          'crel-binding-owners', 'sha256:request-registration-owner',
          'reg-binding-owners', 'audit-registration-owner'
        )
      `)
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("review_resolution_target_owner_fk");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.parameter_review_resolutions where id = 'review-resolution-registration-owner'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a ReviewResolution Proposal owned by another Organization", async () => {
    await seedLegacyMappingRoots(client);
    await client.query(`
      begin;
      insert into parameter_catalog.definition_proposals (
        id, organization_id, author_principal_id, base_catalog_release_id,
        status, current_proposal_revision_id, etag_version
      ) values (
        'proposal-review-owner', 'org-pcat', 'principal-proposal-owner', 'crel-legacy',
        'submitted', 'proposal-revision-review-owner', 1
      );
      insert into parameter_catalog.definition_proposal_revisions (
        id, proposal_id, revision_number, payload, reason, evidence_refs
      ) values (
        'proposal-revision-review-owner', 'proposal-review-owner', 1,
        '{}', 'review owner', '[]'
      );
      set constraints all immediate;
      commit;
      insert into parameter_catalog.parameter_review_items (
        id, organization_id, evidence_fingerprint, matcher_revision,
        catalog_release_id, reason, status, etag_version
      ) values (
        'review-item-proposal-owner', 'org-pcat-2', 'sha256:review-proposal-owner',
        'matcher-proposal-owner', 'crel-legacy', 'unknown', 'open', 1
      )
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.parameter_review_resolutions (
          id, review_item_id, resolution_type, before_etag_version, after_etag_version,
          accountable_principal_id, initiator_type, captured_catalog_release_id,
          request_fingerprint, proposal_id, success_audit_ref
        ) values (
          'review-resolution-proposal-owner', 'review-item-proposal-owner',
          'open-definition-proposal', 1, 2, 'principal-review-owner', 'user',
          'crel-legacy', 'sha256:request-proposal-owner',
          'proposal-review-owner', 'audit-proposal-owner'
        )
      `)
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("review_resolution_target_owner_fk");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.parameter_review_resolutions where id = 'review-resolution-proposal-owner'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a PublicationIntent whose base release differs from its Proposal", async () => {
    await seedLegacyMappingRoots(client);
    await client.query(`
      begin;
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-publication-other', 'publication-other', 'sha256:publication-other',
        'sha256:publication-other-compiled', 'sha256:publication-other-toolchain'
      );
      insert into parameter_catalog.definition_proposals (
        id, organization_id, author_principal_id, base_catalog_release_id,
        status, current_proposal_revision_id, etag_version
      ) values (
        'proposal-publication-base', 'org-pcat', 'principal-publication-base', 'crel-legacy',
        'accepted', 'proposal-revision-publication-base', 1
      );
      insert into parameter_catalog.definition_proposal_revisions (
        id, proposal_id, revision_number, payload, reason, evidence_refs
      ) values (
        'proposal-revision-publication-base', 'proposal-publication-base', 1,
        '{}', 'publication base', '[]'
      );
      set constraints all immediate;
      commit
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.catalog_publication_intents (
          id, proposal_id, proposal_revision_id, base_catalog_release_id,
          repository_reference, reviewer_principal_id, success_audit_ref
        ) values (
          'publication-intent-cross-base', 'proposal-publication-base',
          'proposal-revision-publication-base', 'crel-publication-other',
          'repo://publication-cross-base', 'principal-reviewer', 'audit-publication-cross-base'
        )
      `)
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("catalog_publication_intent_proposal_base_fk");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_publication_intents where id = 'publication-intent-cross-base'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects an Archive whose owner scope differs from its LegacyIdentity", async () => {
    await seedLegacyMappingRoots(client);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.parameter_catalog_archives (
          id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
          source_checksum, graph_checksum, encrypted_object_ref, protected_references,
          cutover_run_id, catalog_release_id, success_audit_ref, retain_until
        ) values (
          'archive-owner-mismatch', 'lid-a', 'organization', 'org-pcat-2', 'R6', 'review evidence',
          'sha256:source-a', 'sha256:graph-a', 'object://archive-a', '[]',
          'cutover-a', 'crel-legacy', 'audit-archive-a', now() + interval '90 days'
        )
      `)
    );
    expect(error.code).toBe("23503");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.parameter_catalog_archives where id = 'archive-owner-mismatch'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a LegacyIdentity source kind outside the frozen S0-ID registry", async () => {
    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_identities (
          id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
        ) values (
          'lid-invalid-source-kind', 'legacy', 'legacy-free-form', 'platform', 'platform', 'source-invalid'
        )
      `)
    );
    expect(error.code).toBe("23514");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.legacy_identities where id = 'lid-invalid-source-kind'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a MappingVersion that consumes another identity and run's Archive", async () => {
    await seedLegacyMappingRoots(client);
    await client.query(`
      insert into parameter_catalog.parameter_catalog_archives (
        id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
        source_checksum, graph_checksum, encrypted_object_ref, protected_references,
        cutover_run_id, catalog_release_id, success_audit_ref, retain_until
      ) values (
        'archive-b', 'lid-b', 'organization', 'org-pcat-2', 'R6', 'review evidence',
        'sha256:source-b', 'sha256:graph-b', 'object://archive-b', '[]',
        'cutover-b', 'crel-legacy', 'audit-archive-b', now() + interval '90 days'
      )
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_mapping_versions (
          id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
          graph_fingerprint, r_class, archive_id
        ) values (
          'lmap-cross-archive', 'lid-a', 'cutover-a', 1, 'sha256:source-a',
          'sha256:graph-a', 'R6', 'archive-b'
        )
      `)
    );
    expect(error.code).toBe("23503");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.legacy_mapping_versions where id = 'lmap-cross-archive'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a MappingVersion that supersedes a version from another CutoverRun", async () => {
    await seedLegacyMappingRoots(client);
    await client.query(`
      insert into parameter_catalog.parameter_catalog_archives (
        id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
        source_checksum, graph_checksum, encrypted_object_ref, protected_references,
        cutover_run_id, catalog_release_id, success_audit_ref, retain_until
      ) values
        (
          'archive-a-run-a', 'lid-a', 'organization', 'org-pcat', 'R6', 'run a',
          'sha256:source-a1', 'sha256:graph-a1', 'object://archive-a1', '[]',
          'cutover-a', 'crel-legacy', 'audit-archive-a1', now() + interval '90 days'
        ),
        (
          'archive-a-run-b', 'lid-a', 'organization', 'org-pcat', 'R6', 'run b',
          'sha256:source-a2', 'sha256:graph-a2', 'object://archive-a2', '[]',
          'cutover-b', 'crel-legacy', 'audit-archive-a2', now() + interval '90 days'
        );
      insert into parameter_catalog.legacy_mapping_versions (
        id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
        graph_fingerprint, r_class, archive_id
      ) values (
        'lmap-a-run-a', 'lid-a', 'cutover-a', 1, 'sha256:source-a1',
        'sha256:graph-a1', 'R6', 'archive-a-run-a'
      );
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_mapping_versions (
          id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
          graph_fingerprint, r_class, archive_id, supersedes_version_id
        ) values (
          'lmap-a-cross-run', 'lid-a', 'cutover-b', 2, 'sha256:source-a2',
          'sha256:graph-a2', 'R6', 'archive-a-run-b', 'lmap-a-run-a'
        )
      `)
    );
    expect(error.code).toBe("23503");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.legacy_mapping_versions where id = 'lmap-a-cross-run'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects Classification evidence backed by another identity and run's MappingVersion", async () => {
    await seedLegacyMappingRoots(client);
    await client.query(`
      insert into parameter_catalog.parameter_catalog_archives (
        id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
        source_checksum, graph_checksum, encrypted_object_ref, protected_references,
        cutover_run_id, catalog_release_id, success_audit_ref, retain_until
      ) values (
        'archive-class-a', 'lid-a', 'organization', 'org-pcat', 'R6', 'classification',
        'sha256:source-class-a', 'sha256:graph-class-a', 'object://archive-class-a', '[]',
        'cutover-a', 'crel-legacy', 'audit-class-a', now() + interval '90 days'
      );
      insert into parameter_catalog.legacy_mapping_versions (
        id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
        graph_fingerprint, r_class, archive_id
      ) values (
        'lmap-class-a', 'lid-a', 'cutover-a', 1, 'sha256:source-class-a',
        'sha256:graph-class-a', 'R6', 'archive-class-a'
      );
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.parameter_catalog_classification_ledger (
          cutover_run_id, legacy_identity_id, r_class, classifier_version,
          graph_fingerprint, disposition, mapping_version_id
        ) values (
          'cutover-b', 'lid-b', 'R6', 'classifier-v1',
          'sha256:graph-class-b', 'archived', 'lmap-class-a'
        )
      `)
    );
    expect(error.code).toBe("23503");

    const residue = await client.query<{ count: string }>(`
      select count(*)::text as count
      from parameter_catalog.parameter_catalog_classification_ledger
      where cutover_run_id = 'cutover-b' and legacy_identity_id = 'lid-b'
    `);
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a ComparisonResult MappingVersion from another CutoverRun", async () => {
    await seedLegacyMappingRoots(client);
    await client.query(`
      insert into parameter_catalog.parameter_catalog_archives (
        id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
        source_checksum, graph_checksum, encrypted_object_ref, protected_references,
        cutover_run_id, catalog_release_id, success_audit_ref, retain_until
      ) values (
        'archive-comparison-a', 'lid-a', 'organization', 'org-pcat', 'R6', 'comparison',
        'sha256:source-comparison-a', 'sha256:graph-comparison-a', 'object://archive-comparison-a', '[]',
        'cutover-a', 'crel-legacy', 'audit-comparison-a', now() + interval '90 days'
      );
      insert into parameter_catalog.legacy_mapping_versions (
        id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
        graph_fingerprint, r_class, archive_id
      ) values (
        'lmap-comparison-a', 'lid-a', 'cutover-a', 1, 'sha256:source-comparison-a',
        'sha256:graph-comparison-a', 'R6', 'archive-comparison-a'
      );
      insert into parameter_catalog.parameter_catalog_comparison_cases (
        id, cutover_run_id, gate_id, consumer_family, case_key, protected_reference
      ) values (
        'comparison-case-b', 'cutover-b', 'PCAT-CMP-D01', 'runtime', 'cross-run', false
      )
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.parameter_catalog_comparison_results (
          comparison_case_id, outcome, mapping_version_id, rule_id, evidence
        ) values (
          'comparison-case-b', 'declared-expected-difference',
          'lmap-comparison-a', 'rule-cross-run', '{}'
        )
      `)
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("comparison_result_mapping_run_fk");

    const residue = await client.query<{ count: string }>(`
      select count(*)::text as count
      from parameter_catalog.parameter_catalog_comparison_results
      where comparison_case_id = 'comparison-case-b'
    `);
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects MappingVersion evidence from another identity and run's Archive", async () => {
    await seedLegacyMappingRoots(client);
    await client.query(`
      insert into parameter_catalog.parameter_review_evidence (
        id, organization_id, reason, candidate_safe_digest, evidence
      ) values (
        'prev-evidence-a', 'org-pcat', 'unknown', 'sha256:candidate-evidence-a', '{}'
      );
      insert into parameter_catalog.parameter_catalog_archives (
        id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class, reason,
        source_checksum, graph_checksum, encrypted_object_ref, protected_references,
        cutover_run_id, catalog_release_id, success_audit_ref, retain_until
      ) values (
        'archive-evidence-b', 'lid-b', 'organization', 'org-pcat-2', 'R6', 'evidence',
        'sha256:source-evidence-b', 'sha256:graph-evidence-b', 'object://archive-evidence-b', '[]',
        'cutover-b', 'crel-legacy', 'audit-evidence-b', now() + interval '90 days'
      )
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_mapping_versions (
          id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
          graph_fingerprint, r_class, target_kind, target_id, evidence_archive_id
        ) values (
          'lmap-cross-evidence', 'lid-a', 'cutover-a', 1, 'sha256:source-a',
          'sha256:graph-a', 'R6', 'review-evidence', 'prev-evidence-a', 'archive-evidence-b'
        )
      `)
    );
    expect(error.code).toBe("23503");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.legacy_mapping_versions where id = 'lmap-cross-evidence'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a typed MappingVersion whose target does not exist", async () => {
    await seedLegacyMappingRoots(client);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_mapping_versions (
          id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
          graph_fingerprint, r_class, target_kind, target_id
        ) values (
          'lmap-missing-target', 'lid-a', 'cutover-a', 1, 'sha256:source-a',
          'sha256:graph-a', 'R8', 'definition-proposal', 'dprop-does-not-exist'
        )
      `)
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("legacy_mapping_target_fk");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.legacy_mapping_versions where id = 'lmap-missing-target'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects a parameter-spec identity mapped to BindingHistory", async () => {
    await seedLegacyMappingRoots(client);
    await seedTwoCanonicalBindings(client);
    await client.query(`
      insert into parameter_catalog.binding_history_events (
        id, binding_id, old_effective_revision_id, new_effective_revision_id,
        old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
      ) values (
        'bhist-incompatible-source', 'binding-owner-a', 'drev-owner-a', 'drev-owner-a',
        null, 'pvalue-owner-a', 'source compatibility', 'audit-bhist-compat', 'crel-binding-owners'
      )
    `);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_mapping_versions (
          id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
          graph_fingerprint, r_class, target_kind, target_id
        ) values (
          'lmap-incompatible-source', 'lid-a', 'cutover-a', 1, 'sha256:source-incompatible',
          'sha256:graph-incompatible', 'R9', 'binding-history-event', 'bhist-incompatible-source'
        )
      `)
    );
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("legacy_mapping_source_target_ck");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.legacy_mapping_versions where id = 'lmap-incompatible-source'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("accepts existing BindingHistory and ProposalRevision typed mapping targets", async () => {
    await seedLegacyMappingRoots(client);
    await seedTwoCanonicalBindings(client);
    await client.query(`
      begin;
      insert into parameter_catalog.binding_history_events (
        id, binding_id, old_effective_revision_id, new_effective_revision_id,
        old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
      ) values (
        'bhist-map-target', 'binding-owner-a', 'drev-owner-a', 'drev-owner-a',
        null, 'pvalue-owner-a', 'initial mapping', 'audit-bhist-map', 'crel-binding-owners'
      );
      insert into parameter_catalog.definition_proposals (
        id, organization_id, author_principal_id, base_catalog_release_id,
        status, current_proposal_revision_id, etag_version
      ) values (
        'dprop-map-target', 'org-pcat-2', 'principal-proposer', 'crel-legacy',
        'draft', 'dprev-map-target', 1
      );
      insert into parameter_catalog.definition_proposal_revisions (
        id, proposal_id, revision_number, payload, reason, evidence_refs
      ) values (
        'dprev-map-target', 'dprop-map-target', 1, '{}', 'initial proposal', '[]'
      );
      insert into parameter_catalog.legacy_identities (
        id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
      ) values
        (
          'lid-bhist-target', 'legacy', 'project-parameter-binding-revision',
          'project', 'project-pcat', 'source-bhist-target'
        ),
        (
          'lid-dprev-target', 'legacy', 'parameter-spec-version',
          'organization', 'org-pcat-2', 'source-dprev-target'
        );
      set constraints all immediate;
      commit;
      insert into parameter_catalog.legacy_mapping_versions (
        id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
        graph_fingerprint, r_class, target_kind, target_id
      ) values
        (
          'lmap-bhist-target', 'lid-bhist-target', 'cutover-a', 1, 'sha256:source-bhist',
          'sha256:graph-bhist', 'R9', 'binding-history-event', 'bhist-map-target'
        ),
        (
          'lmap-dprev-target', 'lid-dprev-target', 'cutover-b', 1, 'sha256:source-dprev',
          'sha256:graph-dprev', 'R9', 'definition-proposal-revision', 'dprev-map-target'
        );
    `);

    const result = await client.query<{ target_kind: string; target_id: string }>(`
      select target_kind, target_id
      from parameter_catalog.legacy_mapping_versions
      where id in ('lmap-bhist-target', 'lmap-dprev-target')
      order by id
    `);
    expect(result.rows).toEqual([
      { target_kind: "binding-history-event", target_id: "bhist-map-target" },
      { target_kind: "definition-proposal-revision", target_id: "dprev-map-target" }
    ]);
  });

  it.each([
    {
      name: "Platform Definition",
      legacyIdentityId: "lid-a",
      targetKind: "parameter-definition",
      targetId: "pdef-owner-a"
    },
    {
      name: "Organization Registration",
      legacyIdentityId: "lid-subject-org-two",
      targetKind: "subject-registration",
      targetId: "reg-binding-owners"
    },
    {
      name: "Organization Placement",
      legacyIdentityId: "lid-placement-org-two",
      targetKind: "subject-placement",
      targetId: "placement-binding-owners"
    },
    {
      name: "Project Binding",
      legacyIdentityId: "lid-binding-project-two",
      targetKind: "parameter-binding",
      targetId: "binding-owner-a"
    },
    {
      name: "ProjectValue",
      legacyIdentityId: "lid-binding-revision-project-two",
      targetKind: "project-value",
      targetId: "pvalue-owner-a"
    },
    {
      name: "BindingHistory",
      legacyIdentityId: "lid-binding-revision-project-two",
      targetKind: "binding-history-event",
      targetId: "bhist-owner-target"
    },
    {
      name: "ReviewEvidence",
      legacyIdentityId: "lid-b",
      targetKind: "review-evidence",
      targetId: "prev-owner-target"
    },
    {
      name: "DefinitionProposal",
      legacyIdentityId: "lid-b",
      targetKind: "definition-proposal",
      targetId: "dprop-owner-target"
    }
  ])("rejects $name mapped from another owner scope", async ({
    legacyIdentityId,
    targetKind,
    targetId
  }) => {
    await seedLegacyOwnershipTargets(client);
    const error = await captureDatabaseError(
      client.query(
        `
        insert into parameter_catalog.legacy_mapping_versions (
          id, legacy_identity_id, cutover_run_id, version_number, source_checksum,
          graph_fingerprint, r_class, target_kind, target_id
        ) values (
          'lmap-cross-owner', $1, 'cutover-a', 1,
          'sha256:source-cross-owner', 'sha256:graph-cross-owner',
          'R9', $2, $3
        )
      `,
        [legacyIdentityId, targetKind, targetId]
      )
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("legacy_mapping_target_owner_fk");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.legacy_mapping_versions where id = 'lmap-cross-owner'"
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("rejects BindingHistory revision and value pointers owned by another Binding", async () => {
    await seedTwoCanonicalBindings(client);

    const error = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.binding_history_events (
          id, binding_id, old_effective_revision_id, new_effective_revision_id,
          old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
        ) values (
          'bhist-cross-owner', 'binding-owner-a', 'drev-owner-a', 'drev-owner-b',
          'pvalue-owner-a', 'pvalue-owner-b', 'semantic cutover', 'audit-bhist', 'crel-binding-owners'
        )
      `)
    );
    expect(error.code).toBe("23503");
    expect(error.constraint).toBe("binding_history_event_owner_fk");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.binding_history_events where id = 'bhist-cross-owner'"
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
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
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

  it.each([
    {
      name: "two-node",
      valuesSql: `
        ('crel-cycle-two-a', 'cycle-two-a', 'sha256:cycle-two-a', 'crel-cycle-two-b', 'sha256:cycle-two-a-compiled', 'sha256:cycle-two-a-toolchain'),
        ('crel-cycle-two-b', 'cycle-two-b', 'sha256:cycle-two-b', 'crel-cycle-two-a', 'sha256:cycle-two-b-compiled', 'sha256:cycle-two-b-toolchain')
      `,
      ids: ["crel-cycle-two-a", "crel-cycle-two-b"]
    },
    {
      name: "long",
      valuesSql: `
        ('crel-cycle-long-a', 'cycle-long-a', 'sha256:cycle-long-a', 'crel-cycle-long-b', 'sha256:cycle-long-a-compiled', 'sha256:cycle-long-a-toolchain'),
        ('crel-cycle-long-b', 'cycle-long-b', 'sha256:cycle-long-b', 'crel-cycle-long-c', 'sha256:cycle-long-b-compiled', 'sha256:cycle-long-b-toolchain'),
        ('crel-cycle-long-c', 'cycle-long-c', 'sha256:cycle-long-c', 'crel-cycle-long-a', 'sha256:cycle-long-c-compiled', 'sha256:cycle-long-c-toolchain')
      `,
      ids: ["crel-cycle-long-a", "crel-cycle-long-b", "crel-cycle-long-c"]
    }
  ])("rejects a $name Catalog release predecessor cycle", async ({ valuesSql, ids }) => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, predecessor_release_id,
        compiled_model_digest, toolchain_digest
      ) values ${valuesSql}
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_release_predecessor_acyclic_ck");
    await client.query("rollback");

    const residue = await client.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.catalog_releases where id = any($1::text[])",
      [ids]
    );
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
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
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
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ state: string; release: string }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_state) as state,
        (select count(*)::text from parameter_catalog.catalog_releases where id = 'crel-retired-alias') as release
    `);
    expect(residue.rows).toEqual([{ state: "0", release: "0" }]);
  });

  it("rejects a current release whose alias selector kind disagrees with its Subject kind", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_subject_aliases (
        id, subject_id, selector_kind, normalized_selector
      ) values ('calias-kind-mismatch', 'csub-driver', 'node-type-name', 'node-type-kind-mismatch');
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-alias-kind-mismatch', 'alias-kind-mismatch', 'sha256:alias-kind-mismatch',
        'sha256:alias-kind-mismatch-compiled', 'sha256:alias-kind-mismatch-toolchain'
      );
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-alias-kind-mismatch', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.catalog_release_subject_aliases (
        release_id, subject_id, alias_id, lifecycle, selector_provenance
      ) values (
        'crel-alias-kind-mismatch', 'csub-driver', 'calias-kind-mismatch', 'active', '{}'
      );
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values (
        'crel-alias-kind-mismatch', 'sha256:alias-kind-mismatch-compiled-fp',
        'sha256:alias-kind-mismatch-database-fp', 'alias-kind-mismatch-attempt',
        'alias-kind-mismatch-audit'
      );
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-alias-kind-mismatch')
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ state: string; release: string }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_state) as state,
        (select count(*)::text from parameter_catalog.catalog_releases where id = 'crel-alias-kind-mismatch') as release
    `);
    expect(residue.rows).toEqual([{ state: "0", release: "0" }]);
  });

  it("rejects a current release whose alias collides with another Subject's canonical selector", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_subjects (id, kind, canonical_key)
      values ('csub-canonical-owner', 'driver', 'driver:canonical-collision');
      insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
      values ('csub-canonical-owner', 'logical-service', 'singleton-per-project');
      insert into parameter_catalog.catalog_subject_aliases (
        id, subject_id, selector_kind, normalized_selector
      ) values (
        'calias-canonical-collision', 'csub-driver', 'driver-compatible',
        'driver:canonical-collision'
      );
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-canonical-collision', 'canonical-collision', 'sha256:canonical-collision',
        'sha256:canonical-collision-compiled', 'sha256:canonical-collision-toolchain'
      );
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values
        ('crel-canonical-collision', 'csub-driver', 'active', '{}', '{}'),
        ('crel-canonical-collision', 'csub-canonical-owner', 'active', '{}', '{}');
      insert into parameter_catalog.catalog_release_subject_aliases (
        release_id, subject_id, alias_id, lifecycle, selector_provenance
      ) values (
        'crel-canonical-collision', 'csub-driver', 'calias-canonical-collision', 'active', '{}'
      );
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values (
        'crel-canonical-collision', 'sha256:canonical-collision-compiled-fp',
        'sha256:canonical-collision-database-fp', 'canonical-collision-attempt',
        'canonical-collision-audit'
      );
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-canonical-collision')
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ state: string; aliases: string }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_state) as state,
        (select count(*)::text from parameter_catalog.catalog_subject_aliases where id = 'calias-canonical-collision') as aliases
    `);
    expect(residue.rows).toEqual([{ state: "0", aliases: "0" }]);
  });

  it("rejects a current release whose alias duplicates its own Subject canonical selector", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_subject_aliases (
        id, subject_id, selector_kind, normalized_selector
      ) values ('calias-canonical-duplicate', 'csub-driver', 'driver-compatible', 'driver:test');
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-canonical-duplicate', 'canonical-duplicate', 'sha256:canonical-duplicate',
        'sha256:canonical-duplicate-compiled', 'sha256:canonical-duplicate-toolchain'
      );
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-canonical-duplicate', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.catalog_release_subject_aliases (
        release_id, subject_id, alias_id, lifecycle, selector_provenance
      ) values (
        'crel-canonical-duplicate', 'csub-driver', 'calias-canonical-duplicate', 'active', '{}'
      );
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values (
        'crel-canonical-duplicate', 'sha256:canonical-duplicate-compiled-fp',
        'sha256:canonical-duplicate-database-fp', 'canonical-duplicate-attempt',
        'canonical-duplicate-audit'
      );
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-canonical-duplicate')
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ state: string; aliases: string }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_state) as state,
        (select count(*)::text from parameter_catalog.catalog_subject_aliases where id = 'calias-canonical-duplicate') as aliases
    `);
    expect(residue.rows).toEqual([{ state: "0", aliases: "0" }]);
  });

  it.each([
    {
      name: "missing",
      headSql: "select 1",
      expectedConstraint: "catalog_materialization_projection_complete_ck"
    },
    {
      name: "split",
      expectedConstraint: "catalog_current_definition_head_ck",
      headSql: `
        insert into parameter_catalog.catalog_release_definition_heads (
          release_id, definition_id, revision_id
        ) values ('crel-head', 'pdef-head', 'drev-head-other')
      `
    }
  ])("rejects a current release with $name Definition heads", async ({ headSql, expectedConstraint }) => {
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
    `);
    await client.query(headSql);
    await client.query(`
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-head', 'sha256:head-compiled-fp', 'sha256:head-database-fp', 'head-attempt', 'head-audit');
      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-head')
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe(expectedConstraint);
    await client.query("rollback");

    const residue = await client.query<{ definitions: string; state: string }>(`
      select
        (select count(*)::text from parameter_catalog.parameter_definitions where id = 'pdef-head') as definitions,
        (select count(*)::text from parameter_catalog.catalog_state) as state
    `);
    expect(residue.rows).toEqual([{ definitions: "0", state: "0" }]);
  });

  it("rejects materialization evidence for an empty Catalog release projection", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-empty-materialization', 'empty-materialization', 'sha256:empty-materialization',
        'sha256:empty-materialization-compiled', 'sha256:empty-materialization-toolchain'
      );
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values (
        'crel-empty-materialization', 'sha256:empty-materialization-compiled-fp',
        'sha256:empty-materialization-database-fp', 'empty-materialization-attempt',
        'empty-materialization-audit'
      )
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ releases: string; materializations: string }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_releases where id = 'crel-empty-materialization') as releases,
        (select count(*)::text from parameter_catalog.catalog_materializations where release_id = 'crel-empty-materialization') as materializations
    `);
    expect(residue.rows).toEqual([{ releases: "0", materializations: "0" }]);
  });

  it("rejects materialization evidence when a projected Definition has no release head", async () => {
    await client.query("begin");
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-headless-materialization', 'headless-materialization', 'sha256:headless-materialization',
        'sha256:headless-materialization-compiled', 'sha256:headless-materialization-toolchain'
      );
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-headless-materialization', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.parameter_definitions (
        id, subject_id, property_key, current_revision_id
      ) values ('pdef-headless-materialization', 'csub-driver', 'headless-property', 'drev-headless-materialization');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values (
        'drev-headless-materialization', 'pdef-headless-materialization', 1,
        'crel-headless-materialization', 'sha256:drev-headless-materialization', '{}'
      );
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values (
        'crel-headless-materialization', 'sha256:headless-materialization-compiled-fp',
        'sha256:headless-materialization-database-fp', 'headless-materialization-attempt',
        'headless-materialization-audit'
      )
    `);

    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("catalog_materialization_projection_complete_ck");
    await client.query("rollback");

    const residue = await client.query<{ definitions: string; materializations: string }>(`
      select
        (select count(*)::text from parameter_catalog.parameter_definitions where id = 'pdef-headless-materialization') as definitions,
        (select count(*)::text from parameter_catalog.catalog_materializations where release_id = 'crel-headless-materialization') as materializations
    `);
    expect(residue.rows).toEqual([{ definitions: "0", materializations: "0" }]);
  });

  it("allows a complete Catalog projection to be staged after deferred materialization evidence", async () => {
    await client.query(`
      begin;
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values (
        'crel-deferred-materialization', 'deferred-materialization', 'sha256:deferred-materialization',
        'sha256:deferred-materialization-compiled', 'sha256:deferred-materialization-toolchain'
      );
      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values (
        'crel-deferred-materialization', 'sha256:deferred-materialization-compiled-fp',
        'sha256:deferred-materialization-database-fp', 'deferred-materialization-attempt',
        'deferred-materialization-audit'
      );
      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-deferred-materialization', 'csub-driver', 'active', '{}', '{}');
      insert into parameter_catalog.parameter_definitions (
        id, subject_id, property_key, current_revision_id
      ) values ('pdef-deferred-materialization', 'csub-driver', 'deferred-property', 'drev-deferred-materialization');
      insert into parameter_catalog.definition_revisions (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values (
        'drev-deferred-materialization', 'pdef-deferred-materialization', 1,
        'crel-deferred-materialization', 'sha256:drev-deferred-materialization', '{}'
      );
      insert into parameter_catalog.catalog_release_definition_heads (
        release_id, definition_id, revision_id
      ) values (
        'crel-deferred-materialization', 'pdef-deferred-materialization',
        'drev-deferred-materialization'
      );
      set constraints all immediate;
      commit
    `);

    const projection = await client.query<{
      memberships: string;
      heads: string;
      materializations: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_release_subjects where release_id = 'crel-deferred-materialization') as memberships,
        (select count(*)::text from parameter_catalog.catalog_release_definition_heads where release_id = 'crel-deferred-materialization') as heads,
        (select count(*)::text from parameter_catalog.catalog_materializations where release_id = 'crel-deferred-materialization') as materializations
    `);
    expect(projection.rows).toEqual([{
      memberships: "1",
      heads: "1",
      materializations: "1"
    }]);
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

  it("rejects a parameter module kind update that would invalidate its retained Placement", async () => {
    await client.query(`
      begin;
      insert into parameter_catalog.organization_subject_registrations (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values (
        'reg-module-kind', 'org-pcat', 'csub-driver', 'active', 'explicit', '{}', 'placement-module-kind'
      );
      insert into parameter_catalog.subject_placements (
        id, registration_id, organization_id, module_id, origin
      ) values (
        'placement-module-kind', 'reg-module-kind', 'org-pcat', 'pmod-driver', 'curated'
      );
      set constraints all immediate;
      commit;
    `);

    await client.query("begin");
    await client.query(
      "update public.parameter_modules set kind = 'node-type' where id = 'pmod-driver'"
    );
    const error = await captureDatabaseError(client.query("set constraints all immediate"));
    expect(error.code).toBe("23514");
    expect(error.constraint).toBe("subject_placement_kind_ck");
    await client.query("rollback");

    const module = await client.query<{ kind: string }>(
      "select kind from public.parameter_modules where id = 'pmod-driver'"
    );
    expect(module.rows[0]?.kind).toBe("driver-group");
  });

  it("serializes a Placement insert against a concurrent parameter module kind update", async () => {
    const updater = await connect(database.url);
    try {
      await client.query("begin");
      await client.query(`
        insert into parameter_catalog.organization_subject_registrations (
          id, organization_id, subject_id, status, registration_method, proof, current_placement_id
        ) values (
          'reg-module-race', 'org-pcat', 'csub-driver', 'active', 'explicit', '{}', 'placement-module-race'
        );
        insert into parameter_catalog.subject_placements (
          id, registration_id, organization_id, module_id, origin
        ) values (
          'placement-module-race', 'reg-module-race', 'org-pcat', 'pmod-driver', 'curated'
        );
      `);

      await updater.query("begin");
      const updateAttempt = updater
        .query("update public.parameter_modules set kind = 'node-type' where id = 'pmod-driver'")
        .then(
          (result) => ({ result, error: null }),
          (error: pg.DatabaseError) => ({ result: null, error })
        );
      await waitForDatabaseLock(client, updater.processID);

      await client.query("set constraints all immediate");
      await client.query("commit");

      await expect(updateAttempt).resolves.toMatchObject({ result: { rowCount: 1 }, error: null });
      const error = await captureDatabaseError(updater.query("set constraints all immediate"));
      expect(error.code).toBe("23514");
      expect(error.constraint).toBe("subject_placement_kind_ck");
      await updater.query("rollback");

      const state = await client.query<{ placements: string; module_kind: string }>(`
        select
          (select count(*)::text from parameter_catalog.subject_placements where id = 'placement-module-race') as placements,
          (select kind from public.parameter_modules where id = 'pmod-driver') as module_kind
      `);
      expect(state.rows).toEqual([{ placements: "1", module_kind: "driver-group" }]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await updater.query("rollback").catch(() => undefined);
      await updater.end();
    }
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

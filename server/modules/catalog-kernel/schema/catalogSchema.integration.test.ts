import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import {
  legacyLookupIdentifierTypes,
  legacyMappingSourceKinds,
  serializeContract,
} from "../../parameter-catalog-contract";

const databaseAvailable = await isTestDatabaseAvailable();

if (!databaseAvailable) {
  throw new Error(
    "S2-SCH requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

async function captureDatabaseError(
  action: Promise<unknown>,
): Promise<pg.DatabaseError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(pg.DatabaseError);
    return error as pg.DatabaseError;
  }
  throw new Error("Expected PostgreSQL to reject the operation");
}

describe("canonical parameter Catalog schema", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("pcatschema");
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await database?.drop();
  });

  it("materializes the canonical Platform Catalog relations on a fresh database", async () => {
    const result = await client.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'parameter_catalog'
         and table_name = any($1::text[])
         and table_type = 'BASE TABLE'
       order by table_name`,
      [
        [
          "catalog_drivers",
          "catalog_materializations",
          "catalog_node_types",
          "catalog_release_definition_heads",
          "catalog_release_subject_aliases",
          "catalog_release_subjects",
          "catalog_releases",
          "catalog_state",
          "catalog_subject_aliases",
          "catalog_subjects",
          "definition_revisions",
          "parameter_definitions",
        ],
      ],
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "catalog_drivers",
      "catalog_materializations",
      "catalog_node_types",
      "catalog_release_definition_heads",
      "catalog_release_subject_aliases",
      "catalog_release_subjects",
      "catalog_releases",
      "catalog_state",
      "catalog_subject_aliases",
      "catalog_subjects",
      "definition_revisions",
      "parameter_definitions",
    ]);
  });

  it("materializes the canonical Organization governance relations on a fresh database", async () => {
    const result = await client.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'parameter_catalog'
         and table_name = any($1::text[])
       order by table_name`,
      [
        [
          "catalog_publication_intents",
          "definition_proposal_revisions",
          "definition_proposals",
          "governance_command_idempotency",
          "organization_subject_registrations",
          "parameter_observation_matches",
          "parameter_observations",
          "parameter_review_evidence",
          "parameter_review_items",
          "parameter_review_resolutions",
          "subject_placements",
        ],
      ],
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "catalog_publication_intents",
      "definition_proposal_revisions",
      "definition_proposals",
      "governance_command_idempotency",
      "organization_subject_registrations",
      "parameter_observation_matches",
      "parameter_observations",
      "parameter_review_evidence",
      "parameter_review_items",
      "parameter_review_resolutions",
      "subject_placements",
    ]);
  });

  it("materializes canonical Binding, legacy-evidence, and cutover persistence on a fresh database", async () => {
    const expected = [
      "binding_history_events",
      "catalog_command_idempotency",
      "legacy_identities",
      "legacy_mapping_heads",
      "legacy_mapping_versions",
      "parameter_catalog_archives",
      "parameter_catalog_classification_ledger",
      "parameter_catalog_comparison_cases",
      "parameter_catalog_comparison_results",
      "parameter_catalog_cutover_checkpoints",
      "parameter_catalog_cutover_events",
      "parameter_catalog_cutover_runs",
      "project_parameter_bindings",
      "project_parameter_values",
    ];
    const result = await client.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'parameter_catalog'
         and table_name = any($1::text[])
       order by table_name`,
      [expected],
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(expected);
  });

  it("materializes exactly the frozen 37 canonical relations", async () => {
    const expected = [
      "binding_history_events",
      "catalog_command_idempotency",
      "catalog_drivers",
      "catalog_materializations",
      "catalog_node_types",
      "catalog_publication_intents",
      "catalog_release_definition_heads",
      "catalog_release_subject_aliases",
      "catalog_release_subjects",
      "catalog_releases",
      "catalog_state",
      "catalog_subject_aliases",
      "catalog_subjects",
      "definition_proposal_revisions",
      "definition_proposals",
      "definition_revisions",
      "governance_command_idempotency",
      "legacy_identities",
      "legacy_mapping_heads",
      "legacy_mapping_versions",
      "organization_subject_registrations",
      "parameter_catalog_archives",
      "parameter_catalog_classification_ledger",
      "parameter_catalog_comparison_cases",
      "parameter_catalog_comparison_results",
      "parameter_catalog_cutover_checkpoints",
      "parameter_catalog_cutover_events",
      "parameter_catalog_cutover_runs",
      "parameter_definitions",
      "parameter_observation_matches",
      "parameter_observations",
      "parameter_review_evidence",
      "parameter_review_items",
      "parameter_review_resolutions",
      "project_parameter_bindings",
      "project_parameter_values",
      "subject_placements",
    ];
    const result = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'parameter_catalog'
        and table_type = 'BASE TABLE'
      order by table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual(expected);
  });

  it("stores NodeType identity without a family column", async () => {
    const result = await client.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'parameter_catalog'
        and table_name = 'catalog_node_types'
      order by ordinal_position
    `);

    expect(result.rows.map((row) => row.column_name)).toEqual(["subject_id"]);
  });

  it("keeps the seven public lookup kinds separate from all 49 internal ledger kinds", async () => {
    expect(legacyLookupIdentifierTypes).toHaveLength(7);
    expect(legacyMappingSourceKinds).toHaveLength(49);
    expect(legacyMappingSourceKinds).not.toEqual(legacyLookupIdentifierTypes);

    const stored = await client.query<{ source_kind: string }>(`
      select source_kind
      from parameter_catalog.legacy_identity_source_registry()
      order by source_kind
    `);
    expect(stored.rows.map((row) => row.source_kind)).toEqual(
      [...legacyMappingSourceKinds].sort(),
    );

    const error = await captureDatabaseError(
      client.query(
        `insert into parameter_catalog.legacy_identities (
         id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
       ) values ('legacy-kind-invalid', 'legacy', 'legacy-identifier', 'platform', 'platform', 'invalid')`,
      ),
    );
    expect(error.code).toBe("23514");
  });

  it("publishes one fixed physical source and owner extractor for every internal legacy kind", async () => {
    const result = await client.query<{
      source_kind: string;
      mapping_class: string;
      source_relation: string | null;
      primary_key_fields: string[];
      owner_extractor: string;
      archive_only: boolean;
    }>(`
      select
        source_kind,
        mapping_class,
        source_relation,
        primary_key_fields,
        owner_extractor,
        archive_only
      from parameter_catalog.legacy_identity_source_registry()
      order by source_kind
    `);

    expect(result.rows).toHaveLength(49);
    expect(result.rows.map((row) => row.source_kind)).toEqual(
      [...legacyMappingSourceKinds].sort(),
    );
    expect(new Set(result.rows.map((row) => row.mapping_class))).toHaveLength(
      11,
    );
    for (const row of result.rows) {
      expect(row.owner_extractor).not.toBe("");
      expect(row.primary_key_fields.length).toBeGreaterThan(0);
      if (row.source_kind === "unresolved-protected-reference") {
        expect(row.source_relation).toBeNull();
        expect(row.primary_key_fields).toEqual([
          "consumerTable",
          "consumerPrimaryKey",
          "column",
          "rawReferencedId",
        ]);
        expect(row.archive_only).toBe(true);
      } else {
        expect(row.source_relation).toMatch(/^public\.[a-z0-9_]+$/);
        expect(row.archive_only).toBe(false);
      }
    }

    expect(
      result.rows.find((row) => row.source_kind === "audit-subject-link"),
    ).toMatchObject({
      source_relation: "public.audit_subject_links",
      primary_key_fields: ["auditEventId", "subjectKind", "semanticId"],
      owner_extractor: "audit-event-project-or-organization",
    });

    const missingAuditSource = serializeContract({
      auditEventId: "missing-audit",
      semanticId: "missing-semantic",
      subjectKind: "parameter-spec",
    });
    const missingProtectedSource = serializeContract({
      column: "parameter_spec_id",
      consumerPrimaryKey: "missing-parameter-spec",
      consumerTable: "public.parameter_specs",
      rawReferencedId: "missing-reference",
    });
    for (const sourceKind of legacyMappingSourceKinds) {
      const sourceId =
        sourceKind === "audit-subject-link"
          ? missingAuditSource
          : sourceKind === "unresolved-protected-reference"
            ? missingProtectedSource
            : `missing-${sourceKind}`;
      const resolved = await client.query(
        `select *
         from parameter_catalog.resolve_legacy_identity_owner($1, $2)`,
        [sourceKind, sourceId],
      );
      expect(resolved.rows, sourceKind).toEqual([]);
    }
  });

  it("derives a legacy identity owner from its fixed physical source and rejects caller disagreement", async () => {
    await client.query(`
      insert into public.organizations (id, name)
      values ('org-legacy-registry', 'Legacy registry');
      insert into public.parameter_specs (
        id, organization_id, source_kind, specification_key, definition_lifecycle
      ) values (
        'pspec-legacy-registry', 'org-legacy-registry', 'manual',
        'legacy-registry', 'active'
      );
      insert into parameter_catalog.legacy_identities (
        id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
      ) values (
        'lid-derived-owner', 'wiseeff-v1', 'parameter-spec',
        'organization', 'org-legacy-registry', 'pspec-legacy-registry'
      );
    `);

    const stored = await client.query<{
      owner_scope_kind: string;
      owner_scope_id: string;
    }>(`
      select owner_scope_kind, owner_scope_id
      from parameter_catalog.legacy_identities
      where id = 'lid-derived-owner'
    `);
    expect(stored.rows).toEqual([
      {
        owner_scope_kind: "organization",
        owner_scope_id: "org-legacy-registry",
      },
    ]);

    const mismatch = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_identities (
          id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
        ) values (
          'lid-forged-owner', 'wiseeff-v1', 'parameter-spec',
          'organization', 'another-org', 'pspec-legacy-registry'
        )
      `),
    );
    expect(mismatch.code).toBe("23503");
    expect(mismatch.constraint).toBe("legacy_identity_source_owner_fk");

    const missing = await captureDatabaseError(
      client.query(`
        insert into parameter_catalog.legacy_identities (
          id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
        ) values (
          'lid-missing-source', 'wiseeff-v1', 'parameter-spec',
          'platform', 'platform', 'pspec-does-not-exist'
        )
      `),
    );
    expect(missing.code).toBe("23503");
    expect(missing.constraint).toBe("legacy_identity_source_fk");
  });

  it("derives all eleven mapping-class owners and permits only typed targets or Archive", async () => {
    await client.query(`
      insert into public.organizations (id, name)
      values ('org-legacy-registry', 'Legacy registry')
      on conflict (id) do nothing;
      insert into public.projects (id, organization_id, name, code)
      values ('project-legacy-registry', 'org-legacy-registry', 'Legacy project', 'LEGACY');
      insert into public.attribution_subjects (
        id, organization_id, subject_kind, display_name, source_key
      ) values (
        'subject-legacy-class', 'org-legacy-registry', 'driver-registration',
        'Legacy subject', 'compatible:legacy,class'
      );
      insert into public.parameter_modules (
        id, organization_id, name, path, depth, kind, origin, attribution_subject_id
      ) values (
        'module-legacy-class', 'org-legacy-registry', 'Legacy module',
        'legacy/module', 1, 'driver-group', 'curated', 'subject-legacy-class'
      );
      insert into public.parameter_specs (
        id, organization_id, source_kind, specification_key, definition_lifecycle
      ) values (
        'pspec-legacy-class', 'org-legacy-registry', 'manual',
        'legacy-class', 'draft'
      );
      insert into public.driver_schema_overlays (
        id, organization_id, compatible, display_name, lifecycle
      ) values (
        'overlay-legacy-class', 'org-legacy-registry', 'legacy,class',
        'Legacy overlay', 'draft'
      );
      insert into public.dts_config_set (
        id, organization_id, project_id, name
      ) values (
        'config-set-legacy-class', 'org-legacy-registry',
        'project-legacy-registry', 'Legacy config'
      );
      insert into public.dts_config_revisions (
        id, organization_id, project_id, config_set_id, revision_number, status
      ) values (
        'config-revision-legacy-class', 'org-legacy-registry',
        'project-legacy-registry', 'config-set-legacy-class', 1, 'draft'
      );
      insert into public.project_parameter_bindings (
        id, organization_id, project_id, parameter_spec_id, module_id
      ) values (
        'binding-legacy-class', 'org-legacy-registry', 'project-legacy-registry',
        'pspec-legacy-class', 'module-legacy-class'
      );
      insert into public.parameter_definitions (
        id, organization_id, name, description, explanation, config_format,
        module, default_range, unit, risk
      ) values (
        'flat-definition-legacy-class', 'org-legacy-registry', 'Legacy',
        'Legacy', 'Legacy', 'text', 'Legacy', 'all', 'none', 'Low'
      );
      insert into public.parameter_spec_review_tasks (
        id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
        project_count, status
      ) values (
        'review-task-legacy-class', 'org-legacy-registry', 'pspec-legacy-class',
        '{}', '[]', 0, 'open'
      );
      insert into public.parameter_import_batches (
        id, organization_id, project_id, source_name, status, summary, items
      ) values (
        'import-batch-legacy-class', 'org-legacy-registry', 'project-legacy-registry',
        'legacy.csv', 'pending', '{}', '[]'
      );
      insert into public.parameter_identity_migration_runs (
        id, mode, status, report
      ) values (
        'identity-run-legacy-class', 'dry-run', 'completed', '{}'
      );
      insert into public.audit_events (
        id, organization_id, project_id, actor_type, app, kind, action,
        severity, metadata, trace_id
      ) values (
        'audit-legacy-class', 'org-legacy-registry', 'project-legacy-registry',
        'system', 'catalog-cutover', 'migration', 'classify', 'info', '{}',
        'trace-legacy-class'
      );
      insert into public.audit_subject_links (
        audit_event_id, subject_kind, semantic_id
      ) values (
        'audit-legacy-class', 'parameter-spec', 'pspec-legacy-class'
      );
    `);

    const auditSourceId = serializeContract({
      auditEventId: "audit-legacy-class",
      semanticId: "pspec-legacy-class",
      subjectKind: "parameter-spec",
    });
    const unresolvedSourceId = serializeContract({
      column: "parameter_spec_id",
      consumerPrimaryKey: "pspec-legacy-class",
      consumerTable: "public.parameter_specs",
      rawReferencedId: "missing-parameter-spec",
    });
    const sources = [
      [
        "formal-definition",
        "parameter-spec",
        "pspec-legacy-class",
        "organization",
        "org-legacy-registry",
      ],
      [
        "formal-subject",
        "parameter-subject",
        "subject-legacy-class",
        "organization",
        "org-legacy-registry",
      ],
      [
        "module-placement",
        "parameter-module",
        "module-legacy-class",
        "organization",
        "org-legacy-registry",
      ],
      [
        "overlay-publication",
        "driver-schema-overlay",
        "overlay-legacy-class",
        "organization",
        "org-legacy-registry",
      ],
      [
        "observation-match",
        "dts-config-revision",
        "config-revision-legacy-class",
        "project",
        "project-legacy-registry",
      ],
      [
        "binding-value",
        "project-parameter-binding",
        "binding-legacy-class",
        "project",
        "project-legacy-registry",
      ],
      [
        "legacy-semantic-store",
        "legacy-flat-parameter-definition",
        "flat-definition-legacy-class",
        "organization",
        "org-legacy-registry",
      ],
      [
        "draft-review",
        "parameter-spec-review-task",
        "review-task-legacy-class",
        "organization",
        "org-legacy-registry",
      ],
      [
        "file-import-initialization",
        "parameter-import-batch",
        "import-batch-legacy-class",
        "project",
        "project-legacy-registry",
      ],
      [
        "migration-history",
        "parameter-identity-migration-run",
        "identity-run-legacy-class",
        "platform",
        "platform",
      ],
      [
        "policy-audit-protected",
        "audit-subject-link",
        auditSourceId,
        "project",
        "project-legacy-registry",
      ],
      [
        "policy-audit-protected-unresolved",
        "unresolved-protected-reference",
        unresolvedSourceId,
        "organization",
        "org-legacy-registry",
      ],
    ] as const;

    for (const [
      mappingClass,
      sourceKind,
      sourceId,
      ownerKind,
      ownerId,
    ] of sources) {
      await client.query(
        `insert into parameter_catalog.legacy_identities (
           id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
         ) values ($1, 'wiseeff-v1', $2, $3, $4, $5)`,
        [`lid-class-${mappingClass}`, sourceKind, ownerKind, ownerId, sourceId],
      );
    }

    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest,
        toolchain_digest, published_at
      ) values (
        'crel-legacy-class', 'legacy-class', 'sha256:legacy-class',
        'sha256:legacy-class-model', 'sha256:legacy-class-toolchain',
        '2026-09-02T00:00:00Z'
      );
      insert into parameter_catalog.parameter_catalog_cutover_runs (
        id, source_snapshot_fingerprint, target_artifact_sha,
        target_catalog_release_digest, migration_contract_version,
        plan_digest, current_phase, state
      ) values (
        'cutover-legacy-class', 'sha256:legacy-class-snapshot',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'sha256:legacy-class',
        'v1', 'sha256:legacy-class-plan', 'P7', 'running'
      );
    `);

    for (const [mappingClass, , , ownerKind, ownerId] of sources) {
      await client.query(
        `insert into parameter_catalog.parameter_catalog_archives (
           id, legacy_identity_id, owner_scope_kind, owner_scope_id, r_class,
           reason, source_checksum, graph_checksum, encrypted_object_ref,
           protected_references, cutover_run_id, catalog_release_id,
           success_audit_ref, retain_until
         ) values (
           $1, $2, $3, $4, 'R1', 'class archive', 'sha256:source',
           'sha256:graph', $5, '[]', 'cutover-legacy-class',
           'crel-legacy-class', $6, '2027-09-02T00:00:00Z'
         )`,
        [
          `archive-class-${mappingClass}`,
          `lid-class-${mappingClass}`,
          ownerKind,
          ownerId,
          `object://archive/${mappingClass}`,
          `audit-class-${mappingClass}`,
        ],
      );
      await client.query(
        `
         insert into parameter_catalog.legacy_mapping_versions (
           id, legacy_identity_id, cutover_run_id, version_number,
           source_checksum, graph_fingerprint, r_class, archive_id
         ) values (
           $1, $2, 'cutover-legacy-class', 1, 'sha256:source',
           'sha256:graph', 'R1', $3
         )`,
        [
          `mapping-class-${mappingClass}`,
          `lid-class-${mappingClass}`,
          `archive-class-${mappingClass}`,
        ],
      );
    }

    const archived = await client.query<{ count: string }>(`
      select count(*)::text as count
      from parameter_catalog.legacy_mapping_versions
      where cutover_run_id = 'cutover-legacy-class'
        and archive_id is not null
    `);
    expect(archived.rows[0]?.count).toBe(String(sources.length));

    for (const [mappingClass] of sources.slice(0, 11)) {
      const error = await captureDatabaseError(
        client.query(
          `insert into parameter_catalog.legacy_mapping_versions (
             id, legacy_identity_id, cutover_run_id, version_number,
             source_checksum, graph_fingerprint, r_class, target_kind, target_id
           ) values (
             $1, $2, 'cutover-legacy-class', 2, 'sha256:source-invalid',
             'sha256:graph-invalid', 'R0', $3, 'target-not-permitted'
           )`,
          [
            `mapping-invalid-${mappingClass}`,
            `lid-class-${mappingClass}`,
            mappingClass === "policy-audit-protected"
              ? "catalog-subject"
              : "policy",
          ],
        ),
      );
      expect(error.code).toBe("23514");
      expect(error.constraint).toBe("legacy_mapping_source_target_ck");
    }

    const nonContractComposite = await captureDatabaseError(
      client.query(
        `insert into parameter_catalog.legacy_identities (
           id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
         ) values (
           'lid-non-contract-composite', 'wiseeff-v1', 'audit-subject-link',
           'project', 'project-legacy-registry', $1
         )`,
        [
          JSON.stringify({
            auditEventId: "audit-legacy-class",
            semanticId: "pspec-legacy-class",
            subjectKind: "parameter-spec",
          }),
        ],
      ),
    );
    expect(nonContractComposite.code).toBe("23514");
    expect(nonContractComposite.constraint).toBe(
      "legacy_identity_composite_source_ck",
    );

    const arbitraryConsumer = await captureDatabaseError(
      client.query(
        `insert into parameter_catalog.legacy_identities (
           id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
         ) values (
           'lid-arbitrary-consumer', 'wiseeff-v1', 'unresolved-protected-reference',
           'organization', 'org-legacy-registry', $1
         )`,
        [
          serializeContract({
            column: "organization_id",
            consumerPrimaryKey: "org-legacy-registry",
            consumerTable: "public.organizations",
            rawReferencedId: "missing",
          }),
        ],
      ),
    );
    expect(arbitraryConsumer.code).toBe("23514");
    expect(arbitraryConsumer.constraint).toBe(
      "legacy_identity_protected_consumer_ck",
    );
  });

  it("freezes the internal typed-target storage literals", async () => {
    const result = await client.query<{ definition: string }>(`
      select pg_catalog.pg_get_constraintdef(constraint_record.oid, true) as definition
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_class class on class.oid = constraint_record.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and class.relname = 'legacy_mapping_versions'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) like '%target_kind%'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid, true) like '%migration-history%'
    `);

    expect(result.rows).toHaveLength(1);
    for (const targetKind of [
      "parameter-observation",
      "observation-match",
      "review-item",
      "review-resolution",
      "publication-intent",
      "policy",
      "audit-event",
      "migration-history",
    ]) {
      expect(result.rows[0]?.definition).toContain(`'${targetKind}'`);
    }
  });

  it.each([
    [
      "driver compatible",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "driver",
      " vendor,driver",
    ],
    [
      "driver compatible control",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "driver",
      "vendor,\u0000driver",
    ],
    [
      "driver compatible non-ASCII",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "driver",
      "véndor,driver",
    ],
    [
      "driver compatible whitespace",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "driver",
      "vendor, driver",
    ],
    [
      "driver compatible quote",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "driver",
      '"vendor,driver"',
    ],
    [
      "driver compatible wildcard",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "driver",
      "vendor,*",
    ],
    [
      "driver compatible syntax",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "driver",
      "vendor,driver,extra",
    ],
    [
      "node unit address",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "node-type",
      "node@1",
    ],
    [
      "node length",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "node-type",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
    [
      "node whitespace",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "node-type",
      "charging core",
    ],
    [
      "node quote",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "node-type",
      "'node'",
    ],
    [
      "node syntax",
      "catalog_subjects",
      "catalog_subject_canonical_key_ck",
      "node-type",
      "1node",
    ],
    [
      "property length",
      "parameter_definitions",
      "parameter_definition_property_key_ck",
      "property",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
    [
      "property structural status",
      "parameter_definitions",
      "parameter_definition_property_key_ck",
      "property",
      "STATUS",
    ],
    [
      "property structural hash",
      "parameter_definitions",
      "parameter_definition_property_key_ck",
      "property",
      "#custom",
    ],
    [
      "property syntax",
      "parameter_definitions",
      "parameter_definition_property_key_ck",
      "property",
      "bad/property",
    ],
    [
      "property control",
      "parameter_definitions",
      "parameter_definition_property_key_ck",
      "property",
      "bad\tkey",
    ],
  ])(
    "rejects the S0 normalization negative: %s",
    async (_name, table, constraint, kind, value) => {
      const action =
        table === "catalog_subjects"
          ? client.query(
              `insert into parameter_catalog.catalog_subjects (
           id, introduced_release_id, kind, canonical_key
         ) values ($1, 'missing-release', $2, $3)`,
              [`invalid-subject-${String(_name)}`, kind, value],
            )
          : client.query(
              `insert into parameter_catalog.parameter_definitions (
           id, introduced_release_id, subject_id, property_key, current_revision_id
         ) values ($1, 'missing-release', 'missing-subject', $2, 'missing-revision')`,
              [`invalid-property-${String(_name)}`, value],
            );
      const error = await captureDatabaseError(action);
      if (value.includes("\u0000")) {
        expect(error.code).toBe("22021");
      } else {
        expect(error.code).toBe("23514");
        expect(error.constraint).toBe(constraint);
      }
    },
  );

  it("accepts the exact S0 byte-preserving identity golden values", async () => {
    const result = await client.query<{
      compatible: boolean[];
      node_name: boolean[];
      property_key: boolean[];
    }>(`
      select
        array[
          parameter_catalog.is_canonical_compatible_selector('vendor,driver'),
          parameter_catalog.is_canonical_compatible_selector('simple'),
          parameter_catalog.is_canonical_compatible_selector('vendor+tag,driver.rev/1')
        ] as compatible,
        array[
          parameter_catalog.is_canonical_node_type_name('/'),
          parameter_catalog.is_canonical_node_type_name('charging_core'),
          parameter_catalog.is_canonical_node_type_name('usb-controller')
        ] as node_name,
        array[
          parameter_catalog.is_canonical_property_key('iin_max'),
          parameter_catalog.is_canonical_property_key('init_para'),
          parameter_catalog.is_canonical_property_key('vendor,limit?')
        ] as property_key
    `);

    expect(result.rows).toEqual([
      {
        compatible: [true, true, true],
        node_name: [true, true, true],
        property_key: [true, true, true],
      },
    ]);
  });

  it("installs the required ownership keys and domain checks as initially-deferred constraints", async () => {
    const foreignKeys = await client.query<{
      constraint_name: string;
      deferrable: boolean;
      initially_deferred: boolean;
    }>(
      `
      select
        constraint_record.conname as constraint_name,
        constraint_record.condeferrable as deferrable,
        constraint_record.condeferred as initially_deferred
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_namespace namespace on namespace.oid = constraint_record.connamespace
      where namespace.nspname = 'parameter_catalog'
        and constraint_record.conname = any($1::text[])
      order by constraint_record.conname
    `,
      [
        [
          "definition_proposal_current_revision_fk",
          "parameter_definition_current_revision_fk",
          "parameter_review_item_current_resolution_fk",
          "project_parameter_binding_current_value_fk",
          "registration_current_placement_fk",
        ],
      ],
    );
    const triggers = await client.query<{
      trigger_name: string;
      deferrable: boolean;
      initially_deferred: boolean;
    }>(
      `
      select
        trigger_record.tgname as trigger_name,
        trigger_record.tgdeferrable as deferrable,
        trigger_record.tginitdeferred as initially_deferred
      from pg_catalog.pg_trigger trigger_record
      join pg_catalog.pg_class class on class.oid = trigger_record.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname in ('parameter_catalog', 'public')
        and trigger_record.tgname = any($1::text[])
      order by trigger_record.tgname
    `,
      [
        [
          "binding_history_event_owner_fk",
          "catalog_current_definition_head_ck",
          "catalog_materialization_projection_complete_ck",
          "catalog_release_predecessor_acyclic_ck",
          "catalog_state_current_release_complete_ck",
          "catalog_subject_exact_subtype_from_driver_ck",
          "catalog_subject_exact_subtype_from_node_type_ck",
          "catalog_subject_exact_subtype_from_subject_ck",
          "comparison_result_mapping_run_fk",
          "legacy_mapping_target_fk",
          "parameter_module_placement_kind_ck",
          "review_resolution_target_owner_fk",
          "subject_placement_kind_ck",
        ],
      ],
    );

    expect(foreignKeys.rows).toEqual(
      [
        "definition_proposal_current_revision_fk",
        "parameter_definition_current_revision_fk",
        "parameter_review_item_current_resolution_fk",
        "project_parameter_binding_current_value_fk",
        "registration_current_placement_fk",
      ].map((constraint_name) => ({
        constraint_name,
        deferrable: true,
        initially_deferred: true,
      })),
    );
    expect(triggers.rows).toEqual(
      [
        "binding_history_event_owner_fk",
        "catalog_current_definition_head_ck",
        "catalog_materialization_projection_complete_ck",
        "catalog_release_predecessor_acyclic_ck",
        "catalog_state_current_release_complete_ck",
        "catalog_subject_exact_subtype_from_driver_ck",
        "catalog_subject_exact_subtype_from_node_type_ck",
        "catalog_subject_exact_subtype_from_subject_ck",
        "comparison_result_mapping_run_fk",
        "legacy_mapping_target_fk",
        "parameter_module_placement_kind_ck",
        "review_resolution_target_owner_fk",
        "subject_placement_kind_ck",
      ].map((trigger_name) => ({
        trigger_name,
        deferrable: true,
        initially_deferred: true,
      })),
    );
  });
});

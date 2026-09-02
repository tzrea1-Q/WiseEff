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

    const values = legacyMappingSourceKinds.map((sourceKind, index) => [
      `legacy-kind-${index}`,
      "legacy",
      sourceKind,
      "platform",
      "platform",
      `source-${index}`,
    ]);
    for (const value of values) {
      await client.query(
        `insert into parameter_catalog.legacy_identities (
           id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
         ) values ($1, $2, $3, $4, $5, $6)`,
        value,
      );
    }

    const stored = await client.query<{ source_kind: string }>(`
      select source_kind
      from parameter_catalog.legacy_identities
      where id like 'legacy-kind-%'
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

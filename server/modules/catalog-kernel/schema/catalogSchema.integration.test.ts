import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("canonical parameter Catalog schema", () => {
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
      [[
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
        "parameter_definitions"
      ]]
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
      "parameter_definitions"
    ]);
  });

  it("materializes the canonical Organization governance relations on a fresh database", async () => {
    const result = await client.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'parameter_catalog'
         and table_name = any($1::text[])
       order by table_name`,
      [[
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
        "subject_placements"
      ]]
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
      "subject_placements"
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
      "project_parameter_values"
    ];
    const result = await client.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'parameter_catalog'
         and table_name = any($1::text[])
       order by table_name`,
      [expected]
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(expected);
  });

  it("installs the required ownership keys and domain checks as initially-deferred constraints", async () => {
    const foreignKeys = await client.query<{
      constraint_name: string;
      deferrable: boolean;
      initially_deferred: boolean;
    }>(`
      select
        constraint_record.conname as constraint_name,
        constraint_record.condeferrable as deferrable,
        constraint_record.condeferred as initially_deferred
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_namespace namespace on namespace.oid = constraint_record.connamespace
      where namespace.nspname = 'parameter_catalog'
        and constraint_record.conname = any($1::text[])
      order by constraint_record.conname
    `, [[
      "definition_proposal_current_revision_fk",
      "parameter_definition_current_revision_fk",
      "parameter_review_item_current_resolution_fk",
      "project_parameter_binding_current_value_fk",
      "registration_current_placement_fk"
    ]]);
    const triggers = await client.query<{
      trigger_name: string;
      deferrable: boolean;
      initially_deferred: boolean;
    }>(`
      select
        trigger_record.tgname as trigger_name,
        trigger_record.tgdeferrable as deferrable,
        trigger_record.tginitdeferred as initially_deferred
      from pg_catalog.pg_trigger trigger_record
      join pg_catalog.pg_class class on class.oid = trigger_record.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and trigger_record.tgname = any($1::text[])
      order by trigger_record.tgname
    `, [[
      "catalog_state_current_release_complete_ck",
      "catalog_subject_exact_subtype_from_driver_ck",
      "catalog_subject_exact_subtype_from_node_type_ck",
      "catalog_subject_exact_subtype_from_subject_ck",
      "subject_placement_kind_ck"
    ]]);

    expect(foreignKeys.rows).toEqual([
      "definition_proposal_current_revision_fk",
      "parameter_definition_current_revision_fk",
      "parameter_review_item_current_resolution_fk",
      "project_parameter_binding_current_value_fk",
      "registration_current_placement_fk"
    ].map((constraint_name) => ({
      constraint_name,
      deferrable: true,
      initially_deferred: true
    })));
    expect(triggers.rows).toEqual([
      "catalog_state_current_release_complete_ck",
      "catalog_subject_exact_subtype_from_driver_ck",
      "catalog_subject_exact_subtype_from_node_type_ck",
      "catalog_subject_exact_subtype_from_subject_ck",
      "subject_placement_kind_ck"
    ].map((trigger_name) => ({
      trigger_name,
      deferrable: true,
      initially_deferred: true
    })));
  });
});

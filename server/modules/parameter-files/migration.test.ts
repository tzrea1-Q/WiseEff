import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationPath = path.join(root, "server", "migrations", "0041_project_parameter_files.sql");
const structuralMigrationPath = path.join(root, "server", "migrations", "0042_dts_structural_model.sql");
const configSetBaselineMigrationPath = path.join(
  root,
  "server",
  "migrations",
  "0043_dts_config_set_baseline.sql"
);
const sensitiveNodeRulesMigrationPath = path.join(
  root,
  "server",
  "migrations",
  "0045_dts_sensitive_node_rules.sql"
);
const projectDeleteCascadeMigrationPath = path.join(
  root,
  "server",
  "migrations",
  "0046_project_delete_cascade.sql"
);

describe("0041_project_parameter_files migration", () => {
  it("defines required tables, columns, and indexes", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("create table if not exists project_parameter_files");
    expect(sql).toContain("organization_id");
    expect(sql).toContain("project_id");
    expect(sql).toContain("file_name");
    expect(sql).toContain("format");
    expect(sql).toContain("module_hint");
    expect(sql).toContain("current_version_id");
    expect(sql).toContain("unique (project_id, file_name)");

    expect(sql).toContain("create table if not exists project_parameter_file_versions");
    expect(sql).toContain("version_number");
    expect(sql).toContain("storage_key");
    expect(sql).toContain("checksum");
    expect(sql).toContain("size_bytes");
    expect(sql).toContain("parsed_index");
    expect(sql).toContain("created_by_user_id");
    expect(sql).toContain("unique (file_id, version_number)");

    expect(sql).toContain("project_parameter_files_current_version_fk");

    expect(sql).toContain("alter table project_parameter_values");
    expect(sql).toContain("source_file_name");
    expect(sql).toContain("source_node_path");

    expect(sql).toContain("alter table parameter_drafts");
    expect(sql).toContain("origin");
    expect(sql).toContain("origin_file_version_id");

    expect(sql).toContain("create table if not exists parameter_file_sync_conflicts");
    expect(sql).toContain("file_version_id");
    expect(sql).toContain("file_draft_id");
    expect(sql).toContain("ui_draft_id");
    expect(sql).toContain("file_value");
    expect(sql).toContain("ui_draft_value");
    expect(sql).toContain("resolved_by_user_id");
    expect(sql).toContain("resolved_at");

    expect(sql).toContain("project_parameter_files_project_idx");
    expect(sql).toContain("project_parameter_file_versions_file_idx");
    expect(sql).toContain("parameter_file_sync_conflicts_project_open_idx");
    expect(sql).toContain("project_parameter_values_source_idx");
  });
});

describe("0042_dts_structural_model migration", () => {
  it("defines dts_nodes, dts_properties, dts_phandle_refs and key indexes", () => {
    const sql = readFileSync(structuralMigrationPath, "utf8");

    expect(sql).toContain("create table if not exists dts_nodes");
    expect(sql).toContain("file_version_id");
    expect(sql).toContain("parent_id");
    expect(sql).toContain("unit_address");
    expect(sql).toContain("node_path");
    expect(sql).toContain("is_overlay_root");

    expect(sql).toContain("create table if not exists dts_properties");
    expect(sql).toContain("value_type");
    expect(sql).toContain("raw_text");
    expect(sql).toContain("normalized_value");

    expect(sql).toContain("create table if not exists dts_phandle_refs");
    expect(sql).toContain("from_property_id");
    expect(sql).toContain("target_label");
    expect(sql).toContain("resolved_target_node_id");

    expect(sql).toContain("dts_nodes_version_path_idx");
    expect(sql).toContain("dts_nodes_parent_idx");
    expect(sql).toContain("dts_properties_node_idx");
    expect(sql).toContain("dts_nodes_compatible_idx");
    expect(sql).toContain("dts_phandle_refs_target_idx");
  });
});

describe("0043_dts_config_set_baseline migration", () => {
  it("defines dts_config_set, project_parameter_files config-set columns, and key indexes", () => {
    const sql = readFileSync(configSetBaselineMigrationPath, "utf8");

    expect(sql).toContain("create table if not exists dts_config_set");
    expect(sql).toContain("organization_id");
    expect(sql).toContain("project_id");
    expect(sql).toContain("derived_from_id");
    expect(sql).toContain("unique (project_id, name)");

    expect(sql).toContain("alter table project_parameter_files");
    expect(sql).toContain("add column if not exists config_set_id text references dts_config_set(id)");
    expect(sql).toContain("add column if not exists config_set_role text");
    expect(sql).toContain("add column if not exists config_set_sort_order integer not null default 0");

    expect(sql).toContain("create table if not exists dts_release_baseline");
    expect(sql).toContain("config_set_id text not null references dts_config_set(id) on delete cascade");
    expect(sql).toContain("status text not null default 'draft' check (status in ('draft', 'released'))");
    expect(sql).toContain("created_by_user_id");
    expect(sql).toContain("unique (config_set_id, name)");

    expect(sql).toContain("create table if not exists dts_release_baseline_members");
    expect(sql).toContain("file_id text not null references project_parameter_files(id)");
    expect(sql).toContain("file_version_id text not null references project_parameter_file_versions(id)");
    expect(sql).toContain("version_number integer not null");
    expect(sql).toContain("unique (baseline_id, file_id)");

    expect(sql).toContain("dts_config_set_project_idx");
    expect(sql).toContain("project_parameter_files_config_set_idx");
    expect(sql).toContain("dts_release_baseline_set_idx");
    expect(sql).toContain("dts_release_baseline_members_baseline_idx");
  });

  it("backfills a default config set per project idempotently and links orphan parameter files", () => {
    const sql = readFileSync(configSetBaselineMigrationPath, "utf8");

    // Creates a default config set for every project that doesn't already have one.
    expect(sql).toContain("insert into dts_config_set");
    expect(sql).toContain("from projects p");
    expect(sql).toContain("'default'");
    expect(sql).toMatch(/where not exists \(\s*select 1\s*from dts_config_set dcs\s*where dcs\.project_id = p\.id/);

    // Re-entrant: only updates parameter files that don't already have a config set.
    expect(sql).toContain("update project_parameter_files ppf");
    expect(sql).toContain("set config_set_id = dcs.id");
    expect(sql).toContain("ppf.config_set_id is null");
  });

  it("widens project_parameter_file_versions.origin to allow 'rollback' idempotently", () => {
    const sql = readFileSync(configSetBaselineMigrationPath, "utf8");

    expect(sql).toContain("project_parameter_file_versions");
    expect(sql).toContain("con.contype = 'c'");
    expect(sql).toContain("pg_get_constraintdef(con.oid) ilike '%origin%'");
    expect(sql).toContain("drop constraint %I");
    expect(sql).toContain("project_parameter_file_versions_origin_check");
    expect(sql).toContain("check (origin in ('upload', 'writeback', 'rollback'))");
  });
});

describe("0045_dts_sensitive_node_rules migration", () => {
  it("defines sensitive node rules table, columns, and indexes", () => {
    const sql = readFileSync(sensitiveNodeRulesMigrationPath, "utf8");

    expect(sql).toContain("create table if not exists dts_sensitive_node_rules");
    expect(sql).toContain("organization_id");
    expect(sql).toContain("project_id");
    expect(sql).toContain("match_type");
    expect(sql).toContain("path");
    expect(sql).toContain("compatible");
    expect(sql).toContain("pattern");
    expect(sql).toContain("risk_tier");
    expect(sql).toContain("high");
    expect(sql).toContain("critical");
    expect(sql).toContain("required_capability");
    expect(sql).toContain("parameter:edit-critical");
    expect(sql).toContain("enabled");
    expect(sql).toContain("created_at");
    expect(sql).toContain("updated_at");
    expect(sql).toContain("dts_sensitive_node_rules_org_project_idx");
  });
});

describe("0046_project_delete_cascade migration", () => {
  it("rebuilds the DTS-chain FKs so project deletion cascades cleanly", () => {
    const sql = readFileSync(projectDeleteCascadeMigrationPath, "utf8");

    // Root: project → parameter files.
    expect(sql).toContain("project_parameter_files_project_id_fkey");
    expect(sql).toContain("foreign key (project_id) references projects(id) on delete cascade");
    // Baseline members must not block file/version deletion.
    expect(sql).toContain("dts_release_baseline_members_file_id_fkey");
    expect(sql).toContain("dts_release_baseline_members_file_version_id_fkey");
    // Sync conflicts clear with their referenced value/version/draft rows.
    expect(sql).toContain("parameter_file_sync_conflicts_value_fkey");
    expect(sql).toContain("parameter_file_sync_conflicts_file_version_fkey");
    // Drafts are detached, not deleted.
    expect(sql).toContain("parameter_drafts_origin_file_version_fkey");
    expect(sql).toContain("on delete set null");
    // Idempotent, append-only pattern.
    expect(sql).toContain("drop constraint %I");
  });
});

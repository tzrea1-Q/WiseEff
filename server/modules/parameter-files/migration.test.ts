import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationPath = path.join(root, "server", "migrations", "0041_project_parameter_files.sql");
const structuralMigrationPath = path.join(root, "server", "migrations", "0042_dts_structural_model.sql");

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

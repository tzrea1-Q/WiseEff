import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

describe("M1 parameter migration invariants", () => {
  it("enforces one history entry per project parameter value version", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0002_m1_parameters.sql"),
      "utf8",
    );

    expect(migration).toContain(
      "parameter_history_entries_value_version_unique_idx",
    );
    expect(migration).toContain(
      "on parameter_history_entries(project_parameter_value_id, version)",
    );
  });
});

describe("M4 agent migration invariants", () => {
  it("persists sessions, messages, tool calls, approvals, and traces", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0008_m4_agent.sql"),
      "utf8",
    );

    expect(migration).toContain("create table if not exists agent_sessions");
    expect(migration).toContain("create table if not exists agent_messages");
    expect(migration).toContain("create table if not exists agent_tool_calls");
    expect(migration).toContain("create table if not exists agent_approvals");
    expect(migration).toContain("create table if not exists agent_run_traces");
    expect(migration).toContain("agent_approvals_tool_call_unique_idx");
    expect(migration).toContain("agent_sessions_context_scope_idx");
  });
});

describe("M5 job dead-letter migration invariants", () => {
  it("adds retry visibility and dead-letter metadata to jobs", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0009_m5_job_dead_letters.sql"),
      "utf8",
    );

    expect(migration).toContain(
      "add column if not exists next_run_at timestamptz",
    );
    expect(migration).toContain(
      "add column if not exists dead_lettered_at timestamptz",
    );
    expect(migration).toContain(
      "add column if not exists dead_letter_reason text",
    );
    expect(migration).toContain("jobs_retry_claimable_idx");
  });
});

describe("M5 agent provider trace migration invariants", () => {
  it("adds latency, usage, safety, and fallback trace metadata", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0010_m5_agent_provider_traces.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("add column if not exists latency_ms integer");
    expect(migration).toContain(
      "add column if not exists input_tokens integer",
    );
    expect(migration).toContain(
      "add column if not exists output_tokens integer",
    );
    expect(migration).toContain(
      "add column if not exists estimated_cost_usd numeric",
    );
    expect(migration).toContain("add column if not exists safety_status text");
    expect(migration).toContain(
      "add column if not exists safety_reasons jsonb",
    );
    expect(migration).toContain(
      "add column if not exists fallback_reason text",
    );
  });
});

describe("parameter module mappings migration invariants", () => {
  it("adds importance to v1 parameter_modules and creates DTS mappings table", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0066_parameter_module_mappings.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("add column if not exists importance");
    expect(migration).toContain(
      "create table if not exists parameter_module_mappings",
    );
    expect(migration).toContain(
      "unique (organization_id, match_kind, match_value)",
    );
    expect(migration).toContain("check (priority >= 0 and priority <= 999)");
    expect(migration).not.toContain(
      "create table if not exists parameter_modules",
    );
  });
});

describe("binding module_id migration invariants", () => {
  it("adds module_id and replaces binding unique key", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0067_binding_module_id.sql"),
      "utf8",
    );
    expect(migration).toContain("add column if not exists module_id");
    expect(migration).toContain("references parameter_modules(id)");
    expect(migration).toContain(
      "project_parameter_bindings_project_node_spec_module_unique",
    );
    expect(migration).toContain(
      "unique nulls not distinct (project_id, logical_node_id, parameter_spec_id, module_id)",
    );
  });
});

describe("structural spec-review dismiss migration invariants", () => {
  it("dismisses structural open review tasks and deprecates status specs", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0068_dismiss_structural_spec_reviews.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("systemic:structural-property-not-a-parameter");
    expect(migration).toContain("'status'");
    expect(migration).toContain("lifecycle = 'deprecated'");
    expect(migration).toContain("0068");
    expect(migration).not.toContain("delete from parameter_spec_review_tasks");
  });
});

describe("node enablement draft migration invariants", () => {
  it("adds edit_subject_kind, logical_node_id, and partial unique indexes", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0069_node_enablement_drafts.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("edit_subject_kind");
    expect(migration).toContain("node-enablement");
    expect(migration).toContain("logical_node_id");
    expect(migration).toContain(
      "alter column project_parameter_binding_id drop not null",
    );
    expect(migration).toContain("parameter_drafts_binding_user_unique");
    expect(migration).toContain("parameter_drafts_enablement_user_unique");
    expect(migration).toContain("parameter_drafts_project_binding_user_key");
    expect(migration).toContain("parameter_drafts_enablement_subject_check");
  });
});

describe("node enablement change request migration invariants", () => {
  it("mirrors enablement identity onto change requests, submission items, and history", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0070_node_enablement_change_requests.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "parameter_change_requests_edit_subject_kind_check",
    );
    expect(migration).toContain(
      "parameter_change_requests_enablement_subject_check",
    );
    expect(migration).toContain(
      "parameter_change_requests_open_enablement_unique",
    );
    expect(migration).toContain(
      "parameter_submission_items_enablement_subject_check",
    );
    expect(migration).toContain(
      "alter column project_parameter_binding_id drop not null",
    );
    expect(migration).toContain("alter table parameter_history_entries");
    expect(migration).toContain("parameter_history_entries_logical_node_idx");
    expect(migration).toContain("node-enablement");
  });
});

describe("PPV nullability for enablement / pre-cutover drafts", () => {
  it("relaxes project_parameter_value_id NOT NULL when the pre-cutover column still exists", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0087_relax_ppv_null_for_enablement_drafts.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("project_parameter_value_id");
    expect(migration).toContain("parameter_drafts");
    expect(migration).toContain("parameter_change_requests");
    expect(migration).toContain("parameter_submission_items");
    expect(migration).toContain("drop not null");
    expect(migration).toContain("information_schema.columns");
  });
});

describe("driver registration default business category (D-AG-04 / TD-046)", () => {
  it("adds default_business_category_module_id and backfills from business parents", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0089_driver_registration_default_business_category.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("default_business_category_module_id");
    expect(migration).toContain("references parameter_modules(id)");
    expect(migration).toContain(
      "driver_registrations_default_business_category_idx",
    );
    expect(migration).toContain("parent.kind = 'business'");
    expect(migration).toContain("attribution_subject_id");
  });
});

describe("module kind/origin migration invariants", () => {
  it("adds kind, origin, source_key and retires driver match kind", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0072_module_kind_origin.sql"),
      "utf8",
    );
    expect(migration).toContain("add column if not exists kind");
    expect(migration).toContain("add column if not exists origin");
    expect(migration).toContain("add column if not exists source_key");
    expect(migration).toContain("parameter_modules_kind_check");
    expect(migration).toContain("parameter_modules_origin_check");
    expect(migration).toContain("parameter_modules_org_source_key_unique_idx");
    expect(migration).toContain("'driver-group'");
    expect(migration).toContain("delete from parameter_module_mappings");
    expect(migration).toContain("match_kind = 'driver'");
    expect(migration).toContain(
      "check (match_kind in ('compatible', 'instance'))",
    );
    expect(migration).not.toContain(
      "check (match_kind in ('driver', 'compatible', 'instance'))",
    );
  });
});

describe("dismissed compatibles migration invariants", () => {
  it("creates dismissed-compatibles table with org+compatible uniqueness", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0073_dismissed_compatibles.sql"),
      "utf8",
    );
    expect(migration).toContain(
      "create table if not exists parameter_module_dismissed_compatibles",
    );
    expect(migration).toContain(
      "parameter_module_dismissed_compatibles_org_compatible_idx",
    );
    expect(migration).toContain("lower(compatible)");
    expect(migration).toContain("dismissed_by_user_id");
  });
});

describe("business misclassified-as-instance correction", () => {
  it("restores curated business parents wrongly marked instance by 0072 batt-prefix", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0074_fix_business_misclassified_as_instance.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("kind = 'business'");
    expect(migration).toContain("origin = 'curated'");
    expect(migration).toContain("source_key is null");
    expect(migration).toContain("match_kind = 'instance'");
    expect(migration).toContain("child.kind = 'business'");
  });
});

describe("logical module kind migration invariants", () => {
  it("widens kind check to include logical without bulk backfill", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0075_module_logical_kind.sql"),
      "utf8",
    );
    expect(migration).toContain("parameter_modules_kind_check");
    expect(migration).toContain("'logical'");
    expect(migration).toContain(
      "check (kind in ('business', 'driver-group', 'instance', 'logical', 'unclassified'))",
    );
    expect(migration).not.toMatch(/update\s+parameter_modules/i);
  });
});

describe("platform admin role migration invariants", () => {
  it("inserts the platform-admin catalog row and allows nullable audit organization scope", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0078_platform_admin_role.sql"),
      "utf8",
    );

    expect(migration).toContain("'platform-admin'");
    expect(migration).toContain("platform:access");
    expect(migration).toContain("platform:schema-promote");
    expect(migration).toContain(
      "alter table audit_events alter column organization_id drop not null",
    );
  });
});

describe("driver schema overlay platform tier migration invariants", () => {
  it("renames overlay tables and adds platform tier columns", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0079_driver_schema_platform_tier.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("rename to driver_schema_overlays");
    expect(migration).toContain("rename to driver_schema_overlay_properties");
    expect(migration).toContain("alter column organization_id drop not null");
    expect(migration).toContain(
      "driver_schema_overlays_platform_compatible_active_uidx",
    );
    expect(migration).toContain(
      "lifecycle in ('draft', 'active', 'deprecated', 'superseded')",
    );
    expect(migration).toContain("superseded_by_schema_id");
    expect(migration).toContain("driver_schema_overlay_promotions");
  });
});

describe("organization driver schema overlay migration invariants", () => {
  it("adds org-scoped overlay tables with active-compatible uniqueness", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0076_organization_driver_schemas.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("organization_driver_schemas");
    expect(migration).toContain("organization_driver_schema_properties");
    expect(migration).toContain(
      "organization_driver_schemas_org_compatible_active_uidx",
    );
    expect(migration).toContain("where lifecycle = 'active'");
    expect(migration).toContain("on delete cascade");
    expect(migration).toContain("parameter_spec_id");
  });

  it("requires overlay properties to link ParameterSpec rows", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0077_organization_driver_schema_properties_link_specs.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("parameter_spec_id");
    expect(migration).toContain("drop column if exists value_shape");
    expect(migration).toContain(
      "organization_driver_schema_properties_schema_spec_uidx",
    );
  });
});

describe("attribution taxonomy migration invariants (ADR-0010)", () => {
  it("widens then narrows kind/match_kind and retires instance/logical", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0080_attribution_taxonomy.sql"),
      "utf8",
    );
    expect(migration).toContain("parameter_modules_kind_check");
    expect(migration).toContain("parameter_module_mappings_match_kind_check");
    expect(migration).toContain("'node-type'");
    expect(migration).toContain("nodetype:");
    expect(migration).toContain(
      "check (kind in ('business', 'driver-group', 'node-type', 'unclassified'))",
    );
    expect(migration).toContain(
      "check (match_kind in ('compatible', 'node-type'))",
    );
    expect(migration).toContain("kind = 'instance'");
    expect(migration).toMatch(/kind in \('logical', 'instance'\)/);
    expect(migration).toMatch(/delete from parameter_modules/i);
    expect(migration).toMatch(/delete from parameter_module_mappings/i);
  });
});

describe("nodename driver subject correction migration invariants (Issue #649)", () => {
  it("reclassifies legacy nodetype subjects without dropping their identity history", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0122_classify_nodename_driver_subjects.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("insert into node_type_definitions");
    expect(migration).toContain("Keep the old registration and placement rows");
    expect(migration).not.toContain(
      "delete from driver_registration_placements",
    );
    expect(migration).not.toContain("delete from driver_registrations");
    expect(migration).toContain("set subject_kind = 'node-type-definition'");
    expect(migration).toContain("lower(asub.source_key) like 'nodetype:%'");
    expect(migration).toContain("wiseeff_assert_active_dts_property_spec");
    expect(migration).toContain("subject_kind = 'node-type-definition'");
    expect(migration).not.toContain("drop table");
  });
});

describe("node-type identity hardening migration invariants (Issue #649)", () => {
  it("repairs trusted blank names and fails closed before adding the non-empty check", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0123_harden_node_type_identity.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("update node_type_definitions");
    expect(migration).toContain(
      "regexp_replace(lower(asub.source_key), '^nodetype:', '')",
    );
    expect(migration).toContain("nullif(btrim(asub.display_name), '')");
    expect(migration).toContain("refuse to proceed");
    expect(migration).toContain("node_type_definitions_bare_node_name_check");
    expect(migration).toContain("check (btrim(bare_node_name) <> '')");
    expect(migration).toContain("wiseeff_lock_driver_schema_version_mutation");
    expect(migration).toContain("wiseeff_driver_schema_version_mutation_lock");
    expect(migration).toContain(
      "subject_organization_id <> new.organization_id",
    );
    expect(migration).toContain("wiseeff_guard_driver_registration_placement");
    expect(migration).not.toContain("delete from node_type_definitions");
  });
});

describe("user account deletion migration invariants", () => {
  it("keeps the pre-existing 0117 migration available and unchanged in substance", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0117_user_account_deletion.sql"),
      "utf8",
    );
    expect(migration).toContain("Permanent user deletion");
    expect(migration).toContain(
      "references public.users(id) on delete %s not valid",
    );
    expect(migration).toContain("auth_sessions.user_id");
    expect(migration).toContain("user_role_bindings.user_id");
  });
});

describe("driver identity owner hardening migration invariants (Issue #649)", () => {
  it("guards owner scope, canonical subject, and synchronized property keys", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0124_harden_driver_identity_owner.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("wiseeff_assert_active_dts_property_spec");
    expect(migration).toContain("property keys");
    expect(migration).toContain(
      "schema_organization_id is distinct from spec_organization_id",
    );
    expect(migration).toContain(
      "subject_organization_id is distinct from spec_organization_id",
    );
    expect(migration).toContain("wiseeff_driver_schema_identity_owner_guard");
    expect(migration).toContain(
      "before insert or update of source_kind, definition_lifecycle, organization_id,",
    );
  });
});

describe("symmetric DriverSchema owner hardening migration invariants (Issue #649)", () => {
  it("rejects both cross-organization and platform-to-organization root links", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0125_harden_driver_schema_owner_scope.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "if new.organization_id is distinct from spec_organization_id then",
    );
    expect(migration).toContain("wiseeff_driver_schema_identity_owner_guard");
    expect(migration).toContain("DriverSchema owner scope");
  });
});

describe("binding version owner hardening migration invariants (Issue #649)", () => {
  it("guards inserts and updates against cross-spec versions", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0126_guard_binding_spec_version_owner.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("wiseeff_assert_binding_spec_version_owner");
    expect(migration).toContain(
      "before insert or update of binding_id, parameter_spec_version_id",
    );
    expect(migration).toContain(
      "Binding ParameterSpecVersion must belong to the binding ParameterSpec",
    );
  });
});

describe("structural parameter cleanup migration invariants (ADR-0003)", () => {
  it("removes structural definitions after full FK preflight and prevents re-entry", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0081_remove_structural_parameter_specs.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("structural_parameter_specs");
    expect(migration).toContain("delete from project_parameter_bindings");
    expect(migration).toContain("delete from parameter_specs");
    expect(migration).toContain("dts_property_specs_non_structural_key_check");
    expect(migration).toContain("'status'");
    expect(migration).toContain("'compatible'");
    expect(migration).toContain("trim(property_key) not like '#%'");
    expect(migration).toContain("refuse destructive cleanup");
    // Direct FK preflight — not only via project_parameter_bindings.
    expect(migration).toContain("parameter_change_requests");
    expect(migration).toContain("parameter_history_entries");
    expect(migration).toContain("debugging_parameters");
    expect(migration).toContain("node_operations");
    expect(migration).toContain("legacy_parameter_migration_evidence");
    expect(migration).toContain("parameter_file_sync_conflicts");
  });
});

describe("attribution subjects migration invariants (ADR-0013)", () => {
  it("introduces stable subjects and links driver-group/node-type modules", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0082_attribution_subjects.sql"),
      "utf8",
    );
    expect(migration).toContain(
      "create table if not exists attribution_subjects",
    );
    expect(migration).toContain(
      "create table if not exists driver_registrations",
    );
    expect(migration).toContain(
      "create table if not exists node_type_definitions",
    );
    expect(migration).toContain("physical-device");
    expect(migration).toContain("logical-service");
    expect(migration).toContain("singleton-per-project");
    expect(migration).toContain("attribution_subject_id");
    expect(migration).toContain("parameter_modules_subject_kind_check");
  });
});

describe("parameter spec versioning migration invariants (ADR-0014)", () => {
  it("separates definition lifecycle from version status and copies content onto versions", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0083_parameter_spec_versioning.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("definition_lifecycle");
    expect(migration).toContain("version_status");
    expect(migration).toContain("attribution_subject_id");
    expect(migration).toContain("activated_at");
    expect(migration).toContain("'superseded'");
    expect(migration).toContain("draft");
    expect(migration).toContain("active");
    expect(migration).toContain("deprecated");
    expect(migration).toContain("reference_rules");
    expect(migration).toContain("dts_property_specs");
    expect(migration).toMatch(
      /parameter_specs_definition_lifecycle_check|definition_lifecycle in/,
    );
    expect(migration).toMatch(
      /parameter_spec_versions_version_status_check|version_status in/,
    );
  });
});

describe("parameter spec version cutover migration invariants (ADR-0014)", () => {
  it("introduces staged cutover run and item tables", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0084_parameter_spec_version_cutover.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("parameter_spec_version_cutover_runs");
    expect(migration).toContain("parameter_spec_version_cutover_items");
    expect(migration).toContain("preparing");
    expect(migration).toContain("finalized");
    expect(migration).toContain("incompatible");
    expect(migration).toContain("from_version_id");
    expect(migration).toContain("to_version_id");
  });
});

describe("parameter spec property-key cutover migration invariants (ADR-0034)", () => {
  it("introduces a parallel run and item table, not columns on version cutover", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0113_parameter_spec_property_key_cutover.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("parameter_spec_property_key_cutover_runs");
    expect(migration).toContain("parameter_spec_property_key_cutover_items");
    expect(migration).toContain("from_key");
    expect(migration).toContain("to_key");
    expect(migration).toContain("preparing");
    expect(migration).toContain("finalized");
    expect(migration).not.toContain(
      "alter table parameter_spec_version_cutover",
    );
  });
});

describe("identity mapping singleton blockers migration invariants", () => {
  it("extends mapping outcomes and singleton task kind", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0085_identity_mapping_and_singleton_blockers.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("new_identity");
    expect(migration).toContain("task_kind");
    expect(migration).toContain("singleton-cardinality");
    expect(migration).toContain("identity_mapping_singleton_blocker_idx");
  });
});

describe("config revision lifecycle migration invariants", () => {
  it("retires published because release happens at the file baseline layer", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0086_retire_config_revision_published.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("where status = 'published'");
    expect(migration).toContain("refuse to narrow");
    expect(migration).not.toMatch(/check \(status in \([^)]*'published'/s);
  });
});

describe("spec lifecycle closure migration invariants (ADR-0011)", () => {
  it("lands activated_at on parameter_spec_versions via ADR-0014 versioning migration", () => {
    // #215 / ADR-0014 absorbed the activated_at column into 0083; the original
    // 0081_spec_lifecycle_closure.sql is obsolete and must not collide with
    // 0081_remove_structural_parameter_specs.sql.
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0083_parameter_spec_versioning.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("activated_at timestamptz");
    expect(migration).toContain("lifecycle = 'active'");
    expect(migration).toContain("activated_at is null");
  });
});

describe("parameter spec subject-required migration invariants (D-AG-03 / TD-047)", () => {
  it("backfills attribution_subject_id and fail-closes unresolved identity-bearing rows", () => {
    const migration = readFileSync(
      path.join(
        root,
        "server",
        "migrations",
        "0088_parameter_spec_subject_required.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("attribution_subject_id");
    expect(migration).toContain("compatible:");
    expect(migration).toContain("project_parameter_bindings");
    expect(migration).toContain("driver_schema_overlay_properties");
    expect(migration).toContain("refuse to proceed");
    expect(migration).toContain(
      "identity-bearing parameter_specs still lack attribution_subject_id",
    );
    expect(migration).toMatch(/raise exception/i);
  });
});

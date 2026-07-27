import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("M1 parameter migration invariants", () => {
  it("enforces one history entry per project parameter value version", () => {
    const migration = readFileSync(path.join(root, "server", "migrations", "0002_m1_parameters.sql"), "utf8");

    expect(migration).toContain("parameter_history_entries_value_version_unique_idx");
    expect(migration).toContain("on parameter_history_entries(project_parameter_value_id, version)");
  });
});

describe("M4 agent migration invariants", () => {
  it("persists sessions, messages, tool calls, approvals, and traces", () => {
    const migration = readFileSync(path.join(root, "server", "migrations", "0008_m4_agent.sql"), "utf8");

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
    const migration = readFileSync(path.join(root, "server", "migrations", "0009_m5_job_dead_letters.sql"), "utf8");

    expect(migration).toContain("add column if not exists next_run_at timestamptz");
    expect(migration).toContain("add column if not exists dead_lettered_at timestamptz");
    expect(migration).toContain("add column if not exists dead_letter_reason text");
    expect(migration).toContain("jobs_retry_claimable_idx");
  });
});

describe("M5 agent provider trace migration invariants", () => {
  it("adds latency, usage, safety, and fallback trace metadata", () => {
    const migration = readFileSync(path.join(root, "server", "migrations", "0010_m5_agent_provider_traces.sql"), "utf8");

    expect(migration).toContain("add column if not exists latency_ms integer");
    expect(migration).toContain("add column if not exists input_tokens integer");
    expect(migration).toContain("add column if not exists output_tokens integer");
    expect(migration).toContain("add column if not exists estimated_cost_usd numeric");
    expect(migration).toContain("add column if not exists safety_status text");
    expect(migration).toContain("add column if not exists safety_reasons jsonb");
    expect(migration).toContain("add column if not exists fallback_reason text");
  });
});

describe("parameter module mappings migration invariants", () => {
  it("adds importance to v1 parameter_modules and creates DTS mappings table", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0066_parameter_module_mappings.sql"),
      "utf8"
    );

    expect(migration).toContain("add column if not exists importance");
    expect(migration).toContain("create table if not exists parameter_module_mappings");
    expect(migration).toContain("unique (organization_id, match_kind, match_value)");
    expect(migration).toContain("check (priority >= 0 and priority <= 999)");
    expect(migration).not.toContain("create table if not exists parameter_modules");
  });
});

describe("binding module_id migration invariants", () => {
  it("adds module_id and replaces binding unique key", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0067_binding_module_id.sql"),
      "utf8"
    );
    expect(migration).toContain("add column if not exists module_id");
    expect(migration).toContain("references parameter_modules(id)");
    expect(migration).toContain("project_parameter_bindings_project_node_spec_module_unique");
    expect(migration).toContain("unique nulls not distinct (project_id, logical_node_id, parameter_spec_id, module_id)");
  });
});

describe("structural spec-review dismiss migration invariants", () => {
  it("dismisses structural open review tasks and deprecates status specs", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0068_dismiss_structural_spec_reviews.sql"),
      "utf8"
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
      path.join(root, "server", "migrations", "0069_node_enablement_drafts.sql"),
      "utf8"
    );
    expect(migration).toContain("edit_subject_kind");
    expect(migration).toContain("node-enablement");
    expect(migration).toContain("logical_node_id");
    expect(migration).toContain("alter column project_parameter_binding_id drop not null");
    expect(migration).toContain("parameter_drafts_binding_user_unique");
    expect(migration).toContain("parameter_drafts_enablement_user_unique");
    expect(migration).toContain("parameter_drafts_project_binding_user_key");
    expect(migration).toContain("parameter_drafts_enablement_subject_check");
  });
});

describe("node enablement change request migration invariants", () => {
  it("mirrors enablement identity onto change requests, submission items, and history", () => {
    const migration = readFileSync(
      path.join(root, "server", "migrations", "0070_node_enablement_change_requests.sql"),
      "utf8"
    );
    expect(migration).toContain("parameter_change_requests_edit_subject_kind_check");
    expect(migration).toContain("parameter_change_requests_enablement_subject_check");
    expect(migration).toContain("parameter_change_requests_open_enablement_unique");
    expect(migration).toContain("parameter_submission_items_enablement_subject_check");
    expect(migration).toContain("alter column project_parameter_binding_id drop not null");
    expect(migration).toContain("alter table parameter_history_entries");
    expect(migration).toContain("parameter_history_entries_logical_node_idx");
    expect(migration).toContain("node-enablement");
  });
});

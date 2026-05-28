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

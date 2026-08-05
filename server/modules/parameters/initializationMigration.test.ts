import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("0091_project_parameter_initialization migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "server/migrations/0091_project_parameter_initialization.sql"),
    "utf8"
  );

  it("adds initialization_status and durable draft/review tables", () => {
    expect(sql).toContain("add column if not exists initialization_status");
    expect(sql).toContain("create table if not exists project_parameter_initialization_drafts");
    expect(sql).toContain("create table if not exists project_parameter_initialization_reviews");
    expect(sql).toContain("binding_snapshots jsonb");
    expect(sql).toContain("empty_library boolean");
    expect(sql).toContain("selected_source_binding_ids");
  });

  it("constrains initialization_status and pending review uniqueness", () => {
    expect(sql).toContain("projects_initialization_status_check");
    expect(sql).toContain("initialization_pending_review");
    expect(sql).toContain("project_parameter_initialization_reviews_one_pending_per_project");
  });
});

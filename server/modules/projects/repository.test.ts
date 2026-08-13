/**
 * Behavior-level integration coverage for the project repository: listing,
 * by-id reads, and the manual parameter-data cascade delete against a real
 * database. Asserts returned DTOs and subsequent reads — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { deleteProject, getProjectById, listProjects } from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("project repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-chargelab", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Xu Yun", email: "xu@example.com" }],
      projects: [
        { id: "aurora", name: "Aurora", code: "AUR" },
        { id: "zephyr", name: "Zephyr", code: "ZEP" }
      ]
    });
    await seedCoreGraph(db, {
      organization: { id: "org-foreign", name: "Foreign Org" },
      projects: [{ id: "foreign-project", name: "Foreign", code: "FRN" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("listProjects filters by organization", async () => {
    const rows = await listProjects(db, { organizationId: "org-chargelab" });

    expect(rows).toEqual([
      { id: "aurora", name: "Aurora", code: "AUR" },
      { id: "zephyr", name: "Zephyr", code: "ZEP" }
    ]);
  });

  it("getProjectById scopes project ownership to organization", async () => {
    await expect(getProjectById(db, { organizationId: "org-chargelab", projectId: "aurora" })).resolves.toEqual({
      id: "aurora",
      name: "Aurora",
      code: "AUR"
    });
    // Another organization's project id resolves to nothing.
    await expect(
      getProjectById(db, { organizationId: "org-chargelab", projectId: "foreign-project" })
    ).resolves.toBeNull();
  });

  it("deleteProject cascades parameter data and removes the project, keeping shared definitions", async () => {
    // Parameter data hanging off the doomed project, plus the same shapes on a
    // surviving project to prove the cascade stays scoped.
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values ('pd-1', 'org-chargelab', 'fast_charge', 'd', 'e', 'ENV', 'Battery', '', 'mA', 'Low')`
    );
    for (const [valueId, projectId] of [
      ["value-aurora", "aurora"],
      ["value-zephyr", "zephyr"]
    ] as const) {
      await db.query(
        `insert into project_parameter_values (
           id, organization_id, project_id, parameter_definition_id,
           current_value, recommended_value, value_version, updated_by_user_id
         ) values ($1, 'org-chargelab', $2, 'pd-1', '1', '1', 1, 'user-1')`,
        [valueId, projectId]
      );
      await db.query(
        `insert into parameter_drafts (
           id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason
         ) values ($1, 'org-chargelab', $2, $3, 'user-1', '2', 'draft')`,
        [`draft-${projectId}`, projectId, valueId]
      );
      await db.query(
        `insert into parameter_submission_rounds (id, organization_id, project_id, submitter_user_id, status, summary)
         values ($1, 'org-chargelab', $2, 'user-1', 'submitted', 'round')`,
        [`round-${projectId}`, projectId]
      );
      await db.query(
        `insert into parameter_change_requests (
           id, organization_id, submission_round_id, project_id, project_parameter_value_id,
           parameter_definition_id, base_version, current_value, target_value, status, submitter_user_id
         ) values ($1, 'org-chargelab', $2, $3, $4, 'pd-1', 1, '1', '2', 'submitted', 'user-1')`,
        [`request-${projectId}`, `round-${projectId}`, projectId, valueId]
      );
      await db.query(
        `insert into parameter_review_decisions (
           id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status
         ) values ($1, 'org-chargelab', $2, 'user-1', 'advance', 'submitted', 'hardware_review')`,
        [`decision-${projectId}`, `request-${projectId}`]
      );
    }

    const deleted = await deleteProject(db, { organizationId: "org-chargelab", projectId: "aurora" });
    expect(deleted).toEqual({ deleted: true });

    // The project and everything hanging off it are gone…
    await expect(getProjectById(db, { organizationId: "org-chargelab", projectId: "aurora" })).resolves.toBeNull();
    for (const [table, where] of [
      ["project_parameter_values", `project_id = 'aurora'`],
      ["parameter_drafts", `project_id = 'aurora'`],
      ["parameter_submission_rounds", `project_id = 'aurora'`],
      ["parameter_change_requests", `project_id = 'aurora'`],
      ["parameter_review_decisions", `request_id = 'request-aurora'`]
    ] as const) {
      const rows = await db.query<{ count: string }>(`select count(*)::text as count from ${table} where ${where}`);
      expect({ table, count: Number(rows.rows[0].count) }).toEqual({ table, count: 0 });
    }
    // …while the sibling project's rows and the organization-wide definition survive.
    const surviving = await db.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_values where project_id = 'zephyr'`
    );
    expect(Number(surviving.rows[0].count)).toBe(1);
    const definition = await db.query<{ id: string }>(`select id from parameter_definitions where id = 'pd-1'`);
    expect(definition.rows).toEqual([{ id: "pd-1" }]);

    await expect(deleteProject(db, { organizationId: "org-chargelab", projectId: "missing" })).resolves.toEqual({
      deleted: false,
      reason: "not_found"
    });
  });
});

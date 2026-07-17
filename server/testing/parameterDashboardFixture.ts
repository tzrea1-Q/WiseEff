import type { Database } from "../shared/database/client";
import { LEGACY_SQL } from "../modules/parameter-topology/migration";

const ORG_ID = "org-dashboard-fixture";
const ORG_NAME = "Dashboard Fixture Organization";
const ACTIVE_USER_ID = "u-dashboard-fixture-active";
const INACTIVE_USER_ID = "u-dashboard-fixture-inactive";

const PROJECTS = [
  { id: "dashboard-fixture-aurora", code: "AUR-Prod", name: "Aurora Production" },
  { id: "dashboard-fixture-zephyr", code: "ZEP-Dev", name: "Zephyr Dev" },
  { id: "dashboard-fixture-nebula", code: "NEB-Stg", name: "Nebula Staging" }
] as const;

const DEFINITIONS = [
  { id: "dashboard-fixture-def-fast-charge", module: "Charging Policy", risk: "High", name: "fast_charge_current" },
  { id: "dashboard-fixture-def-thermal-limit", module: "Thermal", risk: "High", name: "thermal_limit_c" },
  { id: "dashboard-fixture-def-idle-timeout", module: "Power Management", risk: "Medium", name: "idle_timeout_s" },
  { id: "dashboard-fixture-def-log-level", module: "Diagnostics", risk: "Low", name: "log_level" },
  { id: "dashboard-fixture-def-bms-threshold", module: "BMS", risk: "Medium", name: "bms_alert_threshold" }
] as const;

export const PARAMETER_DASHBOARD_FIXTURE = {
  organizationId: ORG_ID,
  organizationName: ORG_NAME,
  activeUserId: ACTIVE_USER_ID,
  projectIds: {
    aurora: PROJECTS[0].id,
    zephyr: PROJECTS[1].id,
    nebula: PROJECTS[2].id
  }
} as const;

function daysAgo(days: number) {
  const date = new Date("2026-07-07T12:00:00.000Z");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

async function deleteOrgDashboardData(db: Database) {
  await db.query("delete from parameter_history_entries where organization_id = $1", [ORG_ID]);
  await db.query("delete from parameter_review_decisions where organization_id = $1", [ORG_ID]);
  await db.query("delete from parameter_submission_items where organization_id = $1", [ORG_ID]);
  await db.query("delete from parameter_change_requests where organization_id = $1", [ORG_ID]);
  await db.query("delete from parameter_submission_rounds where organization_id = $1", [ORG_ID]);
  await db.query("delete from parameter_drafts where organization_id = $1", [ORG_ID]);
  await db.query("delete from parameter_import_batches where organization_id = $1", [ORG_ID]);
  await db.query("delete from project_parameter_values where organization_id = $1", [ORG_ID]);
  await db.query("delete from parameter_definitions where organization_id = $1", [ORG_ID]);
  await db.query("delete from project_modules where organization_id = $1", [ORG_ID]);

  // Semantic topology FKs block project/file deletes after migration 0048/0050.
  await db.query(
    `delete from identity_mapping_tasks
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `delete from dts_property_occurrence_spec_decisions
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `delete from parameter_spec_matcher_overrides
     where project_id in (select id from projects where organization_id = $1)
        or source_review_task_id in (
          select id from parameter_spec_review_tasks
          where project_id in (select id from projects where organization_id = $1)
        )`,
    [ORG_ID]
  );
  await db.query(
    `delete from parameter_spec_review_tasks
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `delete from project_parameter_binding_revisions
     where binding_id in (
       select id from project_parameter_bindings
       where project_id in (select id from projects where organization_id = $1)
     )`,
    [ORG_ID]
  );
  await db.query(
    `delete from project_parameter_bindings
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `update project_parameter_files
     set current_version_id = null, config_set_id = null
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `delete from dts_release_baseline
     where config_set_id in (
       select id from dts_config_set
       where project_id in (select id from projects where organization_id = $1)
     )`,
    [ORG_ID]
  );
  await db.query(
    `delete from dts_config_set
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `delete from dts_logical_nodes
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `delete from dts_sensitive_node_rules
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );
  await db.query(
    `delete from project_parameter_file_versions
     where file_id in (
       select id from project_parameter_files
       where project_id in (select id from projects where organization_id = $1)
     )`,
    [ORG_ID]
  );
  await db.query(
    `delete from project_parameter_files
     where project_id in (select id from projects where organization_id = $1)`,
    [ORG_ID]
  );

  await db.query("delete from projects where organization_id = $1", [ORG_ID]);
  await db.query("delete from users where organization_id = $1 and id = $2", [ORG_ID, INACTIVE_USER_ID]);
}

export async function seedParameterDashboardFixture(db: Database) {
  await deleteOrgDashboardData(db);

  await db.query(
    `insert into organizations (id, name) values ($1, $2)
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID, ORG_NAME]
  );

  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Dashboard Admin', 'admin@dashboard-fixture.invalid', 'Platform Owner', true)
     on conflict (id) do update set
       organization_id = excluded.organization_id,
       name = excluded.name,
       email = excluded.email,
       title = excluded.title,
       is_active = excluded.is_active`,
    [ACTIVE_USER_ID, ORG_ID]
  );

  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Inactive User', 'inactive@dashboard-fixture.invalid', 'Former Member', false)
     on conflict (id) do update set
       organization_id = excluded.organization_id,
       name = excluded.name,
       email = excluded.email,
       title = excluded.title,
       is_active = excluded.is_active`,
    [INACTIVE_USER_ID, ORG_ID]
  );

  for (const project of PROJECTS) {
    await db.query(
      `insert into projects (id, organization_id, name, code, status)
       values ($1, $2, $3, $4, 'initialized')`,
      [project.id, ORG_ID, project.name, project.code]
    );
  }

  for (const definition of DEFINITIONS) {
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format,
         module, default_range, unit, risk
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        definition.id,
        ORG_ID,
        definition.name,
        `${definition.name} description`,
        `${definition.name} explanation`,
        `ENV: ${definition.name.toUpperCase()}=number`,
        definition.module,
        "0 - 100",
        "unit",
        definition.risk
      ]
    );
  }

  let valueIndex = 0;
  for (const project of PROJECTS) {
    for (const definition of DEFINITIONS) {
      valueIndex += 1;
      const valueId = `ppv-${project.id}-${definition.id}`;
      const current = String(100 + valueIndex * 10);
      const recommended = String(90 + valueIndex * 10);
      await db.query(
        `insert into project_parameter_values (
           id, organization_id, project_id, parameter_definition_id,
           current_value, ${LEGACY_SQL.recommendedValueColumn}, value_version, updated_by_user_id
         ) values ($1, $2, $3, $4, $5, $6, 1, $7)`,
        [valueId, ORG_ID, project.id, definition.id, current, recommended, ACTIVE_USER_ID]
      );
    }
  }

  const historyDays = [1, 3, 5, 8, 12, 15, 18, 22, 25, 28];
  let historyIndex = 0;
  for (const days of historyDays) {
    const project = PROJECTS[historyIndex % PROJECTS.length];
    const definition = DEFINITIONS[historyIndex % DEFINITIONS.length];
    historyIndex += 1;
    const valueId = `ppv-${project.id}-${definition.id}`;
    await db.query(
      `insert into parameter_history_entries (
         id, organization_id, project_id, parameter_definition_id,
         project_parameter_value_id, version, value, changed_by_user_id, changed_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        `dashboard-fixture-hist-${historyIndex}`,
        ORG_ID,
        project.id,
        definition.id,
        valueId,
        1,
        String(100 + historyIndex),
        ACTIVE_USER_ID,
        daysAgo(days)
      ]
    );
  }

  const changeRequests = [
    { id: "dashboard-fixture-cr-submitted", projectId: PROJECTS[0].id, defId: DEFINITIONS[0].id, status: "submitted", days: 2 },
    { id: "dashboard-fixture-cr-hardware", projectId: PROJECTS[1].id, defId: DEFINITIONS[1].id, status: "hardware_review", days: 4 },
    { id: "dashboard-fixture-cr-rejected", projectId: PROJECTS[0].id, defId: DEFINITIONS[2].id, status: "rejected", days: 6 },
    { id: "dashboard-fixture-cr-merge", projectId: PROJECTS[2].id, defId: DEFINITIONS[4].id, status: "software_merge", days: 9 },
    { id: "dashboard-fixture-cr-merged", projectId: PROJECTS[1].id, defId: DEFINITIONS[3].id, status: "merged", days: 11 }
  ] as const;

  for (const request of changeRequests) {
    const valueId = `ppv-${request.projectId}-${request.defId}`;
    await db.query(
      `insert into parameter_change_requests (
         id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
         base_version, current_value, target_value, status, submitter_user_id, created_at
       ) values ($1, $2, $3, $4, $5, 1, '100', '110', $6, $7, $8)`,
      [
        request.id,
        ORG_ID,
        request.projectId,
        valueId,
        request.defId,
        request.status,
        ACTIVE_USER_ID,
        daysAgo(request.days)
      ]
    );
  }

  await db.query(
    `insert into parameter_drafts (
       id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason
     ) values ($1, $2, $3, $4, $5, '200', 'dashboard fixture draft')`,
    [
      "dashboard-fixture-draft-1",
      ORG_ID,
      PROJECTS[0].id,
      `ppv-${PROJECTS[0].id}-${DEFINITIONS[0].id}`,
      ACTIVE_USER_ID
    ]
  );

  await db.query(
    `insert into parameter_drafts (
       id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason
     ) values ($1, $2, $3, $4, $5, '150', 'dashboard fixture draft 2')`,
    [
      "dashboard-fixture-draft-2",
      ORG_ID,
      PROJECTS[1].id,
      `ppv-${PROJECTS[1].id}-${DEFINITIONS[1].id}`,
      ACTIVE_USER_ID
    ]
  );

  await db.query(
    `insert into parameter_import_batches (
       id, organization_id, project_id, created_by_user_id, source_name, status, summary, items
     ) values ($1, $2, $3, $4, 'fixture-import.csv', 'previewed', '{}'::jsonb, '[]'::jsonb)`,
    ["dashboard-fixture-import-batch-unapplied", ORG_ID, PROJECTS[0].id, ACTIVE_USER_ID]
  );

  await db.query(
    `insert into parameter_review_decisions (
       id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status, created_at
     ) values ($1, $2, $3, $4, 'advance', 'hardware_review', 'software_review', $5)`,
    [
      "dashboard-fixture-review-decision-1",
      ORG_ID,
      "dashboard-fixture-cr-merged",
      ACTIVE_USER_ID,
      daysAgo(10)
    ]
  );
  await db.query(
    `insert into parameter_review_decisions (
       id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status, created_at
     ) values ($1, $2, $3, $4, 'reject', 'hardware_review', 'rejected', $5)`,
    [
      "dashboard-fixture-review-decision-2",
      ORG_ID,
      "dashboard-fixture-cr-rejected",
      ACTIVE_USER_ID,
      daysAgo(5)
    ]
  );
}

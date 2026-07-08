import type { Database } from "../shared/database/client";

const ORG_ID = "org-chargelab";
const ORG_NAME = "ChargeLab";
const ACTIVE_USER_ID = "u-xu-yun";
const INACTIVE_USER_ID = "u-dashboard-inactive";

const PROJECTS = [
  { id: "aurora", code: "AUR-Prod", name: "Aurora Production" },
  { id: "zephyr", code: "ZEP-Dev", name: "Zephyr Dev" },
  { id: "nebula", code: "NEB-Stg", name: "Nebula Staging" }
] as const;

const DEFINITIONS = [
  { id: "def-fast-charge", module: "Charging Policy", risk: "High", name: "fast_charge_current" },
  { id: "def-thermal-limit", module: "Thermal", risk: "High", name: "thermal_limit_c" },
  { id: "def-idle-timeout", module: "Power Management", risk: "Medium", name: "idle_timeout_s" },
  { id: "def-log-level", module: "Diagnostics", risk: "Low", name: "log_level" },
  { id: "def-bms-threshold", module: "BMS", risk: "Medium", name: "bms_alert_threshold" }
] as const;

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
     values ($1, $2, 'Xu Yun', 'xu@chargelab.cn', 'Platform Owner', true)
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
     values ($1, $2, 'Inactive User', 'inactive@chargelab.cn', 'Former Member', false)
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
           current_value, recommended_value, value_version, updated_by_user_id
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
        `hist-${historyIndex}`,
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
    { id: "cr-submitted", projectId: "aurora", defId: "def-fast-charge", status: "submitted", days: 2 },
    { id: "cr-hardware", projectId: "zephyr", defId: "def-thermal-limit", status: "hardware_review", days: 4 },
    { id: "cr-rejected", projectId: "aurora", defId: "def-idle-timeout", status: "rejected", days: 6 },
    { id: "cr-merge", projectId: "nebula", defId: "def-bms-threshold", status: "software_merge", days: 9 },
    { id: "cr-merged", projectId: "zephyr", defId: "def-log-level", status: "merged", days: 11 }
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
    ["draft-1", ORG_ID, "aurora", "ppv-aurora-def-fast-charge", ACTIVE_USER_ID]
  );

  await db.query(
    `insert into parameter_drafts (
       id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason
     ) values ($1, $2, $3, $4, $5, '150', 'dashboard fixture draft 2')`,
    ["draft-2", ORG_ID, "zephyr", "ppv-zephyr-def-thermal-limit", ACTIVE_USER_ID]
  );

  await db.query(
    `insert into parameter_import_batches (
       id, organization_id, project_id, created_by_user_id, source_name, status, summary, items
     ) values ($1, $2, $3, $4, 'fixture-import.csv', 'previewed', '{}'::jsonb, '[]'::jsonb)`,
    ["import-batch-unapplied", ORG_ID, "aurora", ACTIVE_USER_ID]
  );

  await db.query(
    `insert into parameter_review_decisions (
       id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status, created_at
     ) values ($1, $2, $3, $4, 'advance', 'hardware_review', 'software_review', $5)`,
    ["review-decision-1", ORG_ID, "cr-merged", ACTIVE_USER_ID, daysAgo(10)]
  );
  await db.query(
    `insert into parameter_review_decisions (
       id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status, created_at
     ) values ($1, $2, $3, $4, 'reject', 'hardware_review', 'rejected', $5)`,
    ["review-decision-2", ORG_ID, "cr-rejected", ACTIVE_USER_ID, daysAgo(5)]
  );
}

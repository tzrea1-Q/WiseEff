import "dotenv/config";
import { pathToFileURL } from "node:url";

import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase, type Database, type Queryable } from "../server/shared/database/client";
import {
  assertVisualReviewFixtureConfigured,
  assertVisualReviewFixtureDatabase
} from "./quality-visual-review-authorization";

const FIXTURE_REQUEST_ID = "PRQ-8910";
const FIXTURE_ROUND_ID = "PSR-2026-08-22-001";
const FIXTURE_ITEM_ID = "PSI-2026-08-22-001";
const FIXTURE_SPECIFICATION_KEY = "vendor/nodename/battery0/cccv_0";
const FIXTURE_TARGET_VALUE = "<4600 0>";
const FIXTURE_STATUS = "hardware_review";
const FIXTURE_SUBMITTER_USER_ID = "u-zhao-heng";
const FIXTURE_HARDWARE_COMMITTER_USER_ID = "u-wang-jie";
const FIXTURE_SOFTWARE_COMMITTER_USER_ID = "u-sun-mei";
const FIXTURE_SOFTWARE_USER_ID = "u-liu-min";
const FIXTURE_TIMESTAMP = "2026-08-22T08:00:00.000Z";
const FIXTURE_ROUND_SUMMARY = "Aurora 快充参数审阅";
const FIXTURE_ITEM_REASON = "将 Aurora 电池 CCCV 起始电压从 4500 调整为 4600";

type BindingFixtureRow = {
  binding_id: string;
  parameter_spec_id: string;
  current_value: string;
};

type FixtureCollisionRow = Record<string, string | number | boolean | null>;

function assertExactFixtureRow(
  table: string,
  id: string,
  row: FixtureCollisionRow | undefined,
  expected: FixtureCollisionRow
) {
  if (!row) return false;
  const differs = Object.entries(expected).some(([key, value]) => row[key] !== value);
  if (differs) {
    throw new Error(`Refusing to overwrite non-fixture ${table} row ${id}.`);
  }
  return true;
}

async function cleanupQualityVisualReviewRows(db: Queryable) {
  await assertVisualReviewFixtureDatabase(db);

  const requestResult = await db.query<FixtureCollisionRow>(
    `
    select
      cr.organization_id,
      cr.submission_round_id,
      cr.project_id,
      cr.base_version,
      cr.current_value = fixture_binding.current_value as current_value_matches_binding,
      cr.target_value,
      cr.status,
      cr.submitter_user_id,
      cr.assigned_to_user_id,
      cr.workflow_hardware_committer_user_id,
      cr.workflow_software_committer_user_id,
      cr.workflow_software_user_id,
      cr.reviewer_note,
      cr.reject_reason,
      cr.fast_track,
      cr.action,
      ps.specification_key,
      (
        cr.parameter_spec_id = fixture_binding.parameter_spec_id
        and cr.project_parameter_binding_id = fixture_binding.binding_id
      ) as binding_matches_seed_selection,
      cr.base_config_revision_id,
      cr.binding_revision_id,
      cr.property_occurrence_id,
      cr.source_file_version_id,
      cr.expected_checksum,
      cr.occurrence_span,
      cr.candidate_config_revision_id,
      cr.edit_subject_kind,
      cr.logical_node_id,
      cr.created_at = $2::timestamptz as created_at_matches,
      cr.updated_at = $2::timestamptz as updated_at_matches
    from parameter_change_requests cr
    left join parameter_specs ps on ps.id = cr.parameter_spec_id
    left join lateral (
      select
        b.id as binding_id,
        b.parameter_spec_id,
        current_revision.raw_value as current_value
      from project_parameter_bindings b
      inner join parameter_specs fixture_spec on fixture_spec.id = b.parameter_spec_id
      inner join lateral (
        select r.raw_value
        from project_parameter_binding_revisions r
        where r.binding_id = b.id
          and r.raw_value is not null
        order by r.created_at desc, r.id desc
        limit 1
      ) current_revision on true
      where b.organization_id = 'org-chargelab'
        and b.project_id = 'aurora'
        and fixture_spec.specification_key = $3
      order by b.id
      limit 1
    ) fixture_binding on true
    where cr.id = $1
    `,
    [FIXTURE_REQUEST_ID, FIXTURE_TIMESTAMP, FIXTURE_SPECIFICATION_KEY]
  );
  const roundResult = await db.query<FixtureCollisionRow>(
    `
    select
      organization_id,
      project_id,
      submitter_user_id,
      status,
      summary,
      created_at = $2::timestamptz as created_at_matches,
      updated_at = $2::timestamptz as updated_at_matches
    from parameter_submission_rounds
    where id = $1
    `,
    [FIXTURE_ROUND_ID, FIXTURE_TIMESTAMP]
  );
  const itemResult = await db.query<FixtureCollisionRow>(
    `
    select
      item.organization_id,
      item.submission_round_id,
      item.change_request_id,
      item.current_value = request.current_value as current_value_matches_request,
      item.target_value,
      item.reason,
      item.project_parameter_binding_id = request.project_parameter_binding_id as binding_matches_request,
      item.action,
      item.candidate_config_revision_id,
      item.edit_subject_kind,
      item.logical_node_id
    from parameter_submission_items item
    left join parameter_change_requests request on request.id = item.change_request_id
    where item.id = $1
    `,
    [FIXTURE_ITEM_ID]
  );

  const requestPresent = assertExactFixtureRow(
    "parameter_change_requests",
    FIXTURE_REQUEST_ID,
    requestResult.rows[0],
    {
      organization_id: "org-chargelab",
      submission_round_id: FIXTURE_ROUND_ID,
      project_id: "aurora",
      base_version: 1,
      current_value_matches_binding: true,
      target_value: FIXTURE_TARGET_VALUE,
      status: FIXTURE_STATUS,
      submitter_user_id: FIXTURE_SUBMITTER_USER_ID,
      assigned_to_user_id: FIXTURE_HARDWARE_COMMITTER_USER_ID,
      workflow_hardware_committer_user_id: FIXTURE_HARDWARE_COMMITTER_USER_ID,
      workflow_software_committer_user_id: FIXTURE_SOFTWARE_COMMITTER_USER_ID,
      workflow_software_user_id: FIXTURE_SOFTWARE_USER_ID,
      reviewer_note: null,
      reject_reason: null,
      fast_track: false,
      action: "set",
      specification_key: FIXTURE_SPECIFICATION_KEY,
      binding_matches_seed_selection: true,
      base_config_revision_id: null,
      binding_revision_id: null,
      property_occurrence_id: null,
      source_file_version_id: null,
      expected_checksum: null,
      occurrence_span: null,
      candidate_config_revision_id: null,
      edit_subject_kind: "binding",
      logical_node_id: null,
      created_at_matches: true,
      updated_at_matches: true
    }
  );
  const roundPresent = assertExactFixtureRow(
    "parameter_submission_rounds",
    FIXTURE_ROUND_ID,
    roundResult.rows[0],
    {
      organization_id: "org-chargelab",
      project_id: "aurora",
      submitter_user_id: FIXTURE_SUBMITTER_USER_ID,
      status: FIXTURE_STATUS,
      summary: FIXTURE_ROUND_SUMMARY,
      created_at_matches: true,
      updated_at_matches: true
    }
  );
  const itemPresent = assertExactFixtureRow(
    "parameter_submission_items",
    FIXTURE_ITEM_ID,
    itemResult.rows[0],
    {
      organization_id: "org-chargelab",
      submission_round_id: FIXTURE_ROUND_ID,
      change_request_id: FIXTURE_REQUEST_ID,
      current_value_matches_request: true,
      target_value: FIXTURE_TARGET_VALUE,
      reason: FIXTURE_ITEM_REASON,
      binding_matches_request: true,
      action: "set",
      candidate_config_revision_id: null,
      edit_subject_kind: "binding",
      logical_node_id: null
    }
  );

  if (requestPresent) {
    await db.query(`delete from parameter_review_decisions where request_id = $1`, [FIXTURE_REQUEST_ID]);
  }
  if (itemPresent) {
    await db.query(
      `delete from parameter_submission_items where id = $1 and change_request_id = $2`,
      [FIXTURE_ITEM_ID, FIXTURE_REQUEST_ID]
    );
  }
  if (requestPresent) {
    await db.query(`update parameter_history_entries set request_id = null where request_id = $1`, [FIXTURE_REQUEST_ID]);
    await db.query(`delete from parameter_change_requests where id = $1`, [FIXTURE_REQUEST_ID]);
  }
  if (roundPresent) {
    await db.query(`delete from parameter_submission_rounds where id = $1`, [FIXTURE_ROUND_ID]);
  }
}

export async function cleanupQualityVisualReview(db: Database) {
  assertVisualReviewFixtureConfigured();
  return db.transaction(cleanupQualityVisualReviewRows);
}

/**
 * Seed one product-shaped, quality-only review row after the normal M1 seed.
 * The visual gate needs a populated review workbench as well as the empty-state
 * coverage held by component tests. Cleanup is restricted to the request,
 * submission round, and submission item fixture identities before recreation.
 */
export async function seedQualityVisualReview(db: Database) {
  assertVisualReviewFixtureConfigured();
  return db.transaction(async (tx) => {
    await cleanupQualityVisualReviewRows(tx);

    const binding = await tx.query<BindingFixtureRow>(
      `
      select
        b.id as binding_id,
        b.parameter_spec_id,
        current_revision.raw_value as current_value
      from project_parameter_bindings b
      inner join parameter_specs ps on ps.id = b.parameter_spec_id
      inner join lateral (
        select r.raw_value
        from project_parameter_binding_revisions r
        where r.binding_id = b.id
          and r.raw_value is not null
        order by r.created_at desc, r.id desc
        limit 1
      ) current_revision on true
      where b.organization_id = 'org-chargelab'
        and b.project_id = 'aurora'
        and ps.specification_key = $1
      order by b.id
      limit 1
      `,
      [FIXTURE_SPECIFICATION_KEY]
    );
    const selected = binding.rows[0];
    if (!selected) {
      throw new Error(
        `Quality visual review fixture requires the seeded Aurora binding ${FIXTURE_SPECIFICATION_KEY}.`
      );
    }

    await tx.query(
      `
      insert into parameter_submission_rounds (
        id, organization_id, project_id, submitter_user_id, status, summary, created_at, updated_at
      ) values ($1, 'org-chargelab', 'aurora', $3, $4, $2, $5, $5)
      `,
      [
        FIXTURE_ROUND_ID,
        FIXTURE_ROUND_SUMMARY,
        FIXTURE_SUBMITTER_USER_ID,
        FIXTURE_STATUS,
        FIXTURE_TIMESTAMP
      ]
    );

    await tx.query(
      `
      insert into parameter_change_requests (
        id, organization_id, submission_round_id, project_id,
        base_version, current_value, target_value, status, submitter_user_id,
        assigned_to_user_id, workflow_hardware_committer_user_id,
        workflow_software_committer_user_id, workflow_software_user_id,
        parameter_spec_id, project_parameter_binding_id, action,
        created_at, updated_at
      ) values (
        $1, 'org-chargelab', $2, 'aurora',
        1, $5, $6, $7, $8,
        $9, $9, $10, $11,
        $3, $4, 'set',
        $12, $12
      )
      `,
      [
        FIXTURE_REQUEST_ID,
        FIXTURE_ROUND_ID,
        selected.parameter_spec_id,
        selected.binding_id,
        selected.current_value,
        FIXTURE_TARGET_VALUE,
        FIXTURE_STATUS,
        FIXTURE_SUBMITTER_USER_ID,
        FIXTURE_HARDWARE_COMMITTER_USER_ID,
        FIXTURE_SOFTWARE_COMMITTER_USER_ID,
        FIXTURE_SOFTWARE_USER_ID,
        FIXTURE_TIMESTAMP
      ]
    );

    await tx.query(
      `
      insert into parameter_submission_items (
        id, organization_id, submission_round_id, change_request_id,
        current_value, target_value, reason, project_parameter_binding_id, action
      ) values (
        $1, 'org-chargelab', $2, $3,
        $4, $5, $7, $6, 'set'
      )
      `,
      [
        FIXTURE_ITEM_ID,
        FIXTURE_ROUND_ID,
        FIXTURE_REQUEST_ID,
        selected.current_value,
        FIXTURE_TARGET_VALUE,
        selected.binding_id,
        FIXTURE_ITEM_REASON
      ]
    );

    return { requestId: FIXTURE_REQUEST_ID, roundId: FIXTURE_ROUND_ID, bindingId: selected.binding_id };
  });
}

async function main() {
  assertVisualReviewFixtureConfigured();
  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed the quality visual review fixture.");
  }
  const db = createPostgresDatabase(env.DATABASE_URL);
  if (process.argv.includes("--cleanup")) {
    await cleanupQualityVisualReview(db);
    console.log(`Removed deterministic quality review fixture ${FIXTURE_REQUEST_ID}.`);
    return;
  }
  const seeded = await seedQualityVisualReview(db);
  console.log(`Seeded deterministic quality review fixture ${seeded.requestId} on ${seeded.bindingId}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

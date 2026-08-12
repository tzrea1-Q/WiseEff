/**
 * Behavior-level integration coverage for the parameter review workflow:
 * submitParameterChanges → reviewChange (advance/reject) → merge.
 *
 * Replaces the fake-db/SQL-text blocks that used to live in service.test.ts.
 * Asserts returned DTOs, subsequent reads through service/repository functions,
 * and audit/history rows — never SQL text.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Queryable } from "../../shared/database/client";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { resolveParameterIdentityMode, setParameterIdentityMode } from "./parameterIdentityMode";
import { insertFileSyncConflict } from "./fileSyncConflictRepository";
import { listReviewDecisions, updateChangeRequestStatus } from "./reviewWorkflowRepository";
import {
  listChangeRequests,
  listDrafts,
  listSubmissionRounds,
  listWorkflowAssignees,
  reviewChange,
  saveDraft,
  submitParameterChanges
} from "./service";

const ORG = "org-srw";
const PROJECT = "project-srw";
const OTHER_PROJECT = "project-srw-other";

const USER = "user-srw-editor";
const HW = "user-srw-hardware";
const SWC = "user-srw-software-committer";
const SWU = "user-srw-software-user";
const OUTSIDER = "user-srw-outsider";

const PD_HIGH = "pd-srw-high";
const PPV_HIGH = "ppv-srw-high";
const HIGH_BASE_VERSION = 7;
const HIGH_CURRENT_VALUE = "3200";

const PD_MEDIUM = "pd-srw-medium";
const PPV_MEDIUM = "ppv-srw-medium";
const MEDIUM_BASE_VERSION = 3;
const MEDIUM_CURRENT_VALUE = "70";

const PD_VERSIONED = "pd-srw-versioned";
const PPV_VERSIONED = "ppv-srw-versioned";
const VERSIONED_BASE_VERSION = 42;

const MERGE_LINK = "https://example.com/mr/srw-merge";

const completeAssignees = {
  hardwareCommitterId: HW,
  softwareCommitterId: SWC,
  softwareUserId: SWU
};

function authFor(
  userId: string,
  name: string,
  roles: AuthContext["roles"],
  permissions: AuthContext["permissions"]
): AuthContext {
  return {
    user: {
      id: userId,
      organizationId: ORG,
      name,
      email: `${userId}@example.com`,
      title: "SRW",
      isActive: true
    },
    organization: { id: ORG, name: "SRW Org" },
    roles,
    permissions
  };
}

/** Ordinary editor: submits changes and (as software-user) merges. */
function editorAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...authFor(
      USER,
      "SRW Editor",
      [{ projectId: PROJECT, roleId: "software-user" }],
      ["parameter:view", "parameter:edit"]
    ),
    ...overrides
  };
}

function hardwareAuth(): AuthContext {
  return authFor(
    HW,
    "SRW Hardware",
    [{ projectId: PROJECT, roleId: "hardware-committer" }],
    ["parameter:view", "parameter:edit", "parameter:review"]
  );
}

function softwareCommitterAuth(): AuthContext {
  return authFor(
    SWC,
    "SRW Software Committer",
    [{ projectId: PROJECT, roleId: "software-committer" }],
    ["parameter:view", "parameter:edit", "parameter:review"]
  );
}

async function seedUser(db: Queryable, id: string, name: string) {
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, $3, $4, 'SRW', true)
    on conflict (id) do update set organization_id = excluded.organization_id, name = excluded.name
    `,
    [id, ORG, name, `${id}@example.com`]
  );
}

async function seedRoleBinding(db: Queryable, userId: string, projectId: string, roleId: string) {
  await db.query(
    `
    insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
    values ($1, $2, $3, $4, $5)
    on conflict (id) do nothing
    `,
    [`urb-${userId}-${roleId}`, userId, ORG, projectId, roleId]
  );
}

async function seedParameter(
  db: Queryable,
  input: { definitionId: string; valueId: string; name: string; risk: string; valueVersion: number; currentValue: string }
) {
  await db.query(
    `
    insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values ($1, $2, $3, 'SRW parameter', 'SRW parameter', 'ENV', 'Charging Policy', '1 - 5000', 'mA', $4)
    on conflict (id) do update set risk = excluded.risk
    `,
    [input.definitionId, ORG, input.name, input.risk]
  );
  await db.query(
    `
    insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id
    ) values ($1, $2, $3, $4, $5, $5, $6, $7)
    on conflict (id) do update set current_value = excluded.current_value, value_version = excluded.value_version
    `,
    [input.valueId, ORG, PROJECT, input.definitionId, input.currentValue, input.valueVersion, USER]
  );
}

async function seedBaseline(db: Queryable) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'SRW Org') on conflict (id) do update set name = excluded.name`,
    [ORG]
  );
  for (const [id, name] of [
    [USER, "SRW Editor"],
    [HW, "SRW Hardware"],
    [SWC, "SRW Software Committer"],
    [SWU, "SRW Software User"],
    [OUTSIDER, "SRW Outsider"]
  ]) {
    await seedUser(db, id, name);
  }
  for (const projectId of [PROJECT, OTHER_PROJECT]) {
    await db.query(
      `
      insert into projects (id, organization_id, name, code, status)
      values ($1, $2, $1, 'SRW', 'initialized')
      on conflict (id) do update set status = excluded.status
      `,
      [projectId, ORG]
    );
  }
  await seedRoleBinding(db, USER, PROJECT, "software-user");
  await seedRoleBinding(db, HW, PROJECT, "hardware-committer");
  await seedRoleBinding(db, SWC, PROJECT, "software-committer");
  await seedRoleBinding(db, SWU, PROJECT, "software-user");
  await seedRoleBinding(db, OUTSIDER, OTHER_PROJECT, "hardware-committer");

  await seedParameter(db, {
    definitionId: PD_HIGH,
    valueId: PPV_HIGH,
    name: "fast_charge_current_limit_ma",
    risk: "High",
    valueVersion: HIGH_BASE_VERSION,
    currentValue: HIGH_CURRENT_VALUE
  });
  await seedParameter(db, {
    definitionId: PD_MEDIUM,
    valueId: PPV_MEDIUM,
    name: "thermal_guard_threshold_c",
    risk: "Medium",
    valueVersion: MEDIUM_BASE_VERSION,
    currentValue: MEDIUM_CURRENT_VALUE
  });
  await seedParameter(db, {
    definitionId: PD_VERSIONED,
    valueId: PPV_VERSIONED,
    name: "pack_voltage_limit_v",
    risk: "Low",
    valueVersion: VERSIONED_BASE_VERSION,
    currentValue: "400"
  });
}

async function countRows(db: Queryable, sql: string, values: unknown[]) {
  const result = await db.query<{ c: string }>(sql, values);
  return Number(result.rows[0]?.c ?? "0");
}

async function countSubmissionRounds(db: Queryable) {
  return countRows(
    db,
    `select count(*)::text as c from parameter_submission_rounds where organization_id = $1 and project_id = $2`,
    [ORG, PROJECT]
  );
}

async function readParameterValue(db: Queryable, valueId: string) {
  const result = await db.query<{ current_value: string; value_version: number }>(
    `select current_value, value_version from project_parameter_values where id = $1`,
    [valueId]
  );
  return result.rows[0];
}

async function readAuditEvents(db: Queryable, kind: string) {
  const result = await db.query<{ kind: string; action: string; target_id: string | null; trace_id: string }>(
    `
    select kind, action, target_id, trace_id
    from audit_events
    where organization_id = $1 and kind = $2
    order by created_at asc
    `,
    [ORG, kind]
  );
  return result.rows;
}

async function readChangeRequestStatus(db: Queryable, requestId: string) {
  const result = await db.query<{ status: string }>(
    `select status from parameter_change_requests where organization_id = $1 and id = $2`,
    [ORG, requestId]
  );
  return result.rows[0]?.status;
}

/** Submit one legacy item; returns the round plus the created change request id. */
async function submitOne(
  db: InMemoryTestDatabase,
  input: {
    parameterId: string;
    targetValue: string;
    assignees?: typeof completeAssignees;
    context?: { requestId: string };
  }
) {
  const round = await submitParameterChanges(
    db,
    editorAuth(),
    {
      projectId: PROJECT,
      items: [{ parameterId: input.parameterId, targetValue: input.targetValue, reason: "SRW change" }],
      assignees: input.assignees
    },
    input.context
  );
  const requestId = round.items[0]?.requestId;
  expect(requestId).toBeTruthy();
  return { round, requestId: requestId! };
}

/** Drive a medium-risk request submitted → software_review → software_merge through real reviews. */
async function advanceMediumToSoftwareMerge(db: InMemoryTestDatabase, requestId: string) {
  const toSoftwareReview = await reviewChange(db, hardwareAuth(), {
    requestId,
    decision: "advance",
    note: "SRW hardware stage pass"
  });
  expect(toSoftwareReview.status).toBe("software_review");
  const toSoftwareMerge = await reviewChange(db, softwareCommitterAuth(), {
    requestId,
    decision: "advance",
    note: "SRW software stage pass"
  });
  expect(toSoftwareMerge.status).toBe("software_merge");
}

function createStubObjectStore(): ObjectStore {
  return {
    async put(input) {
      return {
        storageKey: `srw/${input.fileName}`,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: "srw-checksum"
      };
    },
    async get() {
      return Buffer.alloc(0);
    }
  };
}

/**
 * Simulate a completed identity cutover mid-test. Legacy flat tables stay in
 * place (they are only renamed by the real cutover tooling), but the cutover
 * marker row flips mustUseSemanticParameterIdentity() to true.
 */
async function markIdentityCutoverComplete(db: Queryable) {
  const runId = `pimr-srw-${randomUUID().slice(0, 8)}`;
  await db.query(
    `
    insert into parameter_identity_migration_runs (id, mode, status, write_lock_confirmed)
    values ($1, 'apply', 'completed', true)
    `,
    [runId]
  );
  await db.query(`insert into parameter_identity_cutovers (id, migration_run_id) values ($1, $2)`, [
    `pic-srw-${randomUUID().slice(0, 8)}`,
    runId
  ]);
  await resolveParameterIdentityMode(db);
}

const decisionStageRank: Record<string, number> = {
  submitted: 0,
  hardware_review: 1,
  software_review: 2,
  software_merge: 3
};

/**
 * All rows in a rollback-fixture test share one transaction timestamp, so
 * created_at ordering ties; sort decisions by workflow stage for stable asserts.
 */
async function readDecisionsByStage(db: Queryable, requestId: string) {
  const decisions = await listReviewDecisions(db, { organizationId: ORG, requestId });
  return [...decisions].sort(
    (left, right) => (decisionStageRank[left.fromStatus] ?? 99) - (decisionStageRank[right.fromStatus] ?? 99)
  );
}

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter review workflow behavior", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
    setParameterIdentityMode(null);
  });

  describe("workflow assignee discovery", () => {
    it("returns only project-scoped candidates grouped by workflow role", async () => {
      const assignees = await listWorkflowAssignees(db!, editorAuth(), PROJECT);

      expect(assignees).toEqual({
        hardwareCommitters: [{ id: HW, name: "SRW Hardware" }],
        softwareCommitters: [{ id: SWC, name: "SRW Software Committer" }],
        softwareUsers: [
          { id: USER, name: "SRW Editor" },
          { id: SWC, name: "SRW Software Committer" },
          { id: SWU, name: "SRW Software User" }
        ]
      });
      // OUTSIDER holds hardware-committer only on OTHER_PROJECT and must not leak in.
      expect(assignees.hardwareCommitters.map((candidate) => candidate.id)).not.toContain(OUTSIDER);
    });

    it("rejects callers without parameter edit permission", async () => {
      await expect(
        listWorkflowAssignees(db!, editorAuth({ permissions: ["parameter:view"] }), PROJECT)
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });
  });

  describe("submitParameterChanges", () => {
    it("creates one round with a change request per item, consumes drafts, and audits the round", async () => {
      await saveDraft(db!, editorAuth(), {
        projectId: PROJECT,
        parameterId: PPV_HIGH,
        targetValue: "3100",
        reason: "Reduce thermal risk."
      });

      const round = await submitParameterChanges(
        db!,
        editorAuth(),
        {
          projectId: PROJECT,
          reason: "Tune charging parameters",
          items: [
            { parameterId: PPV_HIGH, targetValue: "3100", reason: "Reduce thermal risk." },
            { parameterId: PPV_MEDIUM, targetValue: "68", reason: "Match new cell pack." }
          ]
        },
        { requestId: "request-parameter-submit-1" }
      );

      expect(round).toMatchObject({
        projectId: PROJECT,
        status: "submitted",
        summary: "Tune charging parameters",
        submitter: "SRW Editor"
      });
      expect(round.items).toHaveLength(2);
      expect(round.items.map((item) => ({ parameterId: item.parameterId, targetValue: item.targetValue }))).toEqual([
        { parameterId: PPV_HIGH, targetValue: "3100" },
        { parameterId: PPV_MEDIUM, targetValue: "68" }
      ]);
      expect(new Set(round.items.map((item) => item.requestId)).size).toBe(2);

      const requests = await listChangeRequests(db!, editorAuth(), { projectId: PROJECT });
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.status === "submitted")).toBe(true);
      expect(requests.every((request) => request.submissionRoundId === round.id)).toBe(true);

      // The pre-submit draft was consumed by the submission.
      await expect(listDrafts(db!, editorAuth(), { projectId: PROJECT })).resolves.toEqual([]);

      const audits = await readAuditEvents(db!, "parameter-submit");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "submit",
        target_id: round.id,
        trace_id: "request-parameter-submit-1"
      });
    });

    it("routes to hardware review and persists reviewer plus workflow assignee state when assignees are given", async () => {
      const { round, requestId } = await submitOne(db!, {
        parameterId: PPV_HIGH,
        targetValue: "3100",
        assignees: completeAssignees
      });

      expect(round).toMatchObject({ status: "hardware_review", workflowAssignees: completeAssignees });

      const requests = await listChangeRequests(db!, editorAuth(), { projectId: PROJECT });
      const request = requests.find((candidate) => candidate.id === requestId);
      expect(request).toMatchObject({
        status: "hardware_review",
        assignedTo: HW,
        workflowAssignees: completeAssignees
      });
    });

    it("accepts a software committer as the software developer workflow assignee", async () => {
      const assignees = { hardwareCommitterId: HW, softwareCommitterId: SWC, softwareUserId: SWC };
      const { round } = await submitOne(db!, {
        parameterId: PPV_HIGH,
        targetValue: "3100",
        assignees
      });

      expect(round).toMatchObject({ status: "hardware_review", workflowAssignees: assignees });
    });

    it("rejects an assignee lacking the project workflow role before any writes", async () => {
      await expect(
        submitParameterChanges(db!, editorAuth(), {
          projectId: PROJECT,
          items: [{ parameterId: PPV_HIGH, targetValue: "3100", reason: "SRW change" }],
          assignees: { hardwareCommitterId: SWU, softwareCommitterId: SWC, softwareUserId: SWU }
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "Workflow assignee is not eligible for the requested role."
      });

      await expect(countSubmissionRounds(db!)).resolves.toBe(0);
    });

    it("rejects partial workflow assignees before any writes", async () => {
      await expect(
        submitParameterChanges(db!, editorAuth(), {
          projectId: PROJECT,
          items: [{ parameterId: PPV_HIGH, targetValue: "3100", reason: "SRW change" }],
          assignees: { hardwareCommitterId: HW }
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "Workflow assignees must include all review roles or be omitted."
      });

      await expect(countSubmissionRounds(db!)).resolves.toBe(0);
    });

    it("conflicts when the parameter already has an open change request", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_HIGH, targetValue: "3100" });

      await expect(
        submitParameterChanges(db!, editorAuth(), {
          projectId: PROJECT,
          items: [{ parameterId: PPV_HIGH, targetValue: "3050", reason: "SRW retry" }]
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: "Parameter already has an open change request.",
        details: { parameterId: PPV_HIGH, requestId }
      });

      await expect(countSubmissionRounds(db!)).resolves.toBe(1);
    });

    it("conflicts when the parameter has an open file sync conflict", async () => {
      const draft = await saveDraft(db!, editorAuth(), {
        projectId: PROJECT,
        parameterId: PPV_HIGH,
        targetValue: "3100",
        reason: "SRW draft"
      });
      const fileId = `file-srw-${randomUUID().slice(0, 8)}`;
      const fileVersionId = `fv-srw-${randomUUID().slice(0, 8)}`;
      await db!.query(
        `
        insert into project_parameter_files (id, organization_id, project_id, file_name, format)
        values ($1, $2, $3, 'srw-sync.dts', 'dts')
        `,
        [fileId, ORG, PROJECT]
      );
      await db!.query(
        `
        insert into project_parameter_file_versions (id, file_id, version_number, storage_key, checksum, size_bytes, origin)
        values ($1, $2, 1, 'srw/sync', 'srw-sync-checksum', 1, 'upload')
        `,
        [fileVersionId, fileId]
      );
      await insertFileSyncConflict(db!, {
        id: `conflict-srw-${randomUUID().slice(0, 8)}`,
        organizationId: ORG,
        projectId: PROJECT,
        projectParameterValueId: PPV_HIGH,
        parameterDefinitionId: PD_HIGH,
        fileVersionId,
        fileDraftId: draft.id,
        uiDraftId: draft.id,
        fileValue: "3300",
        uiDraftValue: "3100"
      });

      await expect(
        submitParameterChanges(db!, editorAuth(), {
          projectId: PROJECT,
          items: [{ parameterId: PPV_HIGH, targetValue: "3100", reason: "SRW change" }]
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: "Parameter has an open file sync conflict."
      });

      await expect(countSubmissionRounds(db!)).resolves.toBe(0);
    });

    it("rejects duplicate parameter ids before any writes", async () => {
      await expect(
        submitParameterChanges(db!, editorAuth(), {
          projectId: PROJECT,
          items: [
            { parameterId: PPV_HIGH, targetValue: "3100", reason: "Reduce thermal risk." },
            { parameterId: PPV_HIGH, targetValue: "3050", reason: "Duplicate edit." }
          ]
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "Each parameter can only appear once per submission round.",
        details: { parameterId: PPV_HIGH }
      });

      await expect(countSubmissionRounds(db!)).resolves.toBe(0);
    });

    it("records the current value_version as the change request baseVersion", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_VERSIONED, targetValue: "410" });

      const requests = await listChangeRequests(db!, editorAuth(), { projectId: PROJECT });
      const request = requests.find((candidate) => candidate.id === requestId);
      expect(request?.baseVersion).toBe(VERSIONED_BASE_VERSION);
      expect(request?.currentValue).toBe("400");
    });
  });

  describe("reviewChange advance", () => {
    it("ordinary user cannot advance review", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_HIGH, targetValue: "3100" });

      await expect(
        reviewChange(db!, editorAuth(), { requestId, decision: "advance", note: "Looks good." })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
        message: "Parameter hardware review role is required for this project."
      });

      await expect(readChangeRequestStatus(db!, requestId)).resolves.toBe("submitted");
      await expect(listReviewDecisions(db!, { organizationId: ORG, requestId })).resolves.toEqual([]);
    });

    it("cross-project committer cannot advance review", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_HIGH, targetValue: "3100" });
      const crossProjectAuth = authFor(
        OUTSIDER,
        "SRW Outsider",
        [{ projectId: OTHER_PROJECT, roleId: "hardware-committer" }],
        ["parameter:view", "parameter:edit", "parameter:review"]
      );

      await expect(
        reviewChange(db!, crossProjectAuth, { requestId, decision: "advance", note: "Wrong project." })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
        message: "Parameter hardware review role is required for this project."
      });

      await expect(readChangeRequestStatus(db!, requestId)).resolves.toBe("submitted");
    });

    it("wrong-stage committer cannot advance review", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });
      // Medium risk: submitted advances straight to software_review.
      const advanced = await reviewChange(db!, hardwareAuth(), {
        requestId,
        decision: "advance",
        note: "SRW submitted stage pass"
      });
      expect(advanced.status).toBe("software_review");

      await expect(
        reviewChange(db!, hardwareAuth(), {
          requestId,
          decision: "advance",
          note: "Hardware committer at software stage."
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
        message: "Parameter software review role is required for this project."
      });

      await expect(readChangeRequestStatus(db!, requestId)).resolves.toBe("software_review");
    });

    it("hardware committer advances hardware review to software review with decision, round status, and audit", async () => {
      const { round, requestId } = await submitOne(db!, { parameterId: PPV_HIGH, targetValue: "3100" });
      const toHardware = await reviewChange(db!, hardwareAuth(), {
        requestId,
        decision: "advance",
        note: "Route high-risk request to hardware review."
      });
      expect(toHardware.status).toBe("hardware_review");

      const request = await reviewChange(
        db!,
        hardwareAuth(),
        { requestId, decision: "advance", note: "Hardware reviewed." },
        { requestId: "request-parameter-review-1" }
      );

      expect(request.status).toBe("software_review");

      const decisions = await readDecisionsByStage(db!, requestId);
      expect(decisions.map((decision) => ({ from: decision.fromStatus, to: decision.toStatus }))).toEqual([
        { from: "submitted", to: "hardware_review" },
        { from: "hardware_review", to: "software_review" }
      ]);
      expect(decisions[1]).toMatchObject({ decision: "advance", reviewerUserId: HW, note: "Hardware reviewed." });

      const rounds = await listSubmissionRounds(db!, editorAuth(), { projectId: PROJECT });
      expect(rounds.find((candidate) => candidate.id === round.id)?.status).toBe("software_review");

      const audits = await readAuditEvents(db!, "parameter-review-advance");
      expect(audits).toHaveLength(2);
      expect(audits).toContainEqual(
        expect.objectContaining({
          action: "advance",
          target_id: requestId,
          trace_id: "request-parameter-review-1"
        })
      );
    });

    it("software committer advances software review to software merge", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });
      const toSoftwareReview = await reviewChange(db!, hardwareAuth(), {
        requestId,
        decision: "advance",
        note: "SRW submitted stage pass"
      });
      expect(toSoftwareReview.status).toBe("software_review");

      const request = await reviewChange(db!, softwareCommitterAuth(), {
        requestId,
        decision: "advance",
        note: "Software reviewed."
      });

      expect(request.status).toBe("software_merge");
      await expect(readChangeRequestStatus(db!, requestId)).resolves.toBe("software_merge");
    });

    it("reject moves the request to rejected and records the reject reason", async () => {
      const { round, requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });

      const request = await reviewChange(db!, hardwareAuth(), {
        requestId,
        decision: "reject",
        note: "Value regresses thermal budget."
      });

      expect(request.status).toBe("rejected");
      expect(request.rejectReason).toBe("Value regresses thermal budget.");

      const decisions = await listReviewDecisions(db!, { organizationId: ORG, requestId });
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        decision: "reject",
        fromStatus: "submitted",
        toStatus: "rejected",
        reviewerUserId: HW
      });

      const rounds = await listSubmissionRounds(db!, editorAuth(), { projectId: PROJECT });
      expect(rounds.find((candidate) => candidate.id === round.id)?.status).toBe("rejected");

      const audits = await readAuditEvents(db!, "parameter-review-reject");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "reject", target_id: requestId });
    });
  });

  describe("merge", () => {
    it("software user merges a medium-risk request and the value, history, and audit reflect it", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });
      await advanceMediumToSoftwareMerge(db!, requestId);

      const request = await reviewChange(db!, editorAuth(), {
        requestId,
        decision: "advance",
        expectedVersion: MEDIUM_BASE_VERSION,
        note: MERGE_LINK
      });

      expect(request.status).toBe("merged");
      // The request DTO keeps the submit-time snapshot; the live value moves below.
      expect(request.currentValue).toBe(MEDIUM_CURRENT_VALUE);
      expect(request.targetValue).toBe("68");

      await expect(readParameterValue(db!, PPV_MEDIUM)).resolves.toEqual({
        current_value: "68",
        value_version: MEDIUM_BASE_VERSION + 1
      });

      const history = await db!.query<{ version: number; value: string }>(
        `select version, value from parameter_history_entries where organization_id = $1 and request_id = $2`,
        [ORG, requestId]
      );
      expect(history.rows).toEqual([{ version: MEDIUM_BASE_VERSION + 1, value: "68" }]);

      const audits = await readAuditEvents(db!, "parameter-merge");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "merge", target_id: requestId });
    });

    it("rejects merge without an http(s) merge link note", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });
      await advanceMediumToSoftwareMerge(db!, requestId);

      await expect(
        reviewChange(db!, editorAuth(), { requestId, decision: "advance", expectedVersion: MEDIUM_BASE_VERSION })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "Merge requires an http(s) merge link in note.",
        details: { requestId }
      });

      await expect(
        reviewChange(db!, editorAuth(), {
          requestId,
          decision: "advance",
          expectedVersion: MEDIUM_BASE_VERSION,
          note: "not a url"
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 400,
        message: "Merge requires an http(s) merge link in note."
      });

      await expect(readParameterValue(db!, PPV_MEDIUM)).resolves.toEqual({
        current_value: MEDIUM_CURRENT_VALUE,
        value_version: MEDIUM_BASE_VERSION
      });
    });

    it("cross-project software user cannot merge", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });
      await advanceMediumToSoftwareMerge(db!, requestId);
      const crossProjectAuth = authFor(
        OUTSIDER,
        "SRW Outsider",
        [{ projectId: OTHER_PROJECT, roleId: "software-user" }],
        ["parameter:view", "parameter:edit"]
      );

      await expect(
        reviewChange(db!, crossProjectAuth, {
          requestId,
          decision: "advance",
          expectedVersion: MEDIUM_BASE_VERSION,
          note: MERGE_LINK
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
        message: "Parameter merge role is required for this project."
      });

      await expect(readParameterValue(db!, PPV_MEDIUM)).resolves.toEqual({
        current_value: MEDIUM_CURRENT_VALUE,
        value_version: MEDIUM_BASE_VERSION
      });
    });

    it("high-risk request cannot merge unless prior hardware and software decisions exist", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_HIGH, targetValue: "3100" });
      // Force the request to the merge stage without recording any review decisions.
      const forced = await updateChangeRequestStatus(db!, {
        organizationId: ORG,
        requestId,
        status: "software_merge"
      });
      expect(forced?.status).toBe("software_merge");

      await expect(
        reviewChange(db!, editorAuth(), {
          requestId,
          decision: "advance",
          expectedVersion: HIGH_BASE_VERSION,
          note: MERGE_LINK
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: "High-risk parameter changes require hardware and software review before merge.",
        details: { requestId }
      });

      await expect(readParameterValue(db!, PPV_HIGH)).resolves.toEqual({
        current_value: HIGH_CURRENT_VALUE,
        value_version: HIGH_BASE_VERSION
      });
    });

    it("merge with a stale expectedVersion conflicts without recording a merge decision", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });
      await advanceMediumToSoftwareMerge(db!, requestId);

      await expect(
        reviewChange(db!, editorAuth(), {
          requestId,
          decision: "advance",
          expectedVersion: MEDIUM_BASE_VERSION - 1,
          note: MERGE_LINK
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: "Parameter value changed before merge.",
        details: { requestId }
      });

      await expect(readChangeRequestStatus(db!, requestId)).resolves.toBe("software_merge");
      const decisions = await listReviewDecisions(db!, { organizationId: ORG, requestId });
      expect(decisions.some((decision) => decision.toStatus === "merged")).toBe(false);
      await expect(readParameterValue(db!, PPV_MEDIUM)).resolves.toEqual({
        current_value: MEDIUM_CURRENT_VALUE,
        value_version: MEDIUM_BASE_VERSION
      });
    });

    it("high-risk request advances through hardware and software review before merging end-to-end", async () => {
      const { requestId } = await submitOne(db!, { parameterId: PPV_HIGH, targetValue: "3100" });

      const hardwareReview = await reviewChange(db!, hardwareAuth(), {
        requestId,
        decision: "advance",
        note: "Route high-risk request to hardware review."
      });
      const softwareReview = await reviewChange(db!, hardwareAuth(), {
        requestId,
        decision: "advance",
        note: "Hardware reviewed."
      });
      const softwareMerge = await reviewChange(db!, softwareCommitterAuth(), {
        requestId,
        decision: "advance",
        note: "Software reviewed."
      });
      const merged = await reviewChange(db!, editorAuth(), {
        requestId,
        decision: "advance",
        expectedVersion: HIGH_BASE_VERSION,
        note: MERGE_LINK
      });

      expect(hardwareReview.status).toBe("hardware_review");
      expect(softwareReview.status).toBe("software_review");
      expect(softwareMerge.status).toBe("software_merge");
      expect(merged.status).toBe("merged");

      await expect(readParameterValue(db!, PPV_HIGH)).resolves.toEqual({
        current_value: "3100",
        value_version: HIGH_BASE_VERSION + 1
      });
      const history = await db!.query<{ version: number; value: string }>(
        `select version, value from parameter_history_entries where organization_id = $1 and request_id = $2`,
        [ORG, requestId]
      );
      expect(history.rows).toEqual([{ version: HIGH_BASE_VERSION + 1, value: "3100" }]);

      const decisions = await readDecisionsByStage(db!, requestId);
      expect(decisions.map((decision) => ({ from: decision.fromStatus, to: decision.toStatus }))).toEqual([
        { from: "submitted", to: "hardware_review" },
        { from: "hardware_review", to: "software_review" },
        { from: "software_review", to: "software_merge" },
        { from: "software_merge", to: "merged" }
      ]);
      expect(decisions.at(-1)).toMatchObject({ reviewerUserId: USER, note: MERGE_LINK });

      const audits = await readAuditEvents(db!, "parameter-merge");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "merge", target_id: requestId });
    });
  });

  describe("post-cutover semantic merge fail-closed preflight", () => {
    async function requestAtSoftwareMergeThenCutover() {
      const { requestId } = await submitOne(db!, { parameterId: PPV_MEDIUM, targetValue: "68" });
      await advanceMediumToSoftwareMerge(db!, requestId);
      await markIdentityCutoverComplete(db!);
      return requestId;
    }

    async function expectMergeDidNotHappen(requestId: string) {
      await expect(readChangeRequestStatus(db!, requestId)).resolves.toBe("software_merge");
      await expect(
        countRows(
          db!,
          `select count(*)::text as c from parameter_history_entries where organization_id = $1 and request_id = $2`,
          [ORG, requestId]
        )
      ).resolves.toBe(0);
      await expect(readAuditEvents(db!, "parameter-merge")).resolves.toEqual([]);
    }

    it("rejects semantic merge when objectStore is missing", async () => {
      const requestId = await requestAtSoftwareMergeThenCutover();

      await expect(
        reviewChange(db!, editorAuth(), {
          requestId,
          decision: "advance",
          expectedVersion: MEDIUM_BASE_VERSION,
          note: MERGE_LINK
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: "Semantic merge requires object storage for DTS writeback.",
        details: { requestId }
      });

      await expectMergeDidNotHappen(requestId);
    });

    it("rejects semantic merge when binding write-lock identity is missing", async () => {
      const requestId = await requestAtSoftwareMergeThenCutover();

      // Legacy-era requests carry no binding/logical-node identity, so the
      // semantic preflight must fail closed even with object storage present.
      await expect(
        reviewChange(
          db!,
          editorAuth(),
          { requestId, decision: "advance", expectedVersion: MEDIUM_BASE_VERSION, note: MERGE_LINK },
          { objectStore: createStubObjectStore() }
        )
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: "Semantic merge requires a project parameter binding write lock.",
        details: { requestId }
      });

      await expectMergeDidNotHappen(requestId);
    });

    it("does not honor WISEEFF_WRITEBACK_SKIP_TOOLCHAIN env bypass", async () => {
      const previous = process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN;
      process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN = "1";
      try {
        const requestId = await requestAtSoftwareMergeThenCutover();

        await expect(
          reviewChange(db!, editorAuth(), {
            requestId,
            decision: "advance",
            expectedVersion: MEDIUM_BASE_VERSION,
            note: MERGE_LINK
          })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          status: 409,
          message: "Semantic merge requires object storage for DTS writeback."
        });

        await expectMergeDidNotHappen(requestId);
      } finally {
        if (previous === undefined) {
          delete process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN;
        } else {
          process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN = previous;
        }
      }
    });
  });
});

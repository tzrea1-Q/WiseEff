/**
 * Behavior-level integration coverage for the review workflow repository:
 * assignee discovery/eligibility, round/request/item creation, filtered
 * listings, status transitions, version-guarded merge, and the post-cutover
 * semantic listing path against a real database. Asserts returned DTOs and
 * subsequent reads — never SQL text.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import {
  resolveParameterIdentityMode,
  setParameterIdentityMode
} from "../parameter-kernel/parameterIdentityMode";
import type { ParameterSubmissionRoundStatus } from "./status";
import type { ParameterChangeRequestStatus } from "../parameter-kernel/workflowStatus";
import { getProjectParameterForUpdate } from "./repository";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  findOpenChangeRequest,
  getChangeRequestById,
  hasEligibleWorkflowAssignee,
  insertReviewDecision,
  listChangeRequests,
  listEligibleWorkflowAssignees,
  listReviewDecisions,
  listSubmissionRounds,
  mergeChangeRequest,
  updateChangeRequestStatus,
  updateSubmissionRoundStatusFromRequests
} from "./reviewWorkflowRepository";

const ORG = "org-chargelab";
const PROJECT = "project-1";
const OTHER_PROJECT = "project-2";

const workflowAssignees = {
  hardwareCommitterId: "u-hardware",
  softwareCommitterId: "u-software-committer",
  softwareUserId: "u-software-user"
};

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("review workflow repository", () => {
  let db: InMemoryTestDatabase;

  async function seedRoleBinding(userId: string, projectId: string, roleId: string) {
    await db.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ($1, $2, $3, $4, $5)`,
      [`urb-${userId}-${projectId}-${roleId}`, userId, ORG, projectId, roleId]
    );
  }

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: ORG, name: "ChargeLab" },
      users: [
        { id: "user-1", name: "Riley Chen", email: "riley@example.com" },
        { id: "u-hardware", name: "Hardware Committer", email: "hw@example.com" },
        { id: "u-software-committer", name: "Software Committer", email: "swc@example.com" },
        { id: "u-software-user", name: "Software Developer", email: "swu@example.com" },
        { id: "u-inactive", name: "Inactive Committer", email: "inactive@example.com", isActive: false },
        { id: "u-borealis", name: "Borealis Committer", email: "borealis@example.com" }
      ],
      projects: [
        { id: PROJECT, name: "Aurora", code: "AUR" },
        { id: OTHER_PROJECT, name: "Borealis", code: "BOR" }
      ]
    });
    await seedRoleBinding("u-hardware", PROJECT, "hardware-committer");
    await seedRoleBinding("u-software-committer", PROJECT, "software-committer");
    await seedRoleBinding("u-software-user", PROJECT, "software-user");
    await seedRoleBinding("u-inactive", PROJECT, "hardware-committer");
    await seedRoleBinding("u-borealis", OTHER_PROJECT, "hardware-committer");

    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values
         ('definition-1', $1, 'fast_charge_current_limit_ma', 'Limit fast charge current.', 'Controls fast charging current.', 'ENV: FAST_CHARGE_CURRENT=number', 'Charging Policy', '1000 - 5000', 'mA', 'High'),
         ('definition-2', $1, 'thermal_guard_threshold_c', 'Thermal guard.', 'Guards the pack.', 'ENV: THERMAL_GUARD=number', 'Thermal', '40 - 90', 'C', 'Medium')`,
      [ORG]
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values
         ('param-1', $1, $2, 'definition-1', '3200', '3000', 7, 'user-1'),
         ('param-2', $1, $2, 'definition-2', '70', '68', 2, 'user-1')`,
      [ORG, PROJECT]
    );

    // Foreign organization mirror rows for scoping cases.
    await seedCoreGraph(db, {
      organization: { id: "org-foreign", name: "Foreign Org" },
      users: [{ id: "u-foreign", name: "Foreign Committer", email: "foreign@example.com" }],
      projects: [{ id: "project-foreign", name: "Foreign", code: "FRN" }]
    });
    await db.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ('urb-foreign', 'u-foreign', 'org-foreign', 'project-foreign', 'hardware-committer')`
    );
  });

  afterEach(async () => {
    await db?.rollback();
    setParameterIdentityMode(null);
  });

  async function createRound(
    input: { id?: string; projectId?: string; status?: ParameterSubmissionRoundStatus; summary?: string } = {}
  ) {
    return createSubmissionRound(db, {
      id: input.id ?? `round-${randomUUID().slice(0, 8)}`,
      organizationId: ORG,
      projectId: input.projectId ?? PROJECT,
      submitterUserId: "user-1",
      status: input.status ?? "submitted",
      summary: input.summary ?? "Tune charging parameters"
    });
  }

  async function createRequest(
    input: {
      id?: string;
      roundId: string;
      projectId?: string;
      parameterId?: string;
      definitionId?: string;
      baseVersion?: number;
      status?: ParameterChangeRequestStatus;
      targetValue?: string;
      assignedToUserId?: string;
      workflowAssignees?: typeof workflowAssignees;
    }
  ) {
    return createChangeRequest(db, {
      id: input.id ?? `request-${randomUUID().slice(0, 8)}`,
      organizationId: ORG,
      submissionRoundId: input.roundId,
      projectId: input.projectId ?? PROJECT,
      parameterId: input.parameterId ?? "param-1",
      parameterDefinitionId: input.definitionId ?? "definition-1",
      baseVersion: input.baseVersion ?? 7,
      currentValue: "3200",
      targetValue: input.targetValue ?? "3100",
      status: input.status ?? "submitted",
      submitterUserId: "user-1",
      assignedToUserId: input.assignedToUserId,
      workflowAssignees: input.workflowAssignees
    });
  }

  it("lists active workflow assignees only from the requested organization and project", async () => {
    const assignees = await listEligibleWorkflowAssignees(db, {
      organizationId: ORG,
      projectId: PROJECT
    });

    // Inactive users, other projects, and other organizations stay out;
    // software committers double as software users.
    expect(assignees).toEqual({
      hardwareCommitters: [{ id: "u-hardware", name: "Hardware Committer" }],
      softwareCommitters: [{ id: "u-software-committer", name: "Software Committer" }],
      softwareUsers: [
        { id: "u-software-committer", name: "Software Committer" },
        { id: "u-software-user", name: "Software Developer" }
      ]
    });
  });

  it("creates submission rounds, change requests, and submission items that read back consistently", async () => {
    const round = await createRound({ id: "round-1", summary: "Tune charging parameters" });
    expect(round).toMatchObject({
      id: "round-1",
      projectId: PROJECT,
      projectName: "Aurora",
      submitter: "Riley Chen",
      status: "submitted",
      summary: "Tune charging parameters"
    });

    const request = await createRequest({ id: "request-1", roundId: "round-1", baseVersion: 7 });
    expect(request).toMatchObject({
      id: "request-1",
      submissionRoundId: "round-1",
      projectId: PROJECT,
      parameterId: "param-1",
      module: "Charging Policy",
      title: "fast_charge_current_limit_ma",
      currentValue: "3200",
      targetValue: "3100",
      action: "set",
      submitter: "Riley Chen",
      status: "submitted",
      fastTrack: false
    });
    // Definition risk drives the AI suggestion instead of a top-level field.
    expect(request.aiSuggestion?.recommendation).toBe("needs-review");
    // The persisted base version surfaces on the by-id read.
    const reloaded = await getChangeRequestById(db, { organizationId: ORG, requestId: "request-1" });
    expect(reloaded?.baseVersion).toBe(7);

    const item = await createSubmissionItem(db, {
      id: "item-1",
      organizationId: ORG,
      submissionRoundId: "round-1",
      changeRequestId: "request-1",
      parameterId: "param-1",
      currentValue: "3200",
      targetValue: "3100",
      reason: "Reduce thermal risk."
    });
    expect(item).toEqual({
      requestId: "request-1",
      parameterId: "param-1",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200",
      targetValue: "3100",
      action: "set",
      candidateConfigRevisionId: undefined,
      unit: "mA",
      risk: "High",
      reason: "Reduce thermal risk.",
      valueKind: "scalar"
    });

    // Everything written above reads back through the listing path.
    const rounds = await listSubmissionRounds(db, { organizationId: ORG, projectId: PROJECT });
    expect(rounds).toHaveLength(1);
    expect(rounds[0].items).toEqual([item]);
  });

  it("persists and maps workflow assignees on created change requests", async () => {
    await createRound({ id: "round-1" });
    const request = await createRequest({
      id: "request-1",
      roundId: "round-1",
      status: "hardware_review",
      assignedToUserId: "u-hardware",
      workflowAssignees
    });

    expect(request).toMatchObject({
      status: "hardware_review",
      assignedTo: "u-hardware",
      workflowAssignees
    });

    // The persisted assignee state survives a fresh read.
    const reloaded = await getChangeRequestById(db, { organizationId: ORG, requestId: "request-1" });
    expect(reloaded).toMatchObject({ assignedTo: "u-hardware", workflowAssignees });
  });

  it("lists submission rounds and change requests with project and status filters", async () => {
    await createRound({ id: "round-submitted" });
    await createRound({ id: "round-merged", status: "merged" });
    await createRound({ id: "round-other-project", projectId: OTHER_PROJECT });
    await createRequest({ id: "request-submitted", roundId: "round-submitted", parameterId: "param-1" });
    await createRequest({
      id: "request-merged",
      roundId: "round-merged",
      parameterId: "param-2",
      definitionId: "definition-2",
      status: "merged"
    });

    const rounds = await listSubmissionRounds(db, {
      organizationId: ORG,
      projectId: PROJECT,
      status: ["submitted"]
    });
    expect(rounds.map((row) => row.id)).toEqual(["round-submitted"]);

    const requests = await listChangeRequests(db, {
      organizationId: ORG,
      projectId: PROJECT,
      status: ["submitted"]
    });
    expect(requests.map((row) => row.id)).toEqual(["request-submitted"]);
  });

  it("lists submission rounds with workflow assignees reconstructed from linked requests", async () => {
    await createRound({ id: "round-1", status: "hardware_review", summary: "Assigned workflow." });
    await createRequest({
      id: "request-1",
      roundId: "round-1",
      status: "hardware_review",
      assignedToUserId: "u-hardware",
      workflowAssignees
    });
    await createSubmissionItem(db, {
      id: "item-1",
      organizationId: ORG,
      submissionRoundId: "round-1",
      changeRequestId: "request-1",
      parameterId: "param-1",
      currentValue: "3200",
      targetValue: "3100",
      reason: "Reduce thermal risk."
    });

    const rounds = await listSubmissionRounds(db, { organizationId: ORG });

    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      id: "round-1",
      workflowAssignees,
      items: [
        expect.objectContaining({
          requestId: "request-1",
          parameterId: "param-1",
          name: "fast_charge_current_limit_ma"
        })
      ]
    });
  });

  it("lists post-cutover submission items without the retired flat identity tables", async () => {
    // Emulate the applied cutover schema (server/cutovers/2026-07-16-parameter-identity-cutover.sql):
    // legacy identity columns are dropped and the flat tables renamed away, so any
    // workflow SQL still referencing them would fail loudly. DDL rolls back with the fixture.
    await db.query(`alter table parameter_change_requests drop column parameter_definition_id`);
    await db.query(`alter table parameter_change_requests drop column project_parameter_value_id`);
    await db.query(`alter table parameter_submission_items drop column project_parameter_value_id`);
    await db.query(`alter table parameter_definitions rename to legacy_parameter_definitions`);
    await db.query(`alter table project_parameter_values rename to legacy_project_parameter_values`);

    // Flip the cutover marker so identity mode resolves to semantic.
    const runId = `pimr-${randomUUID().slice(0, 8)}`;
    await db.query(
      `insert into parameter_identity_migration_runs (id, mode, status, write_lock_confirmed)
       values ($1, 'apply', 'completed', true)`,
      [runId]
    );
    await db.query(`insert into parameter_identity_cutovers (id, migration_run_id) values ($1, $2)`, [
      `pic-${randomUUID().slice(0, 8)}`,
      runId
    ]);
    await resolveParameterIdentityMode(db);

    // Semantic identity graph; the submission rows never reference flat identity ids.
    await seedSpecBindingGraph(db, {
      organizationId: ORG,
      specs: [
        {
          id: "spec-gpio",
          specificationKey: "manual/gpio_int",
          versions: [
            {
              id: "psv-gpio",
              displayName: "gpio_int",
              description: "interrupt pin",
              valueShape: { kind: "phandle-list" }
            }
          ],
          propertySpec: { id: "dps-gpio", propertyKey: "gpio_int" }
        }
      ],
      modules: [{ id: "pm-manual", name: "manual" }],
      bindings: [{ id: "binding-1", projectId: PROJECT, parameterSpecId: "spec-gpio", moduleId: "pm-manual" }]
    });

    await createRound({ id: "round-semantic", status: "hardware_review", summary: "Semantic submission" });
    await createChangeRequest(db, {
      id: "request-semantic",
      organizationId: ORG,
      submissionRoundId: "round-semantic",
      projectId: PROJECT,
      parameterId: "binding-1",
      parameterDefinitionId: "",
      baseVersion: 1,
      currentValue: "<&gpio13 29 0>",
      targetValue: "<&gpio13 30 0>",
      status: "hardware_review",
      submitterUserId: "user-1",
      parameterSpecId: "spec-gpio",
      projectParameterBindingId: "binding-1"
    });
    await createSubmissionItem(db, {
      id: "item-semantic",
      organizationId: ORG,
      submissionRoundId: "round-semantic",
      changeRequestId: "request-semantic",
      parameterId: "binding-1",
      currentValue: "<&gpio13 29 0>",
      targetValue: "<&gpio13 30 0>",
      reason: "typed edit",
      projectParameterBindingId: "binding-1"
    });

    // The rows carry binding identity only — the flat ppv column no longer exists.
    const storedItem = await db.query<{ project_parameter_binding_id: string }>(
      `select project_parameter_binding_id from parameter_submission_items where id = 'item-semantic'`
    );
    expect(storedItem.rows[0].project_parameter_binding_id).toBe("binding-1");

    const rounds = await listSubmissionRounds(db, { organizationId: ORG });
    expect(rounds).toHaveLength(1);
    expect(rounds[0].items).toHaveLength(1);
    expect(rounds[0].items[0]).toMatchObject({
      requestId: "request-semantic",
      parameterId: "binding-1",
      name: "gpio_int",
      module: "manual",
      currentValue: "<&gpio13 29 0>",
      targetValue: "<&gpio13 30 0>"
    });
  });

  it("findOpenChangeRequest sees only open requests within the organization", async () => {
    await createRound({ id: "round-1" });
    await createRequest({ id: "request-open", roundId: "round-1", parameterId: "param-1" });
    // A closed request on another parameter of the same project.
    await createRequest({
      id: "request-merged",
      roundId: "round-1",
      parameterId: "param-2",
      definitionId: "definition-2",
      status: "merged"
    });

    const open = await findOpenChangeRequest(db, {
      organizationId: ORG,
      projectId: PROJECT,
      parameterId: "param-1"
    });
    expect(open).toMatchObject({ id: "request-open", status: "submitted" });

    // Closed states do not count as open.
    await expect(
      findOpenChangeRequest(db, { organizationId: ORG, projectId: PROJECT, parameterId: "param-2" })
    ).resolves.toBeNull();
    // Another organization cannot see the request.
    await expect(
      findOpenChangeRequest(db, { organizationId: "org-foreign", projectId: PROJECT, parameterId: "param-1" })
    ).resolves.toBeNull();

    // Withdrawing the open request removes it from the open lookup.
    await updateChangeRequestStatus(db, { organizationId: ORG, requestId: "request-open", status: "withdrawn" });
    await expect(
      findOpenChangeRequest(db, { organizationId: ORG, projectId: PROJECT, parameterId: "param-1" })
    ).resolves.toBeNull();
  });

  it("getProjectParameterForUpdate scopes by organization and project", async () => {
    const parameter = await getProjectParameterForUpdate(db, {
      organizationId: ORG,
      projectId: PROJECT,
      parameterId: "param-1"
    });
    expect(parameter).toMatchObject({
      id: "param-1",
      projectId: PROJECT,
      parameterDefinitionId: "definition-1",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      unit: "mA",
      risk: "High",
      currentValue: "3200",
      recommendedValue: "3000",
      valueVersion: 7
    });

    await expect(
      getProjectParameterForUpdate(db, { organizationId: ORG, projectId: OTHER_PROJECT, parameterId: "param-1" })
    ).resolves.toBeNull();
    await expect(
      getProjectParameterForUpdate(db, { organizationId: "org-foreign", projectId: PROJECT, parameterId: "param-1" })
    ).resolves.toBeNull();
  });

  it("gets change request by id and lists review decisions in stage order", async () => {
    await createRound({ id: "round-1" });
    await createRequest({ id: "request-1", roundId: "round-1", status: "hardware_review" });

    const request = await getChangeRequestById(db, { organizationId: ORG, requestId: "request-1" });
    expect(request).toMatchObject({ id: "request-1", status: "hardware_review", title: "fast_charge_current_limit_ma" });
    // Organization scoping: the id is invisible to another organization.
    await expect(
      getChangeRequestById(db, { organizationId: "org-foreign", requestId: "request-1" })
    ).resolves.toBeNull();

    // Insert the later decision first: ordering must come from the database, not insertion.
    await insertReviewDecision(db, {
      id: "decision-2",
      organizationId: ORG,
      requestId: "request-1",
      reviewerUserId: "u-software-committer",
      decision: "advance",
      fromStatus: "software_review",
      toStatus: "software_merge",
      note: "Software reviewed."
    });
    const first = await insertReviewDecision(db, {
      id: "decision-1",
      organizationId: ORG,
      requestId: "request-1",
      reviewerUserId: "u-hardware",
      decision: "advance",
      fromStatus: "hardware_review",
      toStatus: "software_review",
      note: "Hardware reviewed."
    });
    expect(first).toMatchObject({
      id: "decision-1",
      requestId: "request-1",
      reviewerUserId: "u-hardware",
      decision: "advance",
      fromStatus: "hardware_review",
      toStatus: "software_review",
      note: "Hardware reviewed."
    });

    const decisions = await listReviewDecisions(db, { organizationId: ORG, requestId: "request-1" });
    // Rollback-fixture rows share one transaction timestamp; the id tiebreak decides.
    expect(decisions.map((decision) => decision.id)).toEqual(["decision-1", "decision-2"]);
    await expect(
      listReviewDecisions(db, { organizationId: "org-foreign", requestId: "request-1" })
    ).resolves.toEqual([]);
  });

  it("updates request status with reviewer note and persists it for later reads", async () => {
    await createRound({ id: "round-1" });
    await createRequest({ id: "request-1", roundId: "round-1", status: "hardware_review" });

    const updated = await updateChangeRequestStatus(db, {
      organizationId: ORG,
      requestId: "request-1",
      status: "software_review",
      note: "Hardware reviewed."
    });
    expect(updated).toMatchObject({
      id: "request-1",
      status: "software_review",
      reviewerNote: "Hardware reviewed.",
      title: "fast_charge_current_limit_ma"
    });

    const reloaded = await getChangeRequestById(db, { organizationId: ORG, requestId: "request-1" });
    expect(reloaded).toMatchObject({ status: "software_review", reviewerNote: "Hardware reviewed." });

    // Rejection stores the note as the reject reason.
    const rejected = await updateChangeRequestStatus(db, {
      organizationId: ORG,
      requestId: "request-1",
      status: "rejected",
      note: "Too risky."
    });
    expect(rejected).toMatchObject({ status: "rejected", rejectReason: "Too risky." });
  });

  it("advances the assigned user from workflow assignees when updating review status", async () => {
    await createRound({ id: "round-1" });
    await createRequest({
      id: "request-1",
      roundId: "round-1",
      status: "hardware_review",
      assignedToUserId: "u-hardware",
      workflowAssignees
    });

    const toSoftwareReview = await updateChangeRequestStatus(db, {
      organizationId: ORG,
      requestId: "request-1",
      status: "software_review",
      note: "Hardware reviewed."
    });
    expect(toSoftwareReview).toMatchObject({
      status: "software_review",
      assignedTo: "u-software-committer",
      workflowAssignees
    });

    const toSoftwareMerge = await updateChangeRequestStatus(db, {
      organizationId: ORG,
      requestId: "request-1",
      status: "software_merge"
    });
    expect(toSoftwareMerge).toMatchObject({ status: "software_merge", assignedTo: "u-software-user" });

    // Terminal states clear the assignment.
    const merged = await updateChangeRequestStatus(db, {
      organizationId: ORG,
      requestId: "request-1",
      status: "merged"
    });
    expect(merged?.assignedTo).toBeUndefined();
  });

  it("checks workflow assignee eligibility against active project role bindings", async () => {
    const eligible = (
      userId: string,
      projectId: string,
      roleId: Parameters<typeof hasEligibleWorkflowAssignee>[1]["roleId"],
      organizationId = ORG
    ) => hasEligibleWorkflowAssignee(db, { organizationId, projectId, userId, roleId });

    await expect(eligible("u-hardware", PROJECT, "hardware-committer")).resolves.toBe(true);
    // Wrong role for the binding.
    await expect(eligible("u-hardware", PROJECT, "software-committer")).resolves.toBe(false);
    // Binding exists on another project only.
    await expect(eligible("u-borealis", PROJECT, "hardware-committer")).resolves.toBe(false);
    // Inactive users are ineligible even with a matching binding.
    await expect(eligible("u-inactive", PROJECT, "hardware-committer")).resolves.toBe(false);
    // Cross-organization lookups never match.
    await expect(eligible("u-foreign", "project-foreign", "hardware-committer")).resolves.toBe(false);
  });

  it("merges a software_merge request with the expected version and inserts history atomically", async () => {
    await createRound({ id: "round-1" });
    await createRequest({ id: "request-1", roundId: "round-1", status: "software_merge", baseVersion: 7 });

    const merged = await mergeChangeRequest(db, {
      historyId: "history-1",
      organizationId: ORG,
      requestId: "request-1",
      expectedVersion: 7,
      actorUserId: "u-software-user"
    });

    expect(merged).toEqual({
      id: "request-1",
      projectParameterValueId: "param-1",
      parameterDefinitionId: "definition-1",
      projectId: PROJECT,
      targetValue: "3100",
      action: "set",
      baseVersion: 7,
      newVersion: 8
    });

    const value = await db.query<{ current_value: string; value_version: number; updated_by_user_id: string }>(
      `select current_value, value_version, updated_by_user_id from project_parameter_values where id = 'param-1'`
    );
    expect(value.rows[0]).toEqual({
      current_value: "3100",
      value_version: 8,
      updated_by_user_id: "u-software-user"
    });
    const history = await db.query<{ id: string; version: number; value: string; request_id: string }>(
      `select id, version, value, request_id from parameter_history_entries where project_parameter_value_id = 'param-1'`
    );
    expect(history.rows).toEqual([
      { id: "history-1", version: 8, value: "3100", request_id: "request-1" }
    ]);
  });

  it("mergeChangeRequest returns null and writes nothing when the version guard misses", async () => {
    await createRound({ id: "round-1" });
    await createRequest({ id: "request-1", roundId: "round-1", status: "software_merge", baseVersion: 7 });

    const merged = await mergeChangeRequest(db, {
      historyId: "history-1",
      organizationId: ORG,
      requestId: "request-1",
      expectedVersion: 6,
      actorUserId: "u-software-user"
    });

    expect(merged).toBeNull();
    // The stale expectation left the value and history untouched.
    const value = await db.query<{ current_value: string; value_version: number }>(
      `select current_value, value_version from project_parameter_values where id = 'param-1'`
    );
    expect(value.rows[0]).toEqual({ current_value: "3200", value_version: 7 });
    const history = await db.query<{ id: string }>(
      `select id from parameter_history_entries where project_parameter_value_id = 'param-1'`
    );
    expect(history.rows).toEqual([]);
  });

  it("updates submission round status from the most advanced child request", async () => {
    await createRound({ id: "round-1", status: "submitted" });
    await createRequest({ id: "request-early", roundId: "round-1", parameterId: "param-1", status: "hardware_review" });
    await createRequest({
      id: "request-late",
      roundId: "round-1",
      parameterId: "param-2",
      definitionId: "definition-2",
      status: "software_merge"
    });

    const status = await updateSubmissionRoundStatusFromRequests(db, {
      organizationId: ORG,
      submissionRoundId: "round-1"
    });

    expect(status).toBe("software_merge");
    const round = await db.query<{ status: string }>(
      `select status from parameter_submission_rounds where id = 'round-1'`
    );
    expect(round.rows[0].status).toBe("software_merge");
  });
});

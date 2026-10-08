import { afterEach, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { withTempDatabase } from "../../testing/tempDatabase";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { testRefusalAuditSink } from "../audit/testRefusalSink";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { LEGACY_IDENTITY_SQL } from "../parameter-kernel/legacyParameterIdentityNames";
import type { ParameterChangeRequestStatus } from "../parameter-kernel/workflowStatus";
import { createChangeRequest, createSubmissionItem, createSubmissionRound } from "./reviewWorkflowRepository";
import { registerParameterRoutes } from "./routes";

afterEach(() => setParameterIdentityMode(null));

it("scopes default legacy history reads by tenant, current project access, owner and review stage", async () => {
  await withTempDatabase({ prefix: "submission_tracking" }, async ({ db }) => {
    setParameterIdentityMode("legacy");
    for (const organizationId of ["tracking-org", "tracking-foreign"]) {
      const foreign = organizationId === "tracking-foreign";
      const projects = foreign ? ["foreign-project"] : ["tracking-project", "inaccessible-project"];
      await seedCoreGraph(db, {
        organization: { id: organizationId },
        users: (foreign ? ["foreign-user"] : ["tracking-user", "other-user", "tracking-reviewer"])
          .map((id) => ({ id })),
        projects: projects.map((id) => ({ id }))
      });
      await db.query(`insert into ${LEGACY_IDENTITY_SQL.definitionsTable}
        (id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk)
        values ($1, $2, 'limit', 'Tracking limit', 'Submission tracking fixture', 'DTS', 'Tracking', '', '', 'Low')`,
      [`${organizationId}-definition`, organizationId]);
      for (const projectId of projects) {
        await db.query(`insert into ${LEGACY_IDENTITY_SQL.valuesTable}
          (id, organization_id, project_id, parameter_definition_id, current_value, ${LEGACY_IDENTITY_SQL.recommendedValueColumn})
          values ($1, $2, $3, $4, '1', '2')`,
        [`${projectId}-value`, organizationId, projectId, `${organizationId}-definition`]);
      }
      await seedSpecBindingGraph(db, {
        organizationId,
        specs: [{ id: `${organizationId}-spec`, specificationKey: "tracking/limit",
          versions: [{ id: `${organizationId}-version`, displayName: "Limit", valueShape: { kind: "scalar" } }] }],
        modules: [{ id: `${organizationId}-module`, name: "Tracking" }],
        bindings: projects.map((projectId) => ({
          id: `${projectId}-binding`, projectId,
          parameterSpecId: `${organizationId}-spec`, moduleId: `${organizationId}-module`
        }))
      });
    }

    async function seedHistory(id: string, projectId: string, submitterUserId: string, status: ParameterChangeRequestStatus) {
      const organizationId = projectId === "foreign-project" ? "tracking-foreign" : "tracking-org";
      // One open legacy request is allowed per project value (and one value per project definition),
      // so each history entry gets its own definition and value.
      await db.query(`insert into ${LEGACY_IDENTITY_SQL.definitionsTable}
        (id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk)
        values ($1, $2, $3, 'Tracking limit', 'Submission tracking fixture', 'DTS', 'Tracking', '', '', 'Low')`,
      [`${id}-definition`, organizationId, `limit_${id.replaceAll("-", "_")}`]);
      await db.query(`insert into ${LEGACY_IDENTITY_SQL.valuesTable}
        (id, organization_id, project_id, parameter_definition_id, current_value, ${LEGACY_IDENTITY_SQL.recommendedValueColumn})
        values ($1, $2, $3, $4, '1', '2')`,
      [`${id}-value`, organizationId, projectId, `${id}-definition`]);
      await createSubmissionRound(db, { id: `${id}-round`, organizationId, projectId, submitterUserId, status, summary: id });
      await createChangeRequest(db, {
        id, organizationId, projectId, submissionRoundId: `${id}-round`, submitterUserId, status,
        parameterId: `${id}-value`, parameterDefinitionId: `${id}-definition`,
        projectParameterBindingId: `${projectId}-binding`, parameterSpecId: `${organizationId}-spec`,
        currentValue: "1", targetValue: "2", baseVersion: 1,
        assignedToUserId: organizationId === "tracking-foreign" ? "foreign-user" : "tracking-reviewer"
      });
      await createSubmissionItem(db, {
        id: `${id}-item`, organizationId, submissionRoundId: `${id}-round`, changeRequestId: id,
        parameterId: `${id}-value`, projectParameterBindingId: `${projectId}-binding`,
        currentValue: "1", targetValue: "2", reason: id
      });
      if (status === "merged" || status === "rejected") {
        await db.query(`insert into parameter_review_decisions
          (id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status)
          values ($1,$2,$3,'tracking-reviewer','advance','hardware_review',$4)`,
        [`${id}-decision`, organizationId, id, status]);
      }
    }
    await seedHistory("own", "tracking-project", "tracking-user", "hardware_review");
    await seedHistory("other", "tracking-project", "other-user", "hardware_review");
    await seedHistory("other-stage", "tracking-project", "other-user", "software_review");
    await seedHistory("terminal", "tracking-project", "other-user", "merged");
    await seedHistory("inaccessible-own", "inaccessible-project", "tracking-user", "hardware_review");
    await seedHistory("inaccessible-other", "inaccessible-project", "other-user", "hardware_review");
    await seedHistory("inaccessible-merge", "inaccessible-project", "other-user", "software_merge");
    await seedHistory("foreign", "foreign-project", "foreign-user", "hardware_review");
    setParameterIdentityMode("semantic");

    const authFor = (userId: string, roles: AuthContext["roles"], organizationId = "tracking-org") =>
      makeTestAuthContext({ userId, organizationId, roles, permissions: ["parameter:view", "parameter:review"] });
    let auth = authFor("tracking-user", [{ projectId: "tracking-project", roleId: "hardware-user" }]);
    const router = createRouter();
    registerParameterRoutes(router, { db, refusalAuditSink: testRefusalAuditSink, getCurrentAuthContext: () => auth });
    const server = createHttpServer(router);
    async function expectHistory(expected: string[], suffix = "") {
      for (const resource of ["parameter-submission-rounds", "parameter-change-requests"]) {
        const response = await requestJson<{ items: { id: string }[] }>(server, `/api/v1/${resource}${suffix}`);
        expect(response.status, response.bodyText).toBe(200);
        const ids = expected.map((id) => resource === "parameter-submission-rounds" ? `${id}-round` : id);
        expect(response.body.items.map((item) => item.id).sort()).toEqual(ids.sort());
      }
    }
    await expectHistory(["own"]);
    await expectHistory(["own"], "?mine=false");
    await expectHistory([], "?projectId=inaccessible-project");
    await expectHistory([], "?projectId=foreign-project");
    await expectHistory(["own"], "?assignedTo=tracking-reviewer");
    auth = authFor("tracking-user", []);
    await expectHistory([]);
    auth = authFor("tracking-user", [
      { projectId: null, roleId: "hardware-user" },
      { projectId: "tracking-project", roleId: "software-user" }
    ]);
    await expectHistory(["own", "inaccessible-own"]);
    await expectHistory([], "?projectId=inaccessible-project&status=software_merge");
    auth = authFor("tracking-reviewer", [{ projectId: "tracking-project", roleId: "hardware-committer" }]);
    await expectHistory(["own", "other", "terminal"]);
    await expectHistory([], "?status=software_review");
    await expectHistory([], "?projectId=inaccessible-project");
    const mine = await requestJson<{ items: unknown[] }>(server, "/api/v1/parameter-submission-rounds?mine=true");
    expect(mine.status).toBe(200);
    expect(mine.body.items).toEqual([]);
    auth = authFor("tracking-reviewer", [{ projectId: "tracking-project", roleId: "software-committer" }]);
    await expectHistory(["other-stage"]);
    auth = authFor("tracking-user", [{ projectId: "tracking-project", roleId: "hardware-user" }]);
    const ownArchive = await requestJson<{ items: { id: string }[] }>(server, "/api/v1/parameter-submission-rounds?mine=true");
    expect(ownArchive.status).toBe(200);
    expect(ownArchive.body.items.map((item) => item.id)).toEqual(["own-round"]);
    auth = authFor("foreign-user", [{ projectId: null, roleId: "admin" }], "tracking-foreign");
    await expectHistory(["foreign"]);
    auth = authFor("tracking-user", [{ projectId: null, roleId: "admin" }]);
    await expectHistory(["own", "other", "other-stage", "terminal", "inaccessible-own", "inaccessible-other", "inaccessible-merge"]);
    auth.user.isActive = false;
    await expectHistory([]);
  });
}, 120_000);

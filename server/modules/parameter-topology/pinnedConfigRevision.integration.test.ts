import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import {
  createMigrationHarness,
  MIGRATION_PRINCIPAL,
  PREDECESSOR_DEFINITION_ID,
  PREDECESSOR_SUBJECT_ID,
  type MigrationHarness
} from "../parameter-catalog-migration/testing/harness";
import { registerParameterTopologyRoutes } from "./routes";
import { validateConfigRevision } from "./service";

const organizationId = "org-pinned-validation";
const projectId = "project-pinned-validation";
const revisionId = "revision-pinned-validation";
const auth = makeTestAuthContext({
  userId: MIGRATION_PRINCIPAL,
  organizationId,
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["parameter:view", "parameter:edit", "admin:access"]
});
const conflict = {
  code: "CONFLICT",
  message: "This config revision is pinned by canonical source values and its source graph cannot be changed. Create a successor revision to validate changes.",
  details: { reason: "pinned-source-graph-immutable" }
};

describe.skipIf(!(await isTestDatabaseAvailable()))("canonical-pinned config revision validation", () => {
  let harness: MigrationHarness;

  beforeAll(async () => {
    harness = await createMigrationHarness();
    await harness.seedOrganization(organizationId);
    await harness.seedProject(organizationId, projectId, "Pinned validation");
    const registrationId = await harness.registerSubject({
      organizationId,
      subjectId: PREDECESSOR_SUBJECT_ID,
      subjectKind: "driver",
      moduleId: "module-pinned-validation"
    });
    const source = {
      organizationId,
      projectId,
      logicalNodeId: "pinned-validation-node",
      definitionId: PREDECESSOR_DEFINITION_ID,
      sourceRef: "pinned-validation.dts",
      configRevisionId: revisionId
    };
    await harness.seedSourceFacts(source);
    await harness.db.query("update dts_config_revisions set status = 'validated' where id = $1", [revisionId]);
    await harness.seedBindingValue({
      ...source,
      registrationId,
      sources: [{ sourceRef: source.sourceRef, configRevisionId: revisionId }],
      values: [5]
    });
    const pins = await harness.db.query(
      "select id from parameter_catalog.project_value_source_pins where config_revision_id = $1",
      [revisionId]
    );
    expect(pins.rows).toHaveLength(1);
  });

  afterAll(async () => { await harness?.close(); });

  it("refuses in the real service before any write or toolchain execution", async () => {
    const db = {
      query: vi.fn(harness.db.query),
      transaction: vi.fn(harness.db.transaction)
    };
    const toolchain = { validate: vi.fn(), probe: vi.fn() };
    await expect(validateConfigRevision(db, auth, { projectId, revisionId }, {}, { toolchain }))
      .rejects.toMatchObject({ ...conflict, status: 409 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(toolchain.validate).not.toHaveBeenCalled();
    expect(db.query.mock.calls.every(([statement]) => statement.trimStart().toLowerCase().startsWith("select")))
      .toBe(true);
  });

  it("returns a typed 409 through the real topology HTTP route without changing the revision", async () => {
    const before = await harness.db.query("select * from dts_config_revisions where id = $1", [revisionId]);
    const runsBefore = await harness.db.query("select * from dts_validation_runs where config_revision_id = $1", [revisionId]);
    const router = createRouter();
    registerParameterTopologyRoutes(router, { db: harness.db, getCurrentAuthContext: () => auth, objectStore: harness.objectStore });
    const response = await requestJson(createHttpServer(router),
      `/api/v2/projects/${projectId}/config-revisions/${revisionId}/validate`,
      { method: "POST", body: "{}" });
    expect(response).toMatchObject({ status: 409, body: { error: { ...conflict, requestId: "test-request" } } });
    expect((await harness.db.query("select * from dts_config_revisions where id = $1", [revisionId])).rows)
      .toEqual(before.rows);
    expect((await harness.db.query("select * from dts_validation_runs where config_revision_id = $1", [revisionId])).rows)
      .toEqual(runsBefore.rows);
  });

  it("maps the real PostgreSQL trigger to 409 for a sibling HTTP write", async () => {
    const router = createRouter();
    router.post("/pinned-write", async () => {
      await harness.db.query("update dts_config_revisions set status = 'invalid' where id = $1", [revisionId]);
      return { status: 200, body: {} };
    });
    const response = await requestJson(createHttpServer(router), "/pinned-write", { method: "POST" });
    expect(response).toMatchObject({ status: 409, body: { error: { ...conflict, requestId: "test-request" } } });
  });

  it.each([
    { projectId: "project-other", revisionId },
    { projectId, revisionId: "revision-missing" }
  ])("preserves scoped not-found errors for $projectId/$revisionId", async (input) => {
    await expect(validateConfigRevision(harness.db, auth, input)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("does not disclose another tenant's pinned revision", async () => {
    const foreignAuth = makeTestAuthContext({
      userId: MIGRATION_PRINCIPAL,
      organizationId: "org-other",
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["admin:access"]
    });
    await expect(validateConfigRevision(harness.db, foreignAuth, { projectId, revisionId }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { registerCatalogProjectValueConsumerRoutes } from "./catalogProjectValueRoutes";
import { registerParameterRoutes } from "../parameters/routes";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error("catalog project-value draft delete requires a reachable real PostgreSQL server; skipping is forbidden");
}

const ORG = "org-849-draft-delete";
const USER = "user-849-draft-delete";
const OTHER_USER = "user-849-draft-delete-other";
const PROJECT = "project-849-draft-delete";
const OTHER_PROJECT = "project-849-draft-delete-other";
const V1_OTHER_PROJECT = "project-849-draft-delete-v1-other";
const FOREIGN_ORG = "org-849-draft-delete-foreign";
const FOREIGN_USER = "user-849-draft-delete-foreign";
const FOREIGN_PROJECT = "project-849-draft-delete-foreign";

describe("catalog project-value draft DELETE fallback", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  const auth = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Draft Delete Editor",
    email: "draft-delete@example.com",
    organizationName: "Draft Delete Org",
    roles: [{ projectId: PROJECT, roleId: "software-user" }],
    permissions: ["parameter:view", "parameter:edit"]
  });

  const server = () => {
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, {
      db: root,
      getCurrentAuthContext: () => auth
    });
    return createHttpServer(router);
  };

  const legacyServer = () => {
    const router = createRouter();
    registerParameterRoutes(router, {
      db: root,
      refusalAuditSink: createTrustedRefusalAuditSink(root),
      getCurrentAuthContext: () => auth
    });
    return createHttpServer(router);
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("draftdel");
    root = createPostgresDatabase(database.url);
    await root.query(
      `insert into organizations (id, name) values ($1, 'Draft Delete Org')`,
      [ORG]
    );
    await root.query(
      `insert into users (id, organization_id, name, email, title)
       values ($1, $2, 'Draft Delete Editor', 'draft-delete@example.com', 'Software User')`,
      [USER, ORG]
    );
    await root.query(
      `insert into users (id, organization_id, name, email, title)
       values ($1, $2, 'Other Draft Delete Editor', 'draft-delete-other@example.com', 'Software User')`,
      [OTHER_USER, ORG]
    );
    await root.query(
      `insert into projects (id, organization_id, name, code, status)
       values
         ($1, $3, 'Draft Delete Project', 'DDEL', 'initialized'),
         ($2, $3, 'Other Draft Delete Project', 'DDEL2', 'initialized'),
         ($4, $3, 'V1 Other Draft Delete Project', 'DDEL3', 'initialized')`,
      [PROJECT, OTHER_PROJECT, ORG, V1_OTHER_PROJECT]
    );
    await root.query(
      `insert into organizations (id, name) values ($1, 'Foreign Draft Delete Org')`,
      [FOREIGN_ORG]
    );
    await root.query(
      `insert into users (id, organization_id, name, email, title)
       values ($1, $2, 'Foreign Draft Delete Editor', 'draft-delete-foreign@example.com', 'Software User')`,
      [FOREIGN_USER, FOREIGN_ORG]
    );
    await root.query(
      `insert into projects (id, organization_id, name, code, status)
       values ($1, $2, 'Foreign Draft Delete Project', 'DDELF', 'initialized')`,
      [FOREIGN_PROJECT, FOREIGN_ORG]
    );
    await root.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format,
         module, default_range, unit, risk
       ) values
         ('pdef-849-draft-delete', $1, 'draft_delete_value', 'Draft delete value', 'Draft delete value', 'DTS', 'Test', '', '', 'Low'),
         ('pdef-849-draft-delete-v1', $1, 'draft_delete_value_v1', 'Draft delete value v1', 'Draft delete value v1', 'DTS', 'Test', '', '', 'Low'),
         ('pdef-849-draft-delete-foreign', $2, 'draft_delete_value_foreign', 'Foreign draft delete value', 'Foreign draft delete value', 'DTS', 'Test', '', '', 'Low')`,
      [ORG, FOREIGN_ORG]
    );
    await root.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values
         ('pval-849-draft-delete', $1, $2, 'pdef-849-draft-delete', '1', '1', 1, $3),
         ('pval-849-draft-delete-other', $1, $4, 'pdef-849-draft-delete', '2', '2', 1, $3),
         ('pval-849-draft-delete-v1', $1, $2, 'pdef-849-draft-delete-v1', '4', '4', 1, $3),
         ('pval-849-draft-delete-v1-other', $1, $5, 'pdef-849-draft-delete', '5', '5', 1, $3),
         ('pval-849-draft-delete-foreign', $6, $7, 'pdef-849-draft-delete-foreign', '6', '6', 1, $8)`,
      [ORG, PROJECT, USER, OTHER_PROJECT, V1_OTHER_PROJECT, FOREIGN_ORG, FOREIGN_PROJECT, FOREIGN_USER]
    );
  }, 30_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("keeps a same-owner draft in another project untouched", async () => {
    await root.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, action, initiator_type
       ) values ($1, $2, $3, 'pval-849-draft-delete-other', $4, '3', 'other project', 'manual', 'set', 'user')`,
      ["draft-849-other-project", ORG, OTHER_PROJECT, USER]
    );

    const response = await requestJson(
      server(),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/draft-849-other-project`,
      { method: "DELETE", headers: { "X-Request-Id": "draft-delete-cross-project" } }
    );

    expect(response.status).toBe(404);
    expect(
      (await root.query(`select project_id from parameter_drafts where id = $1`, ["draft-849-other-project"])).rows
    ).toEqual([{ project_id: OTHER_PROJECT }]);
    expect(
      (await root.query(
        `select action from audit_events where trace_id = $1`,
        ["draft-delete-cross-project"]
      )).rows
    ).toEqual([]);
  });

  it("deletes the project draft and records the removal audit atomically", async () => {
    await root.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, action, initiator_type
       ) values ($1, $2, $3, 'pval-849-draft-delete', $4, '2', 'remove draft', 'manual', 'set', 'user')`,
      ["draft-849-project", ORG, PROJECT, USER]
    );

    const response = await requestJson(
      server(),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/draft-849-project`,
      { method: "DELETE", headers: { "X-Request-Id": "draft-delete-success" } }
    );

    expect(response.status).toBe(200);
    expect(
      (await root.query(`select id from parameter_drafts where id = $1`, ["draft-849-project"])).rows
    ).toEqual([]);
    expect(
      (await root.query(
        `select action, project_id, target_type, target_id, trace_id
           from audit_events
          where target_id = $1`,
        ["draft-849-project"]
      )).rows
    ).toEqual([{
      action: "value-draft-removed",
      project_id: PROJECT,
      target_type: "project-parameter-value-draft",
      target_id: "draft-849-project",
      trace_id: "draft-delete-success"
    }]);
  });

  it("rolls back the draft when its required audit cannot be written", async () => {
    await root.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, action, initiator_type
       ) values ($1, $2, $3, 'pval-849-draft-delete', $4, '2', 'audit rollback', 'manual', 'set', 'user')`,
      ["draft-849-audit-rollback", ORG, PROJECT, USER]
    );
    await root.query(
      `create or replace function fail_draft_delete_audit() returns trigger
       language plpgsql as $$
       begin
         if new.trace_id = 'draft-delete-audit-failure' then
           raise exception 'injected draft delete audit failure';
         end if;
         return new;
       end;
       $$`
    );
    await root.query(
      `create trigger fail_draft_delete_audit_trigger
       before insert on audit_events
       for each row execute function fail_draft_delete_audit()`
    );

    try {
      const response = await requestJson(
        server(),
        `/api/v2/projects/${PROJECT}/parameter-value-drafts/draft-849-audit-rollback`,
        { method: "DELETE", headers: { "X-Request-Id": "draft-delete-audit-failure" } }
      );

      expect(response.status).toBe(500);
      expect(
        (await root.query(`select id from parameter_drafts where id = $1`, ["draft-849-audit-rollback"])).rows
      ).toEqual([{ id: "draft-849-audit-rollback" }]);
    } finally {
      await root.query(`drop trigger fail_draft_delete_audit_trigger on audit_events`);
      await root.query(`drop function fail_draft_delete_audit()`);
      await root.query(`delete from parameter_drafts where id = $1`, ["draft-849-audit-rollback"]);
    }
  });

  it("keeps the v1 caller project-scoped through the shared service seam", async () => {
    await root.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, action, initiator_type
       ) values ($1, $2, $3, 'pval-849-draft-delete-v1-other', $4, '3', 'v1 other project', 'manual', 'set', 'user')`,
      ["draft-849-v1-other-project", ORG, V1_OTHER_PROJECT, USER]
    );
    const refused = await requestJson(
      legacyServer(),
      "/api/v1/parameter-drafts/draft-849-v1-other-project",
      { method: "DELETE", headers: { "X-Request-Id": "draft-delete-v1-cross-project" } }
    );

    expect(refused.status).toBe(403);
    expect(
      (await root.query(`select project_id from parameter_drafts where id = $1`, ["draft-849-v1-other-project"])).rows
    ).toEqual([{ project_id: V1_OTHER_PROJECT }]);
    expect(
      (await root.query(`select action from audit_events where trace_id = $1`, ["draft-delete-v1-cross-project"])).rows
    ).toEqual([]);

    await root.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, action, initiator_type
       ) values ($1, $2, $3, 'pval-849-draft-delete-v1', $4, '3', 'v1 project', 'manual', 'set', 'user')`,
      ["draft-849-v1-project", ORG, PROJECT, USER]
    );
    const removed = await requestJson(
      legacyServer(),
      "/api/v1/parameter-drafts/draft-849-v1-project",
      { method: "DELETE", headers: { "X-Request-Id": "draft-delete-v1-project" } }
    );

    expect(removed.status).toBe(200);
    expect(
      (await root.query(`select id from parameter_drafts where id = $1`, ["draft-849-v1-project"])).rows
    ).toEqual([]);
    expect(
      (await root.query(
        `select action, project_id, trace_id
           from audit_events
          where target_id = $1`,
        ["draft-849-v1-project"]
      )).rows
    ).toEqual([{
      action: "value-draft-removed",
      project_id: PROJECT,
      trace_id: "draft-delete-v1-project"
    }]);
  });

  it("refuses a same-project draft owned by another user", async () => {
    await root.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, action, initiator_type
       ) values ($1, $2, $3, 'pval-849-draft-delete', $4, '3', 'other owner', 'manual', 'set', 'user')`,
      ["draft-849-other-owner", ORG, PROJECT, OTHER_USER]
    );

    const response = await requestJson(
      server(),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/draft-849-other-owner`,
      { method: "DELETE", headers: { "X-Request-Id": "draft-delete-other-owner" } }
    );

    expect(response.status).toBe(404);
    expect(
      (await root.query(`select user_id from parameter_drafts where id = $1`, ["draft-849-other-owner"])).rows
    ).toEqual([{ user_id: OTHER_USER }]);
    expect(
      (await root.query(`select action from audit_events where trace_id = $1`, ["draft-delete-other-owner"])).rows
    ).toEqual([]);
  });

  it("refuses a foreign-organization draft without mutation or success audit", async () => {
    await root.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, action, initiator_type
       ) values ($1, $2, $3, 'pval-849-draft-delete-foreign', $4, '3', 'foreign org', 'manual', 'set', 'user')`,
      ["draft-849-foreign-org", FOREIGN_ORG, FOREIGN_PROJECT, FOREIGN_USER]
    );

    const response = await requestJson(
      server(),
      `/api/v2/projects/${PROJECT}/parameter-value-drafts/draft-849-foreign-org`,
      { method: "DELETE", headers: { "X-Request-Id": "draft-delete-foreign-org" } }
    );

    expect(response.status).toBe(404);
    expect(
      (await root.query(
        `select organization_id, project_id, user_id from parameter_drafts where id = $1`,
        ["draft-849-foreign-org"]
      )).rows
    ).toEqual([{ organization_id: FOREIGN_ORG, project_id: FOREIGN_PROJECT, user_id: FOREIGN_USER }]);
    expect(
      (await root.query(`select action from audit_events where trace_id = $1`, ["draft-delete-foreign-org"])).rows
    ).toEqual([]);
  });
});

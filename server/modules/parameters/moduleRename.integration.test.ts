import { afterEach, describe, expect, it } from "vitest";

import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase } from "../../testing/tempDatabase";
import { testRefusalAuditSink } from "../audit/testRefusalSink";
import type { AuthContext } from "../auth/types";
import { insertAttributionSubjectForNewModule } from "../parameter-modules/attributionSubjectRepository";
import { applyParameterIdentityCutover, migrateParameterIdentities } from "../parameter-topology/migration";
import {
  resolveParameterIdentityMode,
  parameterIdentityMode,
  setParameterIdentityMode
} from "../parameter-kernel/parameterIdentityMode";
import { registerParameterRoutes } from "./routes";
import type { Database } from "../../shared/database/client";

const databaseAvailable = await isTestDatabaseAvailable();
const ORG = "org-module-rename";
const FOREIGN_ORG = "org-module-rename-foreign";
const USER = "user-module-rename";
const MAINTENANCE_TOKEN = "test-maintenance-token";

function adminAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Module Admin",
    email: "module-admin@example.com",
    organizationName: "Module Rename Org",
    roleId: "admin"
  });
}

function makeServer(db: Database, auth = adminAuth()) {
  const router = createRouter();
  registerParameterRoutes(router, {
    db,
    refusalAuditSink: testRefusalAuditSink,
    getCurrentAuthContext: () => auth
  });
  return createHttpServer(router);
}

async function bootstrapPostCutoverDatabase(db: Database) {
  await seedCoreGraph(db, {
    organization: { id: ORG, name: "Module Rename Org" },
    users: [{ id: USER, name: "Module Admin", email: "module-admin@example.com" }]
  });

  const report = await migrateParameterIdentities(db, {
    mode: "apply",
    maintenanceToken: MAINTENANCE_TOKEN,
    expectedMaintenanceToken: MAINTENANCE_TOKEN,
    writeLockConfirmed: true,
    dbSnapshotId: "db-snapshot-module-rename",
    objectSnapshotId: "object-snapshot-module-rename"
  });
  expect(report.blockers).toEqual([]);
  await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
  await resolveParameterIdentityMode(db);
  expect(parameterIdentityMode()).toBe("semantic");

  await db.query(
    `insert into parameter_modules (
       id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
       importance, kind, origin
      ) values
       ('pm-rename-business', $1, null, 'Charging', 'pm-rename-business', 1, 0, '', '', 'medium', 'business', 'curated'),
       ('pm-rename-description', $1, null, 'Description Only', 'pm-rename-description', 1, 1, '', '', 'medium', 'business', 'curated')`,
    [ORG]
  );

  const driverSubjectId = await insertAttributionSubjectForNewModule(db, {
    moduleId: "pm-rename-driver",
    organizationId: ORG,
    kind: "driver-group",
    displayName: "Driver Group",
    origin: "curated",
    sourceKey: "compatible:module-rename-driver",
    defaultBusinessCategoryModuleId: "pm-rename-business"
  });
  const nodeSubjectId = await insertAttributionSubjectForNewModule(db, {
    moduleId: "pm-rename-node",
    organizationId: ORG,
    kind: "node-type",
    displayName: "Node Type",
    origin: "curated",
    sourceKey: "nodetype:module-rename-node"
  });
  const autoSubjectId = await insertAttributionSubjectForNewModule(db, {
    moduleId: "pm-rename-auto",
    organizationId: ORG,
    kind: "driver-group",
    displayName: "Auto Driver Group",
    origin: "auto",
    sourceKey: "compatible:module-rename-auto",
    defaultBusinessCategoryModuleId: "pm-rename-business"
  });

  await db.query(
    `insert into parameter_modules (
       id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
       importance, kind, origin, attribution_subject_id
     ) values
       ('pm-rename-driver', $1, 'pm-rename-business', 'Driver Group', 'pm-rename-business/pm-rename-driver', 2, 0, '', '', 'medium', 'driver-group', 'curated', $2),
       ('pm-rename-node', $1, 'pm-rename-driver', 'Node Type', 'pm-rename-business/pm-rename-driver/pm-rename-node', 3, 0, '', '', 'medium', 'node-type', 'curated', $3),
       ('pm-rename-auto', $1, 'pm-rename-business', 'Auto Driver Group', 'pm-rename-business/pm-rename-auto', 2, 1, '', '', 'medium', 'driver-group', 'auto', $4)`,
    [ORG, driverSubjectId, nodeSubjectId, autoSubjectId]
  );
}

async function bootstrapLegacyDatabase(db: Database) {
  setParameterIdentityMode("legacy");
  await seedCoreGraph(db, {
    organization: { id: ORG, name: "Module Rename Org" },
    users: [{ id: USER, name: "Module Admin", email: "module-admin@example.com" }]
  });
  await db.query(
    `insert into parameter_modules (
       id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
       importance, kind, origin
     ) values ('pm-legacy', $1, null, 'Legacy Module', 'pm-legacy', 1, 0, '', '', 'medium', 'business', 'curated')`,
    [ORG]
  );
  await db.query(
    `insert into parameter_definitions (
       id, organization_id, name, description, explanation, config_format, module,
       default_range, unit, risk, parameter_module_id
     ) values ('pd-legacy', $1, 'legacy_parameter', 'legacy', 'legacy', 'ENV', 'Legacy Module', '', '', 'Low', 'pm-legacy')`,
    [ORG]
  );
}

afterEach(() => {
  setParameterIdentityMode(null);
});

describe.skipIf(!databaseAvailable)("parameter module rename after identity cutover", () => {
  it("renames every taxonomy module kind through the HTTP route after cutover", async () => {
    await withTempDatabase({ prefix: "modrename" }, async ({ db }) => {
      await bootstrapPostCutoverDatabase(db);

      const cases = [
        { id: "pm-rename-business", name: "Charging Policy" },
        { id: "pm-rename-driver", name: "Power Driver Group" },
        { id: "pm-rename-node", name: "Power Node Type" },
        { id: "pm-rename-auto", name: "Renamed Auto Driver Group" }
      ];

      const descriptionResponse = await requestJson<{ item: { id: string; description: string } }>(
        makeServer(db),
        "/api/v1/parameter-modules/pm-rename-description",
        {
          method: "PATCH",
          body: JSON.stringify({ description: "Description updated" })
        }
      );
      expect(descriptionResponse.status).toBe(200);
      expect(descriptionResponse.body).toEqual({
        item: expect.objectContaining({ id: "pm-rename-description", description: "Description updated" })
      });

      for (const testCase of cases) {
        const response = await requestJson<{ item: { id: string; name: string } }>(
          makeServer(db),
          `/api/v1/parameter-modules/${testCase.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name: testCase.name })
          }
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          item: expect.objectContaining({ id: testCase.id, name: testCase.name })
        });
      }

      const description = await db.query<{ description: string }>(
        `select description
         from parameter_modules
         where organization_id = $1 and id = 'pm-rename-description'`,
        [ORG]
      );
      expect(description.rows).toEqual([{ description: "Description updated" }]);

      const persisted = await db.query<{ id: string; name: string }>(
        `select id, name
         from parameter_modules
         where organization_id = $1
         order by id`,
        [ORG]
      );
      expect(persisted.rows).toEqual([
        { id: "pm-rename-auto", name: "Renamed Auto Driver Group" },
        { id: "pm-rename-business", name: "Charging Policy" },
        { id: "pm-rename-description", name: "Description Only" },
        { id: "pm-rename-driver", name: "Power Driver Group" },
        { id: "pm-rename-node", name: "Power Node Type" }
      ]);

      const origins = await db.query<{ id: string; origin: string }>(
        `select id, origin
         from parameter_modules
         where organization_id = $1
         order by id`,
        [ORG]
      );
      expect(origins.rows).toEqual([
        { id: "pm-rename-auto", origin: "curated" },
        { id: "pm-rename-business", origin: "curated" },
        { id: "pm-rename-description", origin: "curated" },
        { id: "pm-rename-driver", origin: "curated" },
        { id: "pm-rename-node", origin: "curated" }
      ]);

      const audit = await db.query<{ target_id: string; metadata: Record<string, unknown> }>(
        `select target_id, metadata
         from audit_events
         where organization_id = $1
           and kind = 'parameter-module-admin-update'
         order by created_at, id`,
        [ORG]
      );
      expect(audit.rows).toHaveLength(5);
      expect(audit.rows).toEqual(
        expect.arrayContaining([
          {
            target_id: "pm-rename-business",
            metadata: expect.objectContaining({ name: "Charging Policy", previousName: "Charging" })
          },
          {
            target_id: "pm-rename-driver",
            metadata: expect.objectContaining({ name: "Power Driver Group", previousName: "Driver Group" })
          },
          {
            target_id: "pm-rename-node",
            metadata: expect.objectContaining({ name: "Power Node Type", previousName: "Node Type" })
          },
          {
            target_id: "pm-rename-auto",
            metadata: expect.objectContaining({ name: "Renamed Auto Driver Group", previousName: "Auto Driver Group" })
          },
          {
            target_id: "pm-rename-description",
            metadata: expect.objectContaining({ name: "Description Only", previousName: "Description Only" })
          }
        ])
      );
    });
  });

  it("rolls back the rename when its audit write fails", async () => {
    await withTempDatabase({ prefix: "modrenameaudit" }, async ({ db }) => {
      await bootstrapPostCutoverDatabase(db);

      const authWithMissingAuditActor: AuthContext = {
        ...adminAuth(),
        user: { ...adminAuth().user, id: "missing-audit-actor" }
      };
      const response = await requestJson(
        makeServer(db, authWithMissingAuditActor),
        "/api/v1/parameter-modules/pm-rename-business",
        {
          method: "PATCH",
          body: JSON.stringify({ name: "Should Not Persist" })
        }
      );

      expect(response.status).toBe(500);

      const module = await db.query<{ name: string }>(
        `select name
         from parameter_modules
         where organization_id = $1 and id = 'pm-rename-business'`,
        [ORG]
      );
      expect(module.rows).toEqual([{ name: "Charging" }]);

      const audit = await db.query(
        `select id
         from audit_events
         where organization_id = $1 and kind = 'parameter-module-admin-update'`,
        [ORG]
      );
      expect(audit.rows).toEqual([]);
    });
  });

  it("does not update a module outside the authenticated organization", async () => {
    await withTempDatabase({ prefix: "modrenameorg" }, async ({ db }) => {
      await bootstrapPostCutoverDatabase(db);
      await seedCoreGraph(db, { organization: { id: FOREIGN_ORG, name: "Foreign Org" } });
      await db.query(
        `insert into parameter_modules (
           id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
           importance, kind, origin
         ) values ('pm-foreign', $1, null, 'Foreign Module', 'pm-foreign', 1, 0, '', '', 'medium', 'business', 'curated')`,
        [FOREIGN_ORG]
      );

      const response = await requestJson(
        makeServer(db),
        "/api/v1/parameter-modules/pm-foreign",
        {
          method: "PATCH",
          body: JSON.stringify({ name: "Should Not Cross Organizations" })
        }
      );

      expect(response.status).toBe(404);

      const foreignModule = await db.query<{ name: string }>(
        `select name
         from parameter_modules
         where organization_id = $1 and id = 'pm-foreign'`,
        [FOREIGN_ORG]
      );
      expect(foreignModule.rows).toEqual([{ name: "Foreign Module" }]);

      const audit = await db.query(
        `select id
         from audit_events
         where kind = 'parameter-module-admin-update'`,
        []
      );
      expect(audit.rows).toEqual([]);
    });
  });

  it("keeps legacy definition names synchronized before cutover", async () => {
    await withTempDatabase({ prefix: "modrenamelegacy" }, async ({ db }) => {
      await bootstrapLegacyDatabase(db);

      const response = await requestJson<{ item: { id: string; name: string } }>(
        makeServer(db),
        "/api/v1/parameter-modules/pm-legacy",
        {
          method: "PATCH",
          body: JSON.stringify({ name: "Legacy Module Renamed" })
        }
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        item: expect.objectContaining({ id: "pm-legacy", name: "Legacy Module Renamed" })
      });

      const definition = await db.query<{ module: string }>(
        `select module from parameter_definitions where id = 'pd-legacy'`
      );
      expect(definition.rows).toEqual([{ module: "Legacy Module Renamed" }]);
    });
  });
});

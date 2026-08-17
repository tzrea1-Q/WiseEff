/**
 * Post-cutover import apply must write the head binding revision and history
 * against semantic identity. It must not touch renamed PPV / definition tables.
 */
import { describe, expect, it } from "vitest";

import type { Database } from "../../shared/database/client";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase as withSharedTempDatabase } from "../../testing/tempDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import {
  applyParameterIdentityCutover,
  migrateParameterIdentities
} from "../parameter-topology/migration";
import { resolveParameterIdentityMode, setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { applyImportBatch, createImportPreview } from "./service";
import {
  applyAddedImportItem,
  applyUpdatedImportItem,
  listParameterDefinitionsForImport
} from "./importBatchRepository";

const databaseAvailable = await isTestDatabaseAvailable();
const MAINTENANCE_TOKEN = "test-maintenance-token";
const ORG = "org-import-semantic";
const PROJECT = "project-import-semantic";
const USER = "user-import-semantic";
const SPEC = "spec-import-semantic";
const BINDING = "binding-import-semantic";
const PROPERTY_KEY = "charge_voltage_limit_mv";

async function withTempDatabase(fn: (db: Database) => Promise<void>) {
  await withSharedTempDatabase({ prefix: "imp" }, ({ db }) => fn(db));
}

async function bootstrapPostCutoverImportDatabase(db: Database) {
  await seedCoreGraph(db, {
    organization: { id: ORG, name: "Import Semantic Org" },
    users: [{ id: USER, name: "Import Admin", email: "import-semantic@example.com" }],
    projects: [{ id: PROJECT, name: "Import Project", code: "IMP" }]
  });
  const report = await migrateParameterIdentities(db, {
    mode: "apply",
    maintenanceToken: MAINTENANCE_TOKEN,
    expectedMaintenanceToken: MAINTENANCE_TOKEN,
    writeLockConfirmed: true,
    dbSnapshotId: "db-snap-import-semantic",
    objectSnapshotId: "obj-snap-import-semantic"
  });
  expect(report.blockers).toEqual([]);
  await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
  await resolveParameterIdentityMode(db);

  const legacyTables = await db.query<{ table_name: string }>(
    `
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('parameter_definitions', 'project_parameter_values')
    `
  );
  expect(legacyTables.rows).toHaveLength(0);

  await seedSpecBindingGraph(db, {
    organizationId: ORG,
    specs: [
      {
        id: SPEC,
        specificationKey: `ChargingPolicy/${PROPERTY_KEY}`,
        versions: [
          {
            id: "psv-import-semantic",
            displayName: PROPERTY_KEY,
            description: "Charge voltage limit",
            valueShape: { kind: "cells", unit: "mV" }
          }
        ],
        propertySpec: { id: "dps-import-semantic", propertyKey: PROPERTY_KEY }
      }
    ],
    modules: [{ id: "pm-import-charging", name: "ChargingPolicy" }],
    configSets: [
      {
        id: "set-import-semantic",
        projectId: PROJECT,
        revisions: [{ id: "rev-import-semantic" }]
      }
    ],
    bindings: [
      {
        id: BINDING,
        projectId: PROJECT,
        parameterSpecId: SPEC,
        moduleId: "pm-import-charging",
        revisions: [
          {
            id: "bpr-import-semantic",
            configRevisionId: "rev-import-semantic",
            parameterSpecVersionId: "psv-import-semantic",
            rawValue: "<2300>"
          }
        ]
      }
    ]
  });
}

function adminAuth() {
  return makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Import Admin",
    email: "import-semantic@example.com",
    roleId: "admin"
  });
}

describe.skipIf(!databaseAvailable)("import batch post-cutover identity", () => {
  it("lists and applies updates against the head binding revision without retired PPV tables", async () => {
    await withTempDatabase(async (db) => {
      try {
        await bootstrapPostCutoverImportDatabase(db);

        const candidates = await listParameterDefinitionsForImport(db, {
          organizationId: ORG,
          projectId: PROJECT,
          names: [PROPERTY_KEY],
          definitionIds: []
        });
        expect(candidates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: SPEC,
              name: PROPERTY_KEY,
              projectParameterValueId: BINDING,
              currentValue: "<2300>"
            })
          ])
        );

        await expect(
          applyAddedImportItem(db, {
            organizationId: ORG,
            projectId: PROJECT,
            actorUserId: USER,
            historyId: "history-added-semantic",
            item: {
              id: "item-added",
              name: "brand_new_parameter",
              module: "ChargingPolicy",
              risk: "Low",
              unit: "mV",
              range: "0 - 1",
              currentValue: "<1>",
              classification: "added",
              riskFlag: false,
              definitionId: "missing-spec",
              projectParameterValueId: "missing-binding"
            }
          })
        ).rejects.toMatchObject({
          code: "GONE",
          details: expect.objectContaining({ diagnostic: "semantic-import-add-retired" })
        });

        const updated = await applyUpdatedImportItem(db, {
          organizationId: ORG,
          projectId: PROJECT,
          actorUserId: USER,
          historyId: "history-updated-semantic",
          item: {
            id: "item-updated",
            name: PROPERTY_KEY,
            module: "ChargingPolicy",
            risk: "High",
            unit: "mV",
            range: "4200 - 4500",
            currentValue: "<4350>",
            classification: "updated",
            riskFlag: false,
            definitionId: SPEC,
            projectParameterValueId: BINDING
          }
        });
        expect(updated).toEqual({
          id: BINDING,
          definitionId: SPEC,
          projectParameterValueId: BINDING,
          newVersion: 1
        });

        const head = await db.query<{ raw_value: string }>(
          `select raw_value from project_parameter_binding_revisions where binding_id = $1`,
          [BINDING]
        );
        expect(head.rows[0]?.raw_value).toBe("<4350>");

        const history = await db.query<{
          project_parameter_binding_id: string;
          parameter_spec_id: string;
          value: string;
          version: number;
        }>(
          `
          select project_parameter_binding_id, parameter_spec_id, value, version
          from parameter_history_entries
          where id = 'history-updated-semantic'
          `
        );
        expect(history.rows[0]).toEqual({
          project_parameter_binding_id: BINDING,
          parameter_spec_id: SPEC,
          value: "<4350>",
          version: 1
        });

        const preview = await createImportPreview(db, adminAuth(), {
          projectId: PROJECT,
          sourceName: "semantic-import.json",
          items: [
            {
              name: PROPERTY_KEY,
              module: "ChargingPolicy",
              risk: "High",
              unit: "mV",
              range: "4200 - 4500",
              currentValue: "<4400>",
              recommendedValue: "<4400>",
              description: "service round-trip"
            }
          ]
        });
        expect(preview.items[0]).toMatchObject({
          classification: "updated",
          projectParameterValueId: BINDING
        });

        const applied = await applyImportBatch(db, adminAuth(), { batchId: preview.id });
        expect(applied.status).toBe("applied");

        const afterApply = await db.query<{ raw_value: string }>(
          `select raw_value from project_parameter_binding_revisions where binding_id = $1`,
          [BINDING]
        );
        expect(afterApply.rows[0]?.raw_value).toBe("<4400>");

        const addedPreview = await createImportPreview(db, adminAuth(), {
          projectId: PROJECT,
          sourceName: "semantic-import-added.json",
          items: [
            {
              name: "unknown_new_parameter",
              module: "ChargingPolicy",
              risk: "Low",
              unit: "mV",
              range: "0 - 1",
              currentValue: "<1>",
              recommendedValue: "<1>"
            }
          ]
        });
        expect(addedPreview.items[0]?.classification).toBe("added");
        await expect(applyImportBatch(db, adminAuth(), { batchId: addedPreview.id })).rejects.toMatchObject({
          code: "GONE"
        });
      } finally {
        setParameterIdentityMode(null);
      }
    });
  }, 60_000);
});

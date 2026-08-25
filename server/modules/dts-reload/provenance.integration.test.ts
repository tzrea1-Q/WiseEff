import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import {
  createAgentInvocation,
  createSystemInvocation,
  createUserInvocation,
  TrustedInvocationContextError
} from "../auth/trustedInvocation";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import { openDatabaseConnection, withTempDatabase } from "../../testing/tempDatabase";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { insertReloadRun, insertReloadRunTarget } from "./repository";
import { updateOrganisationReloadConfiguration } from "./configurationService";
import {
  deployReloadRun,
  startReloadRun,
  startRestoreBaselineRun
} from "./service";
import { promoteReloadRunToDrafts } from "./promote";
import type { DtsReloadInvocationContext } from "./policy";

const databaseAvailable = await isTestDatabaseAvailable();

type MatrixContextName = "user" | "agent" | "system" | "missing" | "malformed";

type MatrixOperation = {
  name: "start-run" | "restore-baseline" | "deploy" | "configuration-update" | "promote-to-drafts";
  expectedUserCode: string;
  expectedAction: "start" | "restore" | "deploy" | "configure" | "promote";
  expectedTargetType: string;
  expectedTargetId: string;
  invoke: (
    db: Database,
    objectStore: ObjectStore,
    auth: AuthContext,
    context: unknown,
    onDeviceCall: () => void
  ) => Promise<unknown>;
};

type DomainState = {
  reloadRuns: number;
  reloadTargets: number;
  reloadConfigurations: number;
  drafts: number;
  residue: number;
  leases: number;
};

type AuditRow = {
  organization_id: string | null;
  actor_user_id: string | null;
  actor_type: "user" | "agent" | "system";
  kind: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  trace_id: string;
};

function auth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Hardware Committer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
    permissions: ["debugging:admin", "debugging:dts-reload", "debugging:view", "parameter:edit"]
  };
}

function objectStore(): ObjectStore {
  return {
    put: async (input) => ({
      storageKey: `matrix/${input.fileName}`,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSizeBytes: input.bytes.byteLength,
      checksumSha256: "matrix-sha"
    }),
    get: async () => Buffer.from("/dts-v1/;\n/ { };\n")
  };
}

async function seedMatrixGraph(db: Database): Promise<void> {
  await seedCoreGraph(db, {
    organization: { id: "org-1", name: "ChargeLab" },
    users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
    projects: [{ id: "project-1" }]
  });
  await seedSpecBindingGraph(db, {
    organizationId: "org-1",
    specs: [
      {
        id: "spec-612",
        specificationKey: "reload/binding-612/watchdog_time",
        versions: [
          {
            id: "psv-612",
            displayName: "Watchdog",
            description: "DTS reload provenance matrix target.",
            valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
          }
        ],
        propertySpec: {
          id: "dps-612",
          propertyKey: "watchdog_time",
          schemaNamespace: "dts-reload-matrix"
        }
      }
    ],
    modules: [{ id: "module-612", name: "charger", path: "/charger" }],
    configSets: [
      {
        id: "config-set-612",
        projectId: "project-1",
        revisions: [{ id: "revision-612", status: "compiled" }],
        logicalNodes: [
          {
            id: "logical-node-612",
            revisions: [
              {
                id: "logical-node-revision-612",
                configRevisionId: "revision-612",
                nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
                name: "sc8562@6E",
                compatible: "sc8562"
              }
            ]
          }
        ]
      }
    ],
    bindings: [
      {
        id: "binding-612",
        projectId: "project-1",
        parameterSpecId: "spec-612",
        moduleId: "module-612",
        logicalNodeId: "logical-node-612",
        revisions: [
          {
            id: "binding-revision-612",
            configRevisionId: "revision-612",
            parameterSpecVersionId: "psv-612",
            rawValue: "<6000>"
          }
        ]
      }
    ]
  });
  await insertReloadRun(db, {
    id: "run-612",
    organizationId: "org-1",
    projectId: "project-1",
    configRevisionId: "revision-612",
    status: "contradicted",
    purpose: "ordinary",
    failureCode: null,
    steps: [],
    diagnostics: [],
    toolVersions: { dtc: null, fdtoverlay: null },
    overlaySourceStorageKey: null,
    overlaySourceSha256: null,
    overlayArtifactStorageKey: null,
    overlayArtifactSha256: null,
    overlayArtifactBytes: null,
    createdByUserId: "user-1",
    completedAt: new Date().toISOString()
  });
  await insertReloadRunTarget(db, {
    id: "run-target-612",
    reloadRunId: "run-612",
    bindingId: "binding-612",
    nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
    propertyKey: "watchdog_time",
    baselineValue: "<6000>",
    debugValue: "<7000>",
    sortOrder: 0
  });
}

async function readDomainState(db: Database): Promise<DomainState> {
  const result = await db.query<{
    reloadRuns: string;
    reloadTargets: string;
    reloadConfigurations: string;
    drafts: string;
    residue: string;
    leases: string;
  }>(
    `select
       (select count(*)::text from dts_reload_runs) as "reloadRuns",
       (select count(*)::text from dts_reload_run_targets) as "reloadTargets",
       (select count(*)::text from dts_reload_org_defaults) as "reloadConfigurations",
       (select count(*)::text from parameter_drafts) as drafts,
       (select count(*)::text from dts_reload_device_residue) as residue,
       (select count(*)::text from debug_device_leases) as leases`
  );
  const row = result.rows[0];
  if (!row) throw new Error("DTS reload provenance matrix state query returned no row");
  return {
    reloadRuns: Number(row.reloadRuns),
    reloadTargets: Number(row.reloadTargets),
    reloadConfigurations: Number(row.reloadConfigurations),
    drafts: Number(row.drafts),
    residue: Number(row.residue),
    leases: Number(row.leases)
  };
}

async function readTraceAudits(db: Database, traceId: string): Promise<AuditRow[]> {
  const result = await db.query<AuditRow>(
    `select organization_id, actor_user_id, actor_type, kind, action, target_type, target_id, metadata, trace_id
       from audit_events
      where app = 'dts-reload' and trace_id = $1
      order by created_at asc, id asc`,
    [traceId]
  );
  return result.rows;
}

function trustedContext(
  name: MatrixContextName,
  authContext: AuthContext,
  requestId: string,
  refusalDb: Database
): unknown {
  if (name === "missing") return undefined;
  if (name === "malformed") {
    return {
      invocation: { initiator: "user", principal: authContext },
      requestId
    };
  }
  const invocation =
    name === "user"
      ? createUserInvocation(authContext)
      : name === "agent"
        ? createAgentInvocation(authContext, {
            sessionId: "session-612-agent",
            toolCallId: "tool-612-reload",
            approval: { required: true, approvalId: "approval-612" }
          })
        : createSystemInvocation({ kind: "job", name: "dts-reload-612-matrix" });
  return { invocation, requestId, refusalDb } satisfies DtsReloadInvocationContext;
}

const operations: MatrixOperation[] = [
  {
    name: "start-run",
    expectedUserCode: "VALIDATION_FAILED",
    expectedAction: "start",
    expectedTargetType: "dts-reload",
    expectedTargetId: "project-1",
    invoke: (db, store, authContext, context) =>
      Reflect.apply(startReloadRun, undefined, [
        db,
        store,
        authContext,
        { projectId: "project-1", targets: [] },
        context
      ]),
  },
  {
    name: "restore-baseline",
    expectedUserCode: "CONFLICT",
    expectedAction: "restore",
    expectedTargetType: "dts-reload",
    expectedTargetId: "project-1",
    invoke: (db, store, authContext, context) =>
      Reflect.apply(startRestoreBaselineRun, undefined, [
        db,
        store,
        authContext,
        { projectId: "project-1", deviceId: "bridge:matrix-612" },
        context
      ]),
  },
  {
    name: "deploy",
    expectedUserCode: "VALIDATION_FAILED",
    expectedAction: "deploy",
    expectedTargetType: "dts-reload-run",
    expectedTargetId: "run-612",
    invoke: (db, store, authContext, context, onDeviceCall) =>
      Reflect.apply(deployReloadRun, undefined, [
        db,
        store,
        authContext,
        {
          runId: "run-612",
          deviceId: "bridge:matrix-612",
          bridgeId: "matrix-bridge",
          targetRef: "matrix-target",
          confirmationTokens: []
        },
        {
          bridgeRpcClient: {
            call: async () => {
              onDeviceCall();
              return { ok: true };
            }
          },
          bridgeConnectionPool: { isConnected: () => true }
        },
        context
      ]),
  },
  {
    name: "configuration-update",
    expectedUserCode: "VALIDATION_FAILED",
    expectedAction: "configure",
    expectedTargetType: "dts-reload-configuration",
    expectedTargetId: "org-1",
    invoke: (db, _store, authContext, context) =>
      Reflect.apply(updateOrganisationReloadConfiguration, undefined, [db, authContext, {}, context]),
  },
  {
    name: "promote-to-drafts",
    expectedUserCode: "CONFLICT",
    expectedAction: "promote",
    expectedTargetType: "dts-reload-run",
    expectedTargetId: "run-612",
    invoke: (db, _store, authContext, context) =>
      Reflect.apply(
        promoteReloadRunToDrafts,
        undefined,
        [db, authContext, { runId: "run-612", bindingIds: ["binding-612"] }, context]
      ),
  }
];

describe.skipIf(!databaseAvailable)("DTS reload trusted provenance PostgreSQL matrix", () => {
  it("covers every public mutation entry across user, agent, system, missing, and malformed contexts", async () => {
    await withTempDatabase({ prefix: "dts_reload_provenance_612" }, async ({ db, connectionString }) => {
      await seedMatrixGraph(db);
      const refusalConnection = openDatabaseConnection(connectionString);
      const refusalDb = refusalConnection.db;
      const store = objectStore();
      let deviceCalls = 0;

      try {
        for (const operation of operations) {
          for (const contextName of ["user", "agent", "system", "missing", "malformed"] as const) {
            const requestId = `req-612-${operation.name}-${contextName}`;
            const invocationContext = trustedContext(contextName, auth(), requestId, refusalDb);
            const before = await readDomainState(db);
            const beforeAudits = await readTraceAudits(refusalDb, requestId);
            const deviceCallsBefore = deviceCalls;
            let thrown: unknown;

            await db
              .transaction(async (tx) => {
                try {
                  await operation.invoke(tx, store, auth(), invocationContext, () => {
                    deviceCalls += 1;
                  });
                } catch (error) {
                  thrown = error;
                }
                throw new Error(`rollback-${requestId}`);
              })
              .catch((error: unknown) => {
                expect(error).toMatchObject({ message: `rollback-${requestId}` });
              });

            const after = await readDomainState(db);
            expect(after, `${operation.name}/${contextName} changed domain state`).toEqual(before);
            expect(deviceCalls, `${operation.name}/${contextName} called device adapter`).toBe(deviceCallsBefore);

            if (contextName === "user") {
              expect(thrown).toMatchObject({ code: operation.expectedUserCode });
              expect(thrown).not.toBeInstanceOf(TrustedInvocationContextError);
              expect(await readTraceAudits(refusalDb, requestId)).toEqual(beforeAudits);
              continue;
            }

            if (contextName === "missing" || contextName === "malformed") {
              expect(thrown).toBeInstanceOf(TrustedInvocationContextError);
              expect(await readTraceAudits(refusalDb, requestId)).toEqual(beforeAudits);
              continue;
            }

            const expectedCode =
              contextName === "agent" ? "dts-reload-agent-refused" : "dts-reload-system-refused";
            expect(thrown).toMatchObject({
              code: "FORBIDDEN",
              status: 403,
              details: {
                code: expectedCode,
                requireHuman: true,
                initiator: contextName
              }
            });

            const audits = await readTraceAudits(refusalDb, requestId);
            expect(audits, `${operation.name}/${contextName} refusal audit`).toHaveLength(1);
            const refusal = audits[0]!;
            expect(refusal).toMatchObject({
              kind: expectedCode,
              action: "deny",
              trace_id: requestId,
              target_type: operation.expectedTargetType,
              target_id: operation.expectedTargetId,
              metadata: expect.objectContaining({
                code: expectedCode,
                requireHuman: true,
                initiator: contextName,
                action: operation.expectedAction
              })
            });
            if (contextName === "agent") {
              expect(refusal).toMatchObject({
                organization_id: "org-1",
                actor_user_id: "user-1",
                actor_type: "agent",
                metadata: expect.objectContaining({
                  sessionId: "session-612-agent",
                  toolCallId: "tool-612-reload",
                  approvalId: "approval-612"
                })
              });
            } else {
              expect(refusal).toMatchObject({
                organization_id: null,
                actor_user_id: null,
                actor_type: "system",
                metadata: expect.objectContaining({
                  systemKind: "job",
                  systemName: "dts-reload-612-matrix"
                })
              });
            }
          }
        }
      } finally {
        await refusalConnection.close();
      }
    });
  }, 120_000);

  it("rejects a branded context whose authenticated principal does not match the request auth", async () => {
    await withTempDatabase({ prefix: "dts_reload_provenance_612_mismatch" }, async ({ db }) => {
      await seedMatrixGraph(db);
      const requestId = "req-612-mismatched-principal";
      const authenticated = auth();
      const mismatchedPrincipal: AuthContext = {
        ...authenticated,
        user: { ...authenticated.user, id: "other-user" }
      };
      const before = await readDomainState(db);
      let thrown: unknown;

      await db
        .transaction(async (tx) => {
          try {
            await startReloadRun(
              tx,
              objectStore(),
              authenticated,
              { projectId: "project-1", targets: [] },
              { invocation: createUserInvocation(mismatchedPrincipal), requestId }
            );
          } catch (error) {
            thrown = error;
          }
          throw new Error(`rollback-${requestId}`);
        })
        .catch((error: unknown) => {
          expect(error).toMatchObject({ message: `rollback-${requestId}` });
        });

      expect(thrown).toBeInstanceOf(TrustedInvocationContextError);
      expect(await readTraceAudits(db, requestId)).toEqual([]);
      expect(await readDomainState(db)).toEqual(before);
    });
  });
});

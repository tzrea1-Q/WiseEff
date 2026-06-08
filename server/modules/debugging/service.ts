import { randomUUID } from "node:crypto";

import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import { createAuditEvent as defaultCreateAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext, CreateAuditEventInput } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { DebugDeviceGateway, GatewayWriteResult } from "./gateway";
import {
  getAllowedDebugProjectIds,
  requireDebugProjectAccess,
  requireDebugRead,
  requireDebugRollback,
  requireDebugView,
  requireDebugWrite
} from "./policy";
import {
  acquireDebugDeviceLease,
  claimSnapshotForRollback,
  createDebugSession,
  createDebugSnapshot,
  getDebugDevice,
  getDebugParameter,
  getDebugSession as getDebugSessionRecord,
  getDebugSnapshot,
  getDebugTarget,
  insertDebugEvent,
  insertNodeOperation,
  linkOperationSnapshot,
  listDebugDevices,
  listDebugParameters,
  listDebugSessionEvents,
  markSnapshotConsumed,
  restoreSnapshotValid,
  updateDebugParameterValues,
  upsertDetectedTargets
} from "./repository";
import type { DebugParameterRecord, DebugSessionRecord, NodeOperationRecord } from "./types";

type AuditWriter = typeof defaultCreateAuditEvent;

const DEVICE_LEASE_TTL_MS = 5 * 60 * 1000;

type ServiceOptions = {
  db: Database;
  gateway: DebugDeviceGateway;
  createAuditEvent?: AuditWriter;
  metrics?: Pick<MetricsRegistry, "recordDeviceGatewayOperation">;
  tracing?: Pick<TracingBoundary, "withSpan">;
  gatewayMode?: "simulator" | "hdc" | string;
};

type ProjectQuery = {
  projectId?: string;
};

type ScopedProjectQuery<T extends ProjectQuery> = T & {
  projectIds?: string[];
};

type DetectTargetsInput = {
  projectId: string;
  deviceId?: string;
};

type CreateSessionInput = {
  projectId: string;
  deviceId: string;
  targetId: string;
};

type ReadNodeInput = {
  sessionId: string;
  parameterId?: string;
  nodePath: string;
};

type WriteNodeInput = {
  sessionId: string;
  parameterId: string;
  value: string;
  confirmationToken?: string;
  approvalId?: string;
};

type RollbackSnapshotInput = {
  snapshotId: string;
  confirmationToken: string;
};

type ServiceContext = AuditCorrelationContext;

function organizationIdFor(auth: AuthContext) {
  return auth.organization.id || auth.user.organizationId;
}

function auditInput(
  auth: AuthContext,
  input: Omit<CreateAuditEventInput, "id" | "organizationId" | "actorUserId" | "actorType" | "app" | "traceId">,
  context: ServiceContext = {}
): CreateAuditEventInput {
  return {
    id: randomUUID(),
    organizationId: organizationIdFor(auth),
    actorUserId: auth.user.id,
    actorType: "user",
    app: "debugging",
    traceId: context.requestId ?? randomUUID(),
    ...input
  };
}

function ensureActiveSession(session: DebugSessionRecord | null): DebugSessionRecord {
  if (!session) {
    throw new ApiError("NOT_FOUND", "Debug session was not found.", 404);
  }
  if (session.status !== "active") {
    throw new ApiError("VALIDATION_FAILED", "Debug session is not active.", 400);
  }

  return session;
}

function ensureProjectMatch(actualProjectId: string, expectedProjectId: string, message: string) {
  if (actualProjectId !== expectedProjectId) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { projectId: expectedProjectId });
  }
}

function ensureReadable(parameter: DebugParameterRecord | null, session: DebugSessionRecord, nodePath: string) {
  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Debug parameter was not found.", 404);
  }
  ensureProjectMatch(parameter.projectId, session.projectId, "Parameter does not belong to the session project.");
  if (parameter.nodePath !== nodePath) {
    throw new ApiError("VALIDATION_FAILED", "Parameter does not match requested node path.", 400);
  }
  if (parameter.accessMode !== "RO" && parameter.accessMode !== "RW") {
    throw new ApiError("VALIDATION_FAILED", "Parameter is not readable.", 400);
  }
}

function ensureWritable(parameter: DebugParameterRecord | null, session: DebugSessionRecord, input: WriteNodeInput): DebugParameterRecord {
  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Debug parameter was not found.", 404);
  }
  ensureProjectMatch(parameter.projectId, session.projectId, "Parameter does not belong to the session project.");
  if (parameter.accessMode !== "WO" && parameter.accessMode !== "RW") {
    throw new ApiError("VALIDATION_FAILED", "Parameter is read-only.", 400);
  }

  const hasNumericRange = parameter.minValue !== null || parameter.maxValue !== null;
  const numericValue = Number(input.value);
  if (hasNumericRange && !Number.isFinite(numericValue)) {
    throw new ApiError("VALIDATION_FAILED", "Value must be numeric for ranged parameters.", 400, {
      minValue: parameter.minValue,
      maxValue: parameter.maxValue
    });
  }
  if (hasNumericRange) {
    if ((parameter.minValue !== null && numericValue < parameter.minValue) || (parameter.maxValue !== null && numericValue > parameter.maxValue)) {
      throw new ApiError("VALIDATION_FAILED", "Value is outside the allowed range.", 400, {
        minValue: parameter.minValue,
        maxValue: parameter.maxValue
      });
    }
  }

  if (parameter.risk === "High" && input.confirmationToken !== "confirm-high-risk-write" && !input.approvalId?.trim()) {
    throw new ApiError("VALIDATION_FAILED", "High-risk write requires confirmation or approval.", 400);
  }

  return parameter;
}

function failureReason(error: string | undefined, fallback: string) {
  return error?.trim() || fallback;
}

function writeStatus(result: GatewayWriteResult) {
  if (!result.ok) return "failed" as const;
  return result.verified ? ("succeeded" as const) : ("readback_mismatch" as const);
}

async function requireDeviceLease(tx: Queryable, auth: AuthContext, session: DebugSessionRecord) {
  const lease = await acquireDebugDeviceLease(tx, {
    organizationId: organizationIdFor(auth),
    projectId: session.projectId,
    deviceId: session.deviceId,
    sessionId: session.id,
    actorUserId: auth.user.id,
    leaseTtlMs: DEVICE_LEASE_TTL_MS
  });
  if (!lease) {
    throw new ApiError("CONFLICT", "Debug device is leased by another active session.", 409, {
      deviceId: session.deviceId,
      sessionId: session.id
    });
  }
}

function scopedProjectQuery<T extends ProjectQuery>(auth: AuthContext, query: T): ScopedProjectQuery<T> {
  if (query.projectId) {
    requireDebugProjectAccess(auth, query.projectId);
    return query;
  }

  const allowedProjectIds = getAllowedDebugProjectIds(auth);
  if (allowedProjectIds?.length === 1) {
    return { ...query, projectId: allowedProjectIds[0] };
  }
  if (allowedProjectIds && allowedProjectIds.length > 1) {
    return { ...query, projectIds: allowedProjectIds };
  }

  return query;
}

export function createDebuggingService(options: ServiceOptions) {
  const db = options.db;
  const gateway = options.gateway;
  const writeAudit = options.createAuditEvent ?? defaultCreateAuditEvent;
  const gatewayMode = options.gatewayMode ?? "unknown";
  const tracing = options.tracing;

  function recordGatewayOperation(action: "detect" | "read" | "write" | "rollback", status: string) {
    options.metrics?.recordDeviceGatewayOperation({
      mode: gatewayMode,
      action,
      status
    });
  }

  async function withGatewaySpan<T>(
    action: "detect" | "read" | "write" | "rollback",
    attributes: Record<string, string | number | boolean>,
    fn: (spanAttributes: Record<string, string | number | boolean>) => Promise<T> | T
  ) {
    const spanAttributes = {
      mode: gatewayMode,
      action,
      status: "running",
      ...attributes
    };
    if (!tracing) {
      return fn(spanAttributes);
    }
    return tracing.withSpan(`debug.gateway.${action}`, spanAttributes, () => fn(spanAttributes));
  }

  return {
    async listDevices(auth: AuthContext, query: ProjectQuery = {}) {
      requireDebugView(auth);
      const scopedQuery = scopedProjectQuery(auth, query);
      return listDebugDevices(db, { organizationId: organizationIdFor(auth), projectId: scopedQuery.projectId, projectIds: scopedQuery.projectIds });
    },

    async detectTargets(auth: AuthContext, input: DetectTargetsInput, context: ServiceContext = {}) {
      requireDebugRead(auth);
      requireDebugProjectAccess(auth, input.projectId);
      const organizationId = organizationIdFor(auth);

      if (input.deviceId) {
        const device = await getDebugDevice(db, { organizationId, deviceId: input.deviceId });
        if (!device) {
          throw new ApiError("NOT_FOUND", "Debug device was not found.", 404);
        }
        ensureProjectMatch(device.projectId, input.projectId, "Debug device does not belong to the requested project.");
      }

      const result = await withGatewaySpan("detect", { hasDeviceFilter: Boolean(input.deviceId) }, async (spanAttributes) => {
        try {
          const gatewayResult = await gateway.detectTargets({ projectId: input.projectId, deviceId: input.deviceId });
          spanAttributes.status = gatewayResult.ok ? "succeeded" : "failed";
          return gatewayResult;
        } catch (error) {
          spanAttributes.status = "failed";
          spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
          throw error;
        }
      });
      recordGatewayOperation("detect", result.ok ? "succeeded" : "failed");
      if (!result.ok) {
        await db.transaction(async (tx) => {
          await insertDebugEvent(tx, {
            organizationId,
            projectId: input.projectId,
            kind: "target-detect-failed",
            severity: "error",
            message: failureReason(result.error, "Debug target detection failed."),
            metadata: { deviceId: input.deviceId, error: result.error }
          });
        });
        throw new ApiError("DEVICE_UNAVAILABLE", failureReason(result.error, "Debug target detection failed."), 409);
      }

      return db.transaction(async (tx) => {
        const targets = await upsertDetectedTargets(tx, {
          organizationId,
          projectId: input.projectId,
          deviceId: input.deviceId ?? result.targets[0]?.deviceId ?? "",
          targets: result.targets.map((target) => ({
            id: target.id,
            targetRef: target.targetRef,
            label: target.label,
            online: target.online
          }))
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: input.projectId,
              kind: "debug-target-detect",
              action: "detect",
              severity: "Low",
              targetType: "debug-device",
              targetId: input.deviceId ?? null,
              metadata: { targetCount: targets.length, deviceId: input.deviceId }
            },
            context
          )
        );

        return targets;
      });
    },

    async listParameters(auth: AuthContext, query: ProjectQuery & { module?: string; risk?: string[] } = {}) {
      requireDebugView(auth);
      const scopedQuery = scopedProjectQuery(auth, query);
      return listDebugParameters(db, { organizationId: organizationIdFor(auth), ...scopedQuery });
    },

    async createSession(auth: AuthContext, input: CreateSessionInput, context: ServiceContext = {}) {
      requireDebugRead(auth);
      requireDebugProjectAccess(auth, input.projectId);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const device = await getDebugDevice(tx, { organizationId, deviceId: input.deviceId });
        if (!device) {
          throw new ApiError("NOT_FOUND", "Debug device was not found.", 404);
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: input.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.", 404);
        }
        ensureProjectMatch(device.projectId, input.projectId, "Debug device does not belong to the requested project.");
        ensureProjectMatch(target.projectId, input.projectId, "Debug target does not belong to the requested project.");
        if (target.deviceId !== device.id) {
          throw new ApiError("VALIDATION_FAILED", "Debug target does not belong to the requested device.", 400);
        }
        if (device.status !== "online") {
          throw new ApiError("DEVICE_UNAVAILABLE", "Debug device is offline.", 409);
        }
        if (target.status !== "detected") {
          throw new ApiError("DEVICE_UNAVAILABLE", "Debug target is not detected.", 409);
        }

        const session = await createDebugSession(tx, {
          organizationId,
          projectId: input.projectId,
          deviceId: input.deviceId,
          targetId: input.targetId,
          actorUserId: auth.user.id
        });
        await insertDebugEvent(tx, {
          organizationId,
          projectId: input.projectId,
          sessionId: session.id,
          kind: "session-created",
          severity: "info",
          message: "Debug session created.",
          metadata: { deviceId: input.deviceId, targetId: input.targetId }
        });
        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: input.projectId,
              kind: "debug-session-create",
              action: "create",
              severity: "Low",
              targetType: "debug-session",
              targetId: session.id,
              metadata: { deviceId: input.deviceId, targetId: input.targetId }
            },
            context
          )
        );

        return session;
      });
    },

    async getSession(auth: AuthContext, input: { sessionId: string }) {
      requireDebugView(auth);
      const session = await getDebugSessionRecord(db, { organizationId: organizationIdFor(auth), sessionId: input.sessionId });
      if (session) {
        requireDebugProjectAccess(auth, session.projectId);
      }
      return session;
    },

    async listSessionEvents(auth: AuthContext, input: { sessionId: string }) {
      requireDebugView(auth);
      const organizationId = organizationIdFor(auth);
      const session = await getDebugSessionRecord(db, { organizationId, sessionId: input.sessionId });
      if (!session) {
        throw new ApiError("NOT_FOUND", "Debug session was not found.", 404);
      }
      requireDebugProjectAccess(auth, session.projectId);
      return listDebugSessionEvents(db, { organizationId, sessionId: input.sessionId });
    },

    async readNode(auth: AuthContext, input: ReadNodeInput, context: ServiceContext = {}) {
      requireDebugRead(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const session = ensureActiveSession(await getDebugSessionRecord(tx, { organizationId, sessionId: input.sessionId }));
        requireDebugProjectAccess(auth, session.projectId);
        if (input.parameterId) {
          ensureReadable(await getDebugParameter(tx, { organizationId, parameterId: input.parameterId }), session, input.nodePath);
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.", 404);
        }

        const result = await withGatewaySpan("read", { hasParameterId: Boolean(input.parameterId) }, async (spanAttributes) => {
          try {
            const gatewayResult = await gateway.readNode({ targetRef: target.targetRef, nodePath: input.nodePath });
            spanAttributes.status = gatewayResult.ok ? "succeeded" : "failed";
            return gatewayResult;
          } catch (error) {
            spanAttributes.status = "failed";
            spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
            throw error;
          }
        });
        recordGatewayOperation("read", result.ok ? "succeeded" : "failed");
        const operation = await insertNodeOperation(tx, {
          organizationId,
          projectId: session.projectId,
          sessionId: session.id,
          parameterId: input.parameterId ?? null,
          nodePath: input.nodePath,
          operationType: "read",
          status: result.ok ? "succeeded" : "failed",
          readValue: result.value ?? result.stdout,
          verified: result.ok,
          failureReason: result.ok ? undefined : failureReason(result.error ?? result.stderr, "Node read failed."),
          durationMs: result.durationMs,
          actorUserId: auth.user.id
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: session.projectId,
              kind: "debug-node-read",
              action: "read",
              severity: result.ok ? "Low" : "Medium",
              targetType: "debug-node",
              targetId: input.parameterId ?? input.nodePath,
              metadata: {
                sessionId: session.id,
                operationId: operation.id,
                nodePath: input.nodePath,
                readValue: operation.readValue,
                failureReason: operation.failureReason
              }
            },
            context
          )
        );

        return operation;
      });
    },

    async writeNode(auth: AuthContext, input: WriteNodeInput, context: ServiceContext = {}) {
      requireDebugWrite(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const session = ensureActiveSession(await getDebugSessionRecord(tx, { organizationId, sessionId: input.sessionId }));
        requireDebugProjectAccess(auth, session.projectId);
        const parameter = ensureWritable(await getDebugParameter(tx, { organizationId, parameterId: input.parameterId }), session, input);
        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.", 404);
        }
        await requireDeviceLease(tx, auth, session);

        const previous = await withGatewaySpan("read", { hasParameterId: true }, async (spanAttributes) => {
          try {
            const gatewayResult = await gateway.readNode({ targetRef: target.targetRef, nodePath: parameter.nodePath });
            spanAttributes.status = gatewayResult.ok ? "succeeded" : "failed";
            return gatewayResult;
          } catch (error) {
            spanAttributes.status = "failed";
            spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
            throw error;
          }
        });
        recordGatewayOperation("read", previous.ok ? "succeeded" : "failed");
        if (!previous.ok) {
          const operation = await insertNodeOperation(tx, {
            organizationId,
            projectId: session.projectId,
            sessionId: session.id,
            parameterId: parameter.id,
            nodePath: parameter.nodePath,
            operationType: "write",
            status: "failed",
            requestedValue: input.value,
            failureReason: failureReason(previous.error ?? previous.stderr, "Pre-write read failed."),
            durationMs: previous.durationMs,
            approvalId: input.approvalId,
            actorUserId: auth.user.id
          });
          await writeAudit(
            tx,
            auditInput(
              auth,
              {
                projectId: session.projectId,
                kind: "debug-node-write",
                action: "write",
                severity: "High",
                targetType: "debug-node",
                targetId: parameter.id,
                metadata: { sessionId: session.id, operationId: operation.id, nodePath: parameter.nodePath, failureReason: operation.failureReason }
              },
              context
            )
          );
          return operation;
        }

        const previousValue = previous.value ?? previous.stdout ?? "";
        const snapshot = await createDebugSnapshot(tx, {
          organizationId,
          projectId: session.projectId,
          sessionId: session.id,
          risk: parameter.risk,
          entries: [{ parameterId: parameter.id, nodePath: parameter.nodePath, previousValue, targetValue: input.value }],
          createdByUserId: auth.user.id
        });
        const result = await withGatewaySpan("write", { requiresApproval: Boolean(input.approvalId) }, async (spanAttributes) => {
          try {
            const gatewayResult = await gateway.writeNode({ targetRef: target.targetRef, nodePath: parameter.nodePath, value: input.value, readBack: true });
            spanAttributes.status = writeStatus(gatewayResult);
            return gatewayResult;
          } catch (error) {
            spanAttributes.status = "failed";
            spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
            throw error;
          }
        });
        const status = writeStatus(result);
        recordGatewayOperation("write", status);
        const operation = await insertNodeOperation(tx, {
          organizationId,
          projectId: session.projectId,
          sessionId: session.id,
          parameterId: parameter.id,
          nodePath: parameter.nodePath,
          operationType: "write",
          status,
          requestedValue: input.value,
          previousValue,
          readValue: previousValue,
          readbackValue: result.readResult?.value ?? result.readResult?.stdout ?? result.value,
          verified: result.ok && result.verified,
          failureReason: status === "succeeded" ? undefined : failureReason(result.error ?? result.writeResult.error ?? result.readResult?.error, "Node write failed."),
          durationMs: Math.max(result.writeResult.durationMs, result.readResult?.durationMs ?? 0),
          approvalId: input.approvalId,
          snapshotId: snapshot.id,
          actorUserId: auth.user.id
        });
        await linkOperationSnapshot(tx, { organizationId, operationId: operation.id, snapshotId: snapshot.id });

        if (result.ok && result.verified) {
          await updateDebugParameterValues(tx, {
            organizationId,
            parameterId: parameter.id,
            currentValue: input.value,
            targetValue: input.value
          });
        }

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: session.projectId,
              kind: "debug-node-write",
              action: "write",
              severity: status === "succeeded" ? "Medium" : "High",
              targetType: "debug-node",
              targetId: parameter.id,
              metadata: {
                sessionId: session.id,
                operationId: operation.id,
                nodePath: parameter.nodePath,
                requestedValue: input.value,
                previousValue,
                readbackValue: operation.readbackValue,
                verified: operation.verified,
                failureReason: operation.failureReason,
                snapshotId: snapshot.id
              }
            },
            context
          )
        );

        return operation;
      });
    },

    async rollbackSnapshot(
      auth: AuthContext,
      input: RollbackSnapshotInput,
      context: ServiceContext = {}
    ): Promise<{ operations: NodeOperationRecord[]; snapshot: Awaited<ReturnType<typeof markSnapshotConsumed>> }> {
      requireDebugRollback(auth);
      if (input.confirmationToken !== "confirm-rollback") {
        throw new ApiError("VALIDATION_FAILED", "Rollback confirmation is required.", 400);
      }
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const snapshot = await getDebugSnapshot(tx, { organizationId, snapshotId: input.snapshotId });
        if (!snapshot) {
          throw new ApiError("NOT_FOUND", "Snapshot was not found.", 404);
        }
        const session = ensureActiveSession(await getDebugSessionRecord(tx, { organizationId, sessionId: snapshot.sessionId }));
        requireDebugProjectAccess(auth, session.projectId);
        if (snapshot.status !== "valid" || snapshot.sessionId !== session.id || snapshot.projectId !== session.projectId) {
          throw new ApiError("VALIDATION_FAILED", "Snapshot is not valid for this session.", 400);
        }
        const claimedSnapshot = await claimSnapshotForRollback(tx, { organizationId, snapshotId: snapshot.id });
        if (!claimedSnapshot) {
          throw new ApiError("CONFLICT", "Snapshot is already being rolled back or has been consumed.", 409);
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.", 404);
        }
        await requireDeviceLease(tx, auth, session);

        const operations: NodeOperationRecord[] = [];
        for (const entry of snapshot.entries) {
          const result = await withGatewaySpan("rollback", { entryCount: snapshot.entries.length }, async (spanAttributes) => {
            try {
              const gatewayResult = await gateway.writeNode({ targetRef: target.targetRef, nodePath: entry.nodePath, value: entry.previousValue, readBack: true });
              spanAttributes.status = writeStatus(gatewayResult);
              return gatewayResult;
            } catch (error) {
              spanAttributes.status = "failed";
              spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
              throw error;
            }
          });
          const status = writeStatus(result);
          recordGatewayOperation("rollback", status);
          operations.push(
            await insertNodeOperation(tx, {
              organizationId,
              projectId: session.projectId,
              sessionId: session.id,
              parameterId: entry.parameterId,
              nodePath: entry.nodePath,
              operationType: "rollback",
              status,
              requestedValue: entry.previousValue,
              readbackValue: result.readResult?.value ?? result.readResult?.stdout ?? result.value,
              verified: result.ok && result.verified,
              failureReason: status === "succeeded" ? undefined : failureReason(result.error ?? result.writeResult.error ?? result.readResult?.error, "Rollback write failed."),
              durationMs: Math.max(result.writeResult.durationMs, result.readResult?.durationMs ?? 0),
              snapshotId: snapshot.id,
              actorUserId: auth.user.id
            })
          );
        }

        const failed = operations.some((operation) => operation.status !== "succeeded");
        const finalSnapshot = failed
          ? await restoreSnapshotValid(tx, { organizationId, snapshotId: claimedSnapshot.id })
          : await markSnapshotConsumed(tx, { organizationId, snapshotId: claimedSnapshot.id });
        await insertDebugEvent(tx, {
          organizationId,
          projectId: session.projectId,
          sessionId: session.id,
          kind: failed ? "rollback-failed" : "rollback-succeeded",
          severity: failed ? "error" : "info",
          message: failed ? "Snapshot rollback failed." : "Snapshot rollback succeeded.",
          metadata: failed
            ? { snapshotId: claimedSnapshot.id, failures: operations.filter((operation) => operation.status !== "succeeded") }
            : { snapshotId: claimedSnapshot.id, operationCount: operations.length }
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: session.projectId,
              kind: "debug-snapshot-rollback",
              action: "rollback",
              severity: failed ? "High" : "Medium",
              targetType: "debug-snapshot",
              targetId: claimedSnapshot.id,
              metadata: { sessionId: session.id, operationIds: operations.map((operation) => operation.id), failed }
            },
            context
          )
        );

        return { operations, snapshot: finalSnapshot ?? claimedSnapshot };
      });
    }
  };
}

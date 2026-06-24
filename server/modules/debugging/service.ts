import { randomUUID } from "node:crypto";

import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import { createAuditEvent as defaultCreateAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext, CreateAuditEventInput } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { BridgeConnectionPool } from "../deviceBridge/connectionPool";
import { listBridgesForUser } from "../deviceBridge/repository";
import type { BridgeRpcClient } from "../deviceBridge/rpc";
import type { DebugDeviceGateway, GatewayWriteResult } from "./gateway";
import { createDebugDeviceGatewayRegistry, type DebugDeviceGatewayRegistry } from "./gatewayRegistry";
import {
  detectTargetsAcrossBridges,
  isBridgeBackedTargetId,
  readNodeViaBridge,
  writeNodeViaBridge
} from "./bridgeExecution";
import {
  getAllowedDebugProjectIds,
  requireDebugAdmin,
  requireDebugProjectAccess,
  requireDebugRead,
  requireDebugRollback,
  requireDebugView,
  requireDebugWrite
} from "./policy";
import {
  acquireDebugDeviceLease,
  archiveDebugParameter,
  archiveDebugParameterNodeBinding,
  claimSnapshotForRollback,
  createDebugParameter,
  createDebugSession,
  createDebugSnapshot,
  getDebugDevice,
  getDebugParameter,
  getDebugParameterNodeBinding,
  getDebugSession as getDebugSessionRecord,
  getDebugSnapshot,
  getDebugTarget,
  insertDebugEvent,
  insertNodeOperation,
  linkOperationSnapshot,
  listDebugDevices,
  listDebugParameterNodeBindings,
  listDebugParameters,
  listDebugSessionEvents,
  markSnapshotConsumed,
  restoreSnapshotValid,
  restoreDebugParameter,
  updateDebugParameter,
  updateDebugParameterValues,
  upsertDebugParameterNodeBinding,
  upsertDetectedTargets
} from "./repository";
import { defaultDebugConnectionProtocol, type DebugConnectionProtocol } from "./protocol";
import type { DebugAccessMode } from "./status";
import type {
  DebugParameterNodeBindingRecord,
  DebugParameterRecord,
  DebugParameterWithBindingsRecord,
  DebugSessionExecutionMode,
  DebugSessionRecord,
  DebugSnapshotEntry,
  DebugValueMetadata,
  NodeOperationRecord
} from "./types";
import {
  buildValueEnvelope,
  buildValuePreview,
  compareDebugValues,
  computeValueDigest,
  requiresExactRead,
  resolveDebugValueMetadata,
  validateWritePayload
} from "./valueCodec";
import { DEBUG_VALUE_KIND_COMPLEX } from "./types";

type AuditWriter = typeof defaultCreateAuditEvent;

const DEVICE_LEASE_TTL_MS = 5 * 60 * 1000;
const BRIDGE_DETECT_TIMEOUT_MS = 5_000;
const BRIDGE_NODE_TIMEOUT_MS = 10_000;

type ServiceOptions = {
  db: Database;
  gateway?: DebugDeviceGateway;
  gatewayRegistry?: DebugDeviceGatewayRegistry;
  createAuditEvent?: AuditWriter;
  metrics?: Pick<MetricsRegistry, "recordDeviceGatewayOperation">;
  tracing?: Pick<TracingBoundary, "withSpan">;
  gatewayMode?: "simulator" | "hdc" | "adb" | "multi" | string;
  bridgeConnectionPool?: Pick<BridgeConnectionPool, "isConnected">;
  bridgeRpcClient?: Pick<BridgeRpcClient, "call">;
};

type ProjectQuery = {
  projectId?: string;
};

type ParameterListQuery = ProjectQuery & {
  module?: string;
  risk?: string[];
  protocol?: DebugConnectionProtocol;
};

type AdminCoverageFilter =
  | "dual-protocol"
  | "hdc-configured"
  | "adb-configured"
  | "missing-hdc"
  | "missing-adb"
  | "archived";

type AdminParameterListQuery = ParameterListQuery & {
  includeArchived?: boolean;
  coverage?: AdminCoverageFilter;
};

type AdminParameterBindingInput = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  notes?: string | null;
};

type AdminParameterWriteInput = {
  projectId?: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  risk: DebugParameterRecord["risk"];
  unit: string;
  range: string;
  minValue?: number | null;
  maxValue?: number | null;
  currentValue: string;
  targetValue: string;
  sortOrder: number;
  enabled: boolean;
  bindings?: AdminParameterBindingInput[];
  valueKind?: DebugParameterRecord["valueKind"];
  valueFormat?: DebugParameterRecord["valueFormat"];
  normalizationMode?: DebugParameterRecord["normalizationMode"];
  maxValueBytes?: number | null;
};

type AdminParameterPatchInput = Partial<AdminParameterWriteInput> & {
  parameterId: string;
  bindings?: AdminParameterBindingInput[];
};

type AdminParameterArchiveInput = {
  parameterId: string;
  reason?: string;
};

type AdminParameterRestoreInput = {
  parameterId: string;
};

type AdminParameterBindingWriteInput = AdminParameterBindingInput & {
  parameterId: string;
};

type AdminParameterBindingArchiveInput = {
  parameterId: string;
  protocol: DebugConnectionProtocol;
};

type ScopedProjectQuery<T extends ProjectQuery> = T & {
  projectIds?: string[];
};

type DetectTargetsInput = {
  projectId: string;
  deviceId?: string;
  protocol?: DebugConnectionProtocol;
};

type CreateSessionInput = {
  projectId: string;
  deviceId: string;
  targetId: string;
  bridgeId?: string;
  protocol?: DebugConnectionProtocol;
};

type ReadNodeInput = {
  sessionId: string;
  parameterId?: string;
  nodePath?: string;
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

function resolveExecutionMode(session: DebugSessionRecord): DebugSessionExecutionMode {
  return session.executionMode ?? "server";
}

function ensureProjectMatch(actualProjectId: string, expectedProjectId: string, message: string) {
  if (actualProjectId !== expectedProjectId) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { projectId: expectedProjectId });
  }
}

function ensureParameterAllowedForSession(parameter: DebugParameterRecord, session: DebugSessionRecord) {
  if (parameter.projectId !== null && parameter.projectId !== session.projectId) {
    throw new ApiError("VALIDATION_FAILED", "Legacy project-scoped parameter does not belong to the session project.", 400, {
      projectId: session.projectId
    });
  }
}

function ensureParameterRuntimeAvailable(parameter: DebugParameterRecord) {
  if (!parameter.enabled || parameter.archivedAt !== null) {
    throw new ApiError("VALIDATION_FAILED", "Debug parameter is archived or disabled.", 400);
  }
}

function ensureReadable(parameter: DebugParameterRecord | null, session: DebugSessionRecord, accessMode: DebugAccessMode) {
  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Debug parameter was not found.", 404);
  }
  ensureParameterAllowedForSession(parameter, session);
  ensureParameterRuntimeAvailable(parameter);
  if (accessMode !== "RO" && accessMode !== "RW") {
    throw new ApiError("VALIDATION_FAILED", "Parameter is not readable.", 400);
  }
}

function ensureWritable(
  parameter: DebugParameterRecord | null,
  session: DebugSessionRecord,
  input: WriteNodeInput,
  accessMode: DebugAccessMode
): DebugParameterRecord {
  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Debug parameter was not found.", 404);
  }
  ensureParameterAllowedForSession(parameter, session);
  ensureParameterRuntimeAvailable(parameter);
  if (accessMode !== "WO" && accessMode !== "RW") {
    throw new ApiError("VALIDATION_FAILED", "Parameter is read-only.", 400);
  }

  const metadata = resolveDebugValueMetadata(parameter);

  if (metadata.valueKind === DEBUG_VALUE_KIND_COMPLEX) {
    const validation = validateWritePayload(input.value, metadata);
    if (!validation.ok) {
      throw new ApiError("VALIDATION_FAILED", validation.error, 400);
    }
  } else {
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

async function requireProtocolBinding(
  tx: Queryable,
  input: { organizationId: string; parameterId: string; protocol: DebugConnectionProtocol }
): Promise<DebugParameterNodeBindingRecord> {
  const binding = await getDebugParameterNodeBinding(tx, { ...input, includeDisabled: true });
  if (!binding) {
    throw new ApiError("DEBUG_BINDING_NOT_CONFIGURED", "Debug parameter is not configured for the selected protocol.", 400, {
      parameterId: input.parameterId,
      protocol: input.protocol
    });
  }
  if (!binding.enabled) {
    throw new ApiError("DEBUG_BINDING_DISABLED", "Debug parameter binding is disabled for the selected protocol.", 400, {
      parameterId: input.parameterId,
      protocol: input.protocol
    });
  }
  return binding;
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

function attachParameterBindings(
  parameters: DebugParameterRecord[],
  bindings: DebugParameterNodeBindingRecord[],
  protocol: DebugConnectionProtocol = defaultDebugConnectionProtocol
): DebugParameterWithBindingsRecord[] {
  const bindingsByParameterId = new Map<string, DebugParameterNodeBindingRecord[]>();
  for (const binding of bindings) {
    const existing = bindingsByParameterId.get(binding.parameterId) ?? [];
    existing.push(binding);
    bindingsByParameterId.set(binding.parameterId, existing);
  }

  return parameters.map((parameter) => {
    const parameterBindings = bindingsByParameterId.get(parameter.id) ?? [];
    return {
      ...parameter,
      selectedBinding: parameterBindings.find((binding) => binding.protocol === protocol) ?? null,
      bindings: parameterBindings
    };
  });
}

function filterByAdminCoverage(parameters: DebugParameterWithBindingsRecord[], coverage?: AdminCoverageFilter) {
  if (!coverage) return parameters;

  return parameters.filter((parameter) => {
    const hasHdc = parameter.bindings.some((binding) => binding.protocol === "hdc" && binding.enabled);
    const hasAdb = parameter.bindings.some((binding) => binding.protocol === "adb" && binding.enabled);

    switch (coverage) {
      case "dual-protocol":
        return hasHdc && hasAdb;
      case "hdc-configured":
        return hasHdc;
      case "adb-configured":
        return hasAdb;
      case "missing-hdc":
        return !hasHdc;
      case "missing-adb":
        return !hasAdb;
      case "archived":
        return parameter.archivedAt !== null;
      default:
        return true;
    }
  });
}

function legacyParameterBindingFields(input: { bindings?: AdminParameterBindingInput[] }) {
  const binding = input.bindings?.[0];
  return {
    nodePath: binding?.nodePath ?? "",
    accessMode: binding?.accessMode ?? ("RO" as DebugAccessMode)
  };
}

function parameterAuditMetadata(parameter: DebugParameterRecord, extra: Record<string, unknown> = {}) {
  return {
    parameterId: parameter.id,
    projectId: parameter.projectId,
    enabled: parameter.enabled,
    archived: parameter.archivedAt !== null,
    ...extra
  };
}

function bindingAuditMetadata(binding: DebugParameterNodeBindingRecord, extra: Record<string, unknown> = {}) {
  return {
    parameterId: binding.parameterId,
    protocol: binding.protocol,
    projectId: binding.projectId,
    enabled: binding.enabled,
    accessMode: binding.accessMode,
    hasNotes: Boolean(binding.notes?.trim()),
    ...extra
  };
}

function snapshotEntryFromWrite(
  parameter: DebugParameterRecord,
  protocol: DebugConnectionProtocol,
  nodePath: string,
  previousValue: string,
  targetValue: string,
  metadata: DebugValueMetadata
): DebugSnapshotEntry {
  const previousEnvelope = buildValueEnvelope(previousValue, metadata);
  const targetEnvelope = buildValueEnvelope(targetValue, metadata);
  return {
    parameterId: parameter.id,
    protocol,
    nodePath,
    previousValue,
    targetValue,
    valueKind: metadata.valueKind,
    valueFormat: metadata.valueFormat,
    normalizationMode: metadata.normalizationMode,
    previousDigest: previousEnvelope.digest,
    targetDigest: targetEnvelope.digest
  };
}

function resolveSnapshotEntryMetadata(entry: DebugSnapshotEntry): DebugValueMetadata {
  return resolveDebugValueMetadata({
    valueKind: entry.valueKind,
    valueFormat: entry.valueFormat,
    normalizationMode: entry.normalizationMode
  });
}

function valueAuditMetadata(raw: string | null | undefined, metadata: DebugValueMetadata) {
  if (raw === null || raw === undefined) {
    return {};
  }
  const envelope = buildValueEnvelope(raw, metadata);
  return {
    valueKind: metadata.valueKind,
    valueFormat: metadata.valueFormat,
    normalizationMode: metadata.normalizationMode,
    preview: envelope.preview,
    digest: envelope.digest,
    bytes: envelope.bytes
  };
}

function operationValueMetadata(
  metadata: DebugValueMetadata,
  values: {
    requestedValue?: string | null;
    previousValue?: string | null;
    readbackValue?: string | null;
  }
) {
  const previewSource = values.requestedValue ?? values.previousValue ?? values.readbackValue ?? "";
  return {
    valueKind: metadata.valueKind,
    valueFormat: metadata.valueFormat,
    normalizationMode: metadata.normalizationMode,
    requestedValueDigest: values.requestedValue ? computeValueDigest(values.requestedValue, metadata) : null,
    previousValueDigest: values.previousValue ? computeValueDigest(values.previousValue, metadata) : null,
    readbackValueDigest: values.readbackValue ? computeValueDigest(values.readbackValue, metadata) : null,
    valuePreview: previewSource ? buildValuePreview(previewSource) : null
  };
}

function notFound(message = "Debug parameter was not found.") {
  return new ApiError("NOT_FOUND", message, 404);
}

function hasOwn<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireGlobalDebugAdmin(auth: AuthContext) {
  if (getAllowedDebugProjectIds(auth) !== null) {
    throw new ApiError("FORBIDDEN", "Global debugging admin access is required.", 403);
  }
}

function requireDebugParameterMutationAccess(auth: AuthContext, projectId: string | null) {
  if (projectId === null) {
    requireGlobalDebugAdmin(auth);
    return;
  }
  requireDebugProjectAccess(auth, projectId);
}

function resolvePatchedNullable<T extends object, K extends keyof T, V>(input: T, key: K, existingValue: V): V | null {
  return hasOwn(input, key) ? ((input[key] as V | null | undefined) ?? null) : existingValue;
}

export function createDebuggingService(options: ServiceOptions) {
  const db = options.db;
  const gatewayRegistry =
    options.gatewayRegistry ?? createDebugDeviceGatewayRegistry(options.gateway ? { hdc: options.gateway } : {});
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
      const protocol = input.protocol ?? defaultDebugConnectionProtocol;

      if (input.deviceId) {
        const device = await getDebugDevice(db, { organizationId, deviceId: input.deviceId });
        if (!device) {
          throw new ApiError("NOT_FOUND", "Debug device was not found.", 404);
        }
        ensureProjectMatch(device.projectId, input.projectId, "Debug device does not belong to the requested project.");
      }

      const gateway = gatewayRegistry.requireGateway(protocol);
      const gatewayResult = await withGatewaySpan("detect", { hasDeviceFilter: Boolean(input.deviceId), protocol }, async (spanAttributes) => {
        try {
          const result = await gateway.detectTargets({ projectId: input.projectId, deviceId: input.deviceId });
          spanAttributes.status = result.ok ? "succeeded" : "failed";
          return result;
        } catch (error) {
          spanAttributes.status = "failed";
          spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
          throw error;
        }
      });
      recordGatewayOperation("detect", gatewayResult.ok ? "succeeded" : "failed");

      const bridgeTargets =
        options.bridgeRpcClient && options.bridgeConnectionPool
          ? await detectTargetsAcrossBridges({
              rpc: options.bridgeRpcClient,
              bridges: (
                await listBridgesForUser(db, {
                  userId: auth.user.id,
                  organizationId
                })
              )
                .filter((bridge) => bridge.revokedAt === null && options.bridgeConnectionPool?.isConnected(bridge.id))
                .map((bridge) => ({
                  id: bridge.id,
                  machineLabel: bridge.machineLabel
                })),
              protocol,
              timeoutMs: BRIDGE_DETECT_TIMEOUT_MS
            })
          : [];

      if (!gatewayResult.ok && bridgeTargets.length === 0) {
        await db.transaction(async (tx) => {
          await insertDebugEvent(tx, {
            organizationId,
            projectId: input.projectId,
            kind: "target-detect-failed",
            severity: "error",
            message: failureReason(gatewayResult.error, "Debug target detection failed."),
            metadata: { deviceId: input.deviceId, protocol, error: gatewayResult.error }
          });
        });
        throw new ApiError("DEVICE_UNAVAILABLE", failureReason(gatewayResult.error, "Debug target detection failed."), 409);
      }

      const persistedTargets = [
        ...(gatewayResult.ok
          ? gatewayResult.targets.map((target) => ({
              id: target.id,
              deviceId: target.deviceId,
              protocol,
              targetRef: target.targetRef,
              label: target.label,
              online: target.online
            }))
          : []),
        ...bridgeTargets
      ];

      return db.transaction(async (tx) => {
        const targets = await upsertDetectedTargets(tx, {
          organizationId,
          projectId: input.projectId,
          targets: persistedTargets
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
              metadata: {
                targetCount: targets.length,
                serverTargetCount: gatewayResult.ok ? gatewayResult.targets.length : 0,
                bridgeTargetCount: bridgeTargets.length,
                deviceId: input.deviceId,
                protocol
              }
            },
            context
          )
        );

        return targets;
      });
    },

    async listParameters(auth: AuthContext, query: ParameterListQuery = {}) {
      requireDebugView(auth);
      const scopedQuery = scopedProjectQuery(auth, query);
      const organizationId = organizationIdFor(auth);
      const parameters = await listDebugParameters(db, { organizationId, ...scopedQuery });
      if (!query.protocol || parameters.length === 0) {
        return parameters;
      }

      const bindings = await listDebugParameterNodeBindings(db, {
        organizationId,
        projectId: scopedQuery.projectId,
        parameterIds: parameters.map((parameter) => parameter.id),
        protocol: query.protocol
      });
      return attachParameterBindings(parameters, bindings, query.protocol).filter((parameter) => parameter.selectedBinding?.enabled === true);
    },

    async listAdminParameters(auth: AuthContext, query: AdminParameterListQuery = {}) {
      requireDebugAdmin(auth);
      const scopedQuery = scopedProjectQuery(auth, query);
      const organizationId = organizationIdFor(auth);
      const parameters = await listDebugParameters(db, {
        organizationId,
        ...scopedQuery,
        includeArchived: query.includeArchived || query.coverage === "archived"
      });
      if (parameters.length === 0) {
        return [];
      }

      const bindings = await listDebugParameterNodeBindings(db, {
        organizationId,
        projectId: scopedQuery.projectId,
        parameterIds: parameters.map((parameter) => parameter.id),
        protocol: query.protocol
      });
      return filterByAdminCoverage(attachParameterBindings(parameters, bindings, query.protocol), query.coverage);
    },

    async createAdminParameter(auth: AuthContext, input: AdminParameterWriteInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      requireDebugParameterMutationAccess(auth, input.projectId ?? null);
      const organizationId = organizationIdFor(auth);
      const { nodePath, accessMode } = legacyParameterBindingFields(input);

      return db.transaction(async (tx) => {
        const parameter = await createDebugParameter(tx, {
          organizationId,
          projectId: input.projectId ?? null,
          name: input.name,
          key: input.key,
          description: input.description,
          module: input.module,
          nodePath,
          accessMode,
          unit: input.unit,
          range: input.range,
          minValue: input.minValue ?? null,
          maxValue: input.maxValue ?? null,
          risk: input.risk,
          currentValue: input.currentValue,
          targetValue: input.targetValue,
          sortOrder: input.sortOrder,
          enabled: input.enabled,
          valueKind: input.valueKind,
          valueFormat: input.valueFormat,
          normalizationMode: input.normalizationMode,
          maxValueBytes: input.maxValueBytes ?? null
        });
        for (const bindingInput of input.bindings ?? []) {
          const binding = await upsertDebugParameterNodeBinding(tx, {
            organizationId,
            projectId: parameter.projectId,
            parameterId: parameter.id,
            protocol: bindingInput.protocol,
            nodePath: bindingInput.nodePath,
            accessMode: bindingInput.accessMode,
            enabled: bindingInput.enabled,
            notes: bindingInput.notes
          });
          if (!binding) {
            throw notFound();
          }
        }
        const bindings = await listDebugParameterNodeBindings(tx, {
          organizationId,
          projectId: parameter.projectId ?? undefined,
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: parameter.projectId,
              kind: "debug-parameter-admin-create",
              action: "create",
              severity: "Medium",
              targetType: "debug-parameter",
              targetId: parameter.id,
              metadata: parameterAuditMetadata(parameter, {
                bindingCount: bindings.length,
                protocols: bindings.map((binding) => binding.protocol)
              })
            },
            context
          )
        );

        return attachParameterBindings([parameter], bindings, input.bindings?.[0]?.protocol)[0];
      });
    },

    async updateAdminParameter(auth: AuthContext, input: AdminParameterPatchInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const existing = await getDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        if (!existing) {
          throw notFound();
        }
        requireDebugParameterMutationAccess(auth, existing.projectId);
        const projectId = resolvePatchedNullable(input, "projectId", existing.projectId);
        requireDebugParameterMutationAccess(auth, projectId);
        const existingBindings = await listDebugParameterNodeBindings(tx, {
          organizationId,
          projectId: existing.projectId ?? undefined,
          parameterIds: [existing.id]
        });
        const { nodePath, accessMode } =
          input.bindings !== undefined ? legacyParameterBindingFields(input) : { nodePath: existing.nodePath, accessMode: existing.accessMode };
        const parameter = await updateDebugParameter(tx, {
          organizationId,
          parameterId: input.parameterId,
          projectId,
          name: input.name ?? existing.name,
          key: input.key ?? existing.key,
          description: input.description ?? existing.description,
          module: input.module ?? existing.module,
          nodePath,
          accessMode,
          unit: input.unit ?? existing.unit,
          range: input.range ?? existing.range,
          minValue: resolvePatchedNullable(input, "minValue", existing.minValue),
          maxValue: resolvePatchedNullable(input, "maxValue", existing.maxValue),
          risk: input.risk ?? existing.risk,
          currentValue: input.currentValue ?? existing.currentValue,
          targetValue: input.targetValue ?? existing.targetValue,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          enabled: input.enabled ?? existing.enabled,
          valueKind: input.valueKind ?? existing.valueKind,
          valueFormat: input.valueFormat ?? existing.valueFormat,
          normalizationMode: input.normalizationMode ?? existing.normalizationMode,
          maxValueBytes: resolvePatchedNullable(input, "maxValueBytes", existing.maxValueBytes)
        });
        if (!parameter) {
          throw notFound();
        }

        const coveredProtocols = new Set<DebugConnectionProtocol>();
        for (const bindingInput of input.bindings ?? []) {
          coveredProtocols.add(bindingInput.protocol);
          const binding = await upsertDebugParameterNodeBinding(tx, {
            organizationId,
            projectId: parameter.projectId,
            parameterId: parameter.id,
            protocol: bindingInput.protocol,
            nodePath: bindingInput.nodePath,
            accessMode: bindingInput.accessMode,
            enabled: bindingInput.enabled,
            notes: bindingInput.notes
          });
          if (!binding) {
            throw notFound();
          }
        }
        if (existing.projectId !== parameter.projectId) {
          for (const binding of existingBindings) {
            if (coveredProtocols.has(binding.protocol)) {
              continue;
            }
            const rebasedBinding = await upsertDebugParameterNodeBinding(tx, {
              organizationId,
              projectId: parameter.projectId,
              parameterId: parameter.id,
              protocol: binding.protocol,
              nodePath: binding.nodePath,
              accessMode: binding.accessMode,
              enabled: binding.enabled,
              notes: binding.notes
            });
            if (!rebasedBinding) {
              throw notFound();
            }
          }
        }
        const bindings = await listDebugParameterNodeBindings(tx, {
          organizationId,
          projectId: parameter.projectId ?? undefined,
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: parameter.projectId,
              kind: "debug-parameter-admin-update",
              action: "update",
              severity: "Medium",
              targetType: "debug-parameter",
              targetId: parameter.id,
              metadata: parameterAuditMetadata(parameter, {
                bindingCount: bindings.length,
                protocols: bindings.map((binding) => binding.protocol)
              })
            },
            context
          )
        );

        return attachParameterBindings([parameter], bindings, input.bindings?.[0]?.protocol)[0];
      });
    },

    async archiveAdminParameter(auth: AuthContext, input: AdminParameterArchiveInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const existing = await getDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        if (!existing) {
          throw notFound();
        }
        requireDebugParameterMutationAccess(auth, existing.projectId);
        const parameter = await archiveDebugParameter(tx, {
          organizationId,
          parameterId: input.parameterId,
          actorUserId: auth.user.id,
          reason: input.reason
        });
        if (!parameter) {
          throw notFound();
        }
        const bindings = await listDebugParameterNodeBindings(tx, {
          organizationId,
          projectId: parameter.projectId ?? undefined,
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: parameter.projectId,
              kind: "debug-parameter-admin-archive",
              action: "archive",
              severity: "Medium",
              targetType: "debug-parameter",
              targetId: parameter.id,
              metadata: parameterAuditMetadata(parameter, { hasReason: Boolean(input.reason?.trim()) })
            },
            context
          )
        );

        return attachParameterBindings([parameter], bindings, defaultDebugConnectionProtocol)[0];
      });
    },

    async restoreAdminParameter(auth: AuthContext, input: AdminParameterRestoreInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const existing = await getDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        if (!existing) {
          throw notFound();
        }
        requireDebugParameterMutationAccess(auth, existing.projectId);
        const parameter = await restoreDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        if (!parameter) {
          throw notFound();
        }
        const bindings = await listDebugParameterNodeBindings(tx, {
          organizationId,
          projectId: parameter.projectId ?? undefined,
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: parameter.projectId,
              kind: "debug-parameter-admin-restore",
              action: "restore",
              severity: "Medium",
              targetType: "debug-parameter",
              targetId: parameter.id,
              metadata: parameterAuditMetadata(parameter)
            },
            context
          )
        );

        return attachParameterBindings([parameter], bindings, defaultDebugConnectionProtocol)[0];
      });
    },

    async upsertAdminParameterBinding(auth: AuthContext, input: AdminParameterBindingWriteInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const parameter = await getDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        if (!parameter) {
          throw notFound();
        }
        requireDebugParameterMutationAccess(auth, parameter.projectId);
        const binding = await upsertDebugParameterNodeBinding(tx, {
          organizationId,
          projectId: parameter.projectId,
          parameterId: input.parameterId,
          protocol: input.protocol,
          nodePath: input.nodePath,
          accessMode: input.accessMode,
          enabled: input.enabled,
          notes: input.notes
        });
        if (!binding) {
          throw notFound();
        }

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: binding.projectId,
              kind: "debug-parameter-binding-admin-upsert",
              action: "update",
              severity: "Medium",
              targetType: "debug-parameter-binding",
              targetId: `${binding.parameterId}:${binding.protocol}`,
              metadata: bindingAuditMetadata(binding)
            },
            context
          )
        );

        return binding;
      });
    },

    async archiveAdminParameterBinding(auth: AuthContext, input: AdminParameterBindingArchiveInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const parameter = await getDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        if (!parameter) {
          throw notFound();
        }
        requireDebugParameterMutationAccess(auth, parameter.projectId);
        const binding = await archiveDebugParameterNodeBinding(tx, {
          organizationId,
          parameterId: input.parameterId,
          protocol: input.protocol
        });
        if (!binding) {
          throw notFound("Debug parameter binding was not found.");
        }

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: binding.projectId,
              kind: "debug-parameter-binding-admin-archive",
              action: "archive",
              severity: "Medium",
              targetType: "debug-parameter-binding",
              targetId: `${binding.parameterId}:${binding.protocol}`,
              metadata: bindingAuditMetadata(binding)
            },
            context
          )
        );

        return binding;
      });
    },

    async createSession(auth: AuthContext, input: CreateSessionInput, context: ServiceContext = {}) {
      requireDebugRead(auth);
      requireDebugProjectAccess(auth, input.projectId);
      const organizationId = organizationIdFor(auth);
      const protocol = input.protocol ?? defaultDebugConnectionProtocol;

      return db.transaction(async (tx) => {
        const bridgeExecutionRequested = isBridgeBackedTargetId(input.targetId);
        const device = bridgeExecutionRequested ? null : await getDebugDevice(tx, { organizationId, deviceId: input.deviceId });
        if (!bridgeExecutionRequested && !device) {
          throw new ApiError("NOT_FOUND", "Debug device was not found.", 404);
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: input.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.", 404);
        }
        if (device) {
          ensureProjectMatch(device.projectId, input.projectId, "Debug device does not belong to the requested project.");
        }
        ensureProjectMatch(target.projectId, input.projectId, "Debug target does not belong to the requested project.");
        if (target.deviceId !== input.deviceId) {
          throw new ApiError("VALIDATION_FAILED", "Debug target does not belong to the requested device.", 400);
        }
        if (device && device.status !== "online") {
          throw new ApiError("DEVICE_UNAVAILABLE", "Debug device is offline.", 409);
        }
        if (target.status !== "detected") {
          throw new ApiError("DEVICE_UNAVAILABLE", "Debug target is not detected.", 409);
        }
        if (target.protocol !== protocol) {
          throw new ApiError("VALIDATION_FAILED", "Debug target protocol does not match the requested protocol.", 400, {
            targetProtocol: target.protocol,
            protocol
          });
        }

        const bridgeExecution = isBridgeBackedTargetId(target.id) || target.bridgeId !== null;
        let bridgeId: string | null = null;
        let bridgeMachineLabel: string | null = null;
        let executionMode: DebugSessionExecutionMode = "server";

        if (bridgeExecution) {
          if (!input.bridgeId) {
            throw new ApiError("VALIDATION_FAILED", "bridgeId is required for bridge-backed targets.", 400);
          }
          if (target.bridgeId && target.bridgeId !== input.bridgeId) {
            throw new ApiError("VALIDATION_FAILED", "Provided bridgeId does not match the selected debug target.", 400, {
              bridgeId: input.bridgeId,
              targetBridgeId: target.bridgeId
            });
          }
          if (!options.bridgeConnectionPool?.isConnected(input.bridgeId)) {
            throw new ApiError("DEVICE_UNAVAILABLE", "Selected device bridge is offline.", 409, { bridgeId: input.bridgeId });
          }

          const userBridges = await listBridgesForUser(tx, { userId: auth.user.id, organizationId });
          const bridge = userBridges.find((item) => item.id === input.bridgeId && item.revokedAt === null);
          if (!bridge) {
            throw new ApiError("NOT_FOUND", "Device bridge was not found.", 404, { bridgeId: input.bridgeId });
          }

          bridgeId = input.bridgeId;
          bridgeMachineLabel = bridge.machineLabel;
          executionMode = "bridge";
        } else {
          gatewayRegistry.requireGateway(protocol);
        }

        const session = await createDebugSession(tx, {
          organizationId,
          projectId: input.projectId,
          deviceId: input.deviceId,
          targetId: input.targetId,
          protocol,
          executionMode,
          bridgeId,
          bridgeMachineLabel,
          actorUserId: auth.user.id
        });
        await insertDebugEvent(tx, {
          organizationId,
          projectId: input.projectId,
          sessionId: session.id,
          kind: "session-created",
          severity: "info",
          message: "Debug session created.",
          metadata: { deviceId: input.deviceId, targetId: input.targetId, protocol, executionMode, bridgeId }
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
              metadata: { deviceId: input.deviceId, targetId: input.targetId, protocol, executionMode, bridgeId }
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
        const protocol = session.protocol ?? defaultDebugConnectionProtocol;
        const parameter = input.parameterId ? await getDebugParameter(tx, { organizationId, parameterId: input.parameterId }) : null;
        const binding = input.parameterId
          ? await requireProtocolBinding(tx, { organizationId, parameterId: input.parameterId, protocol })
          : null;
        const nodePath = binding?.nodePath ?? input.nodePath;
        if (!nodePath) {
          throw new ApiError("VALIDATION_FAILED", "parameterId or nodePath is required.", 400);
        }
        if (input.parameterId) {
          ensureReadable(parameter, session, binding?.accessMode ?? "RW");
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.", 404);
        }
        const executionMode = resolveExecutionMode(session);
        const bridgeId = session.bridgeId;
        if (executionMode === "bridge" && !bridgeId) {
          throw new ApiError("VALIDATION_FAILED", "Bridge-backed session is missing bridge id.", 400);
        }
        if (executionMode === "bridge" && !options.bridgeRpcClient) {
          throw new ApiError("INTERNAL_ERROR", "Bridge RPC client is required for bridge-backed sessions.", 500);
        }
        const gateway = executionMode === "server" ? gatewayRegistry.requireGateway(protocol) : null;

        const readMetadata = parameter ? resolveDebugValueMetadata(parameter) : null;
        const preserveExactRead = readMetadata ? requiresExactRead(readMetadata) : false;

        const result = await withGatewaySpan("read", { hasParameterId: Boolean(input.parameterId), protocol }, async (spanAttributes) => {
          try {
            const gatewayResult =
              executionMode === "bridge"
                ? await readNodeViaBridge({
                    rpc: options.bridgeRpcClient as Pick<BridgeRpcClient, "call">,
                    bridgeId: bridgeId as string,
                    protocol,
                    targetRef: target.targetRef,
                    nodePath,
                    preserveExactRead,
                    timeoutMs: BRIDGE_NODE_TIMEOUT_MS
                  })
                : await gateway!.readNode({ targetRef: target.targetRef, nodePath, preserveExactRead });
            spanAttributes.status = gatewayResult.ok ? "succeeded" : "failed";
            return gatewayResult;
          } catch (error) {
            spanAttributes.status = "failed";
            spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
            throw error;
          }
        });
        recordGatewayOperation("read", result.ok ? "succeeded" : "failed");
        const readValue = result.value ?? result.stdout ?? null;
        const operationMetadata = readMetadata
          ? operationValueMetadata(readMetadata, { readbackValue: readValue ?? undefined })
          : {};
        const operation = await insertNodeOperation(tx, {
          organizationId,
          projectId: session.projectId,
          sessionId: session.id,
          parameterId: input.parameterId ?? null,
          protocol,
          nodePath,
          operationType: "read",
          status: result.ok ? "succeeded" : "failed",
          readValue: readValue ?? undefined,
          verified: result.ok,
          failureReason: result.ok ? undefined : failureReason(result.error ?? result.stderr, "Node read failed."),
          durationMs: result.durationMs,
          ...operationMetadata,
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
              targetId: input.parameterId ?? nodePath,
              metadata: {
                sessionId: session.id,
                operationId: operation.id,
                protocol,
                nodePath,
                ...(readMetadata ? valueAuditMetadata(readValue ?? undefined, readMetadata) : { readValue: operation.readValue }),
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
        const protocol = session.protocol ?? defaultDebugConnectionProtocol;
        const parameterRecord = await getDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        const binding = await requireProtocolBinding(tx, { organizationId, parameterId: input.parameterId, protocol });
        const parameter = ensureWritable(parameterRecord, session, input, binding.accessMode);
        const nodePath = binding.nodePath;
        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.", 404);
        }
        const executionMode = resolveExecutionMode(session);
        const bridgeId = session.bridgeId;
        if (executionMode === "bridge" && !bridgeId) {
          throw new ApiError("VALIDATION_FAILED", "Bridge-backed session is missing bridge id.", 400);
        }
        if (executionMode === "bridge" && !options.bridgeRpcClient) {
          throw new ApiError("INTERNAL_ERROR", "Bridge RPC client is required for bridge-backed sessions.", 500);
        }
        const gateway = executionMode === "server" ? gatewayRegistry.requireGateway(protocol) : null;
        await requireDeviceLease(tx, auth, session);
        const metadata = resolveDebugValueMetadata(parameter);
        const preserveExactRead = requiresExactRead(metadata);
        const compareReadback = (written: string, read: string) => compareDebugValues(written, read, metadata);

        const previous = await withGatewaySpan("read", { hasParameterId: true, protocol }, async (spanAttributes) => {
          try {
            const gatewayResult =
              executionMode === "bridge"
                ? await readNodeViaBridge({
                    rpc: options.bridgeRpcClient as Pick<BridgeRpcClient, "call">,
                    bridgeId: bridgeId as string,
                    protocol,
                    targetRef: target.targetRef,
                    nodePath,
                    preserveExactRead,
                    timeoutMs: BRIDGE_NODE_TIMEOUT_MS
                  })
                : await gateway!.readNode({ targetRef: target.targetRef, nodePath, preserveExactRead });
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
          const operationMetadata = operationValueMetadata(metadata, { requestedValue: input.value });
          const operation = await insertNodeOperation(tx, {
            organizationId,
            projectId: session.projectId,
            sessionId: session.id,
            parameterId: parameter.id,
            protocol,
            nodePath,
            operationType: "write",
            status: "failed",
            requestedValue: input.value,
            failureReason: failureReason(previous.error ?? previous.stderr, "Pre-write read failed."),
            durationMs: previous.durationMs,
            approvalId: input.approvalId,
            ...operationMetadata,
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
                metadata: {
                  sessionId: session.id,
                  operationId: operation.id,
                  protocol,
                  nodePath,
                  ...valueAuditMetadata(input.value, metadata),
                  failureReason: operation.failureReason
                }
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
          entries: [snapshotEntryFromWrite(parameter, protocol, nodePath, previousValue, input.value, metadata)],
          createdByUserId: auth.user.id
        });
        const result = await withGatewaySpan("write", { requiresApproval: Boolean(input.approvalId), protocol }, async (spanAttributes) => {
          try {
            const gatewayResult =
              executionMode === "bridge"
                ? await writeNodeViaBridge({
                    rpc: options.bridgeRpcClient as Pick<BridgeRpcClient, "call">,
                    bridgeId: bridgeId as string,
                    protocol,
                    targetRef: target.targetRef,
                    nodePath,
                    value: input.value,
                    readBack: true,
                    preserveExactRead,
                    compareReadback,
                    timeoutMs: BRIDGE_NODE_TIMEOUT_MS
                  })
                : await gateway!.writeNode({
                    targetRef: target.targetRef,
                    nodePath,
                    value: input.value,
                    readBack: true,
                    preserveExactRead,
                    compareReadback
                  });
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
        const readbackValue = result.readResult?.value ?? result.readResult?.stdout ?? result.value ?? null;
        const operationMetadata = operationValueMetadata(metadata, {
          requestedValue: input.value,
          previousValue,
          readbackValue: readbackValue ?? undefined
        });
        const operation = await insertNodeOperation(tx, {
          organizationId,
          projectId: session.projectId,
          sessionId: session.id,
          parameterId: parameter.id,
          protocol,
          nodePath,
          operationType: "write",
          status,
          requestedValue: input.value,
          previousValue,
          readValue: previousValue,
          readbackValue: readbackValue ?? undefined,
          verified: result.ok && result.verified,
          failureReason: status === "succeeded" ? undefined : failureReason(result.error ?? result.writeResult.error ?? result.readResult?.error, "Node write failed."),
          durationMs: Math.max(result.writeResult.durationMs, result.readResult?.durationMs ?? 0),
          approvalId: input.approvalId,
          snapshotId: snapshot.id,
          ...operationMetadata,
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
                protocol,
                nodePath,
                ...valueAuditMetadata(input.value, metadata),
                previous: valueAuditMetadata(previousValue, metadata),
                readback: readbackValue ? valueAuditMetadata(readbackValue, metadata) : undefined,
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
        const protocol = session.protocol ?? defaultDebugConnectionProtocol;
        const executionMode = resolveExecutionMode(session);
        const bridgeId = session.bridgeId;
        if (executionMode === "bridge" && !bridgeId) {
          throw new ApiError("VALIDATION_FAILED", "Bridge-backed session is missing bridge id.", 400);
        }
        if (executionMode === "bridge" && !options.bridgeRpcClient) {
          throw new ApiError("INTERNAL_ERROR", "Bridge RPC client is required for bridge-backed sessions.", 500);
        }
        const gateway = executionMode === "server" ? gatewayRegistry.requireGateway(protocol) : null;
        await requireDeviceLease(tx, auth, session);

        const operations: NodeOperationRecord[] = [];
        for (const entry of snapshot.entries) {
          const entryProtocol = entry.protocol ?? protocol;
          if (entryProtocol !== protocol) {
            throw new ApiError("VALIDATION_FAILED", "Snapshot protocol does not match the rollback session.", 400);
          }
          const entryMetadata = resolveSnapshotEntryMetadata(entry);
          const preserveExactRead = requiresExactRead(entryMetadata);
          const compareReadback = (written: string, read: string) => compareDebugValues(written, read, entryMetadata);
          const result = await withGatewaySpan("rollback", { entryCount: snapshot.entries.length, protocol }, async (spanAttributes) => {
            try {
              const gatewayResult =
                executionMode === "bridge"
                  ? await writeNodeViaBridge({
                      rpc: options.bridgeRpcClient as Pick<BridgeRpcClient, "call">,
                      bridgeId: bridgeId as string,
                      protocol,
                      targetRef: target.targetRef,
                      nodePath: entry.nodePath,
                      value: entry.previousValue,
                      readBack: true,
                      preserveExactRead,
                      compareReadback,
                      timeoutMs: BRIDGE_NODE_TIMEOUT_MS
                    })
                  : await gateway!.writeNode({
                      targetRef: target.targetRef,
                      nodePath: entry.nodePath,
                      value: entry.previousValue,
                      readBack: true,
                      preserveExactRead,
                      compareReadback
                    });
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
          const readbackValue = result.readResult?.value ?? result.readResult?.stdout ?? result.value ?? null;
          operations.push(
            await insertNodeOperation(tx, {
              organizationId,
              projectId: session.projectId,
              sessionId: session.id,
              parameterId: entry.parameterId,
              protocol,
              nodePath: entry.nodePath,
              operationType: "rollback",
              status,
              requestedValue: entry.previousValue,
              readbackValue: readbackValue ?? undefined,
              verified: result.ok && result.verified,
              failureReason: status === "succeeded" ? undefined : failureReason(result.error ?? result.writeResult.error ?? result.readResult?.error, "Rollback write failed."),
              durationMs: Math.max(result.writeResult.durationMs, result.readResult?.durationMs ?? 0),
              snapshotId: snapshot.id,
              ...operationValueMetadata(entryMetadata, {
                requestedValue: entry.previousValue,
                readbackValue: readbackValue ?? undefined
              }),
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
            ? { snapshotId: claimedSnapshot.id, protocol, failures: operations.filter((operation) => operation.status !== "succeeded") }
            : { snapshotId: claimedSnapshot.id, protocol, operationCount: operations.length }
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
              metadata: { sessionId: session.id, protocol, operationIds: operations.map((operation) => operation.id), failed }
            },
            context
          )
        );

        return { operations, snapshot: finalSnapshot ?? claimedSnapshot };
      });
    }
  };
}

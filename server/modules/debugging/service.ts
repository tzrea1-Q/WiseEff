import { randomUUID } from "node:crypto";

import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import { createAuditEvent as defaultCreateAuditEvent } from "../audit/repository";
import { notifyDebugNodeWriteFailed, notifyDebugSnapshotRollback } from "../notifications/producers";
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
import { assertDeviceRollbackAuthorization, assertDeviceWriteAuthorization } from "./deviceWriteApproval";
import {
  requireDebugAdmin,
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
  resolveDebugNodeIdByBinding,
  restoreSnapshotValid,
  restoreDebugParameter,
  updateDebugParameter,
  updateDebugParameterValues,
  upsertDebugParameterNodeBinding,
  upsertDetectedTargets
} from "./repository";
import {
  archiveDebugNodeBinding,
  countDebugNodesForModule,
  createDebugNode,
  deleteDebugNode,
  createDebugNodeModule,
  getDebugNode,
  getDebugNodeBinding,
  getDebugNodeModuleById,
  getDebugNodeModuleByName,
  listDebugNodeBindings,
  listDebugNodeModules,
  listDebugNodes,
  listRuntimeDebugNodes,
  moveDebugNodeModule,
  renameDebugNodeModuleReferences,
  updateDebugNode,
  updateDebugNodeModule,
  deleteDebugNodeModuleById,
  countDebugNodesForModuleId,
  upsertDebugNodeBinding
} from "./catalogSplitRepository";
import { defaultDebugConnectionProtocol, type DebugConnectionProtocol } from "./protocol";
import type { DebugAccessMode, DebugOperationType } from "./status";
import type {
  DebugNodeBindingRecord,
  DebugNodeModuleRecord,
  DebugNodeRecord,
  DebugNodeWithBindingsRecord,
  DebugParameterNodeBindingRecord,
  DebugParameterRecord,
  DebugParameterWithBindingsRecord,
  DebugRuntimeNodeRecord,
  DebugSessionExecutionMode,
  DebugSessionKind,
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
import {
  DEBUG_VALUE_KIND_COMPLEX
} from "./types";

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

type ParameterListQuery = {
  module?: string;
  moduleId?: string;
  includeDescendants?: boolean;
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

type AdminNodeBindingInput = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  notes?: string | null;
};

type AdminNodeWriteInput = {
  name: string;
  description?: string;
  detailedDescription?: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  module?: string;
  moduleId?: string;
  valueKind?: DebugParameterRecord["valueKind"];
  valueFormat?: DebugParameterRecord["valueFormat"];
  normalizationMode?: DebugParameterRecord["normalizationMode"];
  maxValueBytes?: number | null;
  enabled?: boolean;
  bindings?: AdminNodeBindingInput[];
};

type AdminNodePatchInput = Partial<Omit<AdminNodeWriteInput, "name">> & {
  nodeId: string;
  name?: string;
};

type AdminNodeBindingWriteInput = AdminNodeBindingInput & {
  nodeId: string;
};

type AdminNodeBindingArchiveInput = {
  nodeId: string;
  protocol: DebugConnectionProtocol;
};

type AdminDebugModuleWriteInput = {
  name: string;
  parentId?: string | null;
  description?: string;
  scope?: string;
  sortOrder?: number;
};

type AdminDebugModulePatchInput = Partial<Omit<AdminDebugModuleWriteInput, "parentId">> & {
  moduleId: string;
};

type AdminDebugModuleMoveInput = {
  moduleId: string;
  parentId: string | null;
};

type RuntimeNodeSource = DebugRuntimeNodeRecord | { node: DebugNodeRecord; binding: DebugNodeBindingRecord };

type DetectTargetsInput = {
  deviceId?: string;
  bridgeId?: string;
  protocol?: DebugConnectionProtocol;
};

type CreateSessionInput = {
  deviceId: string;
  targetId: string;
  bridgeId?: string;
  protocol?: DebugConnectionProtocol;
  sessionKind?: DebugSessionKind;
};

type ReadNodeInput = {
  sessionId: string;
  parameterId?: string;
  nodeId?: string;
  nodePath?: string;
};

type WriteNodeInput = {
  sessionId: string;
  parameterId?: string;
  nodeId?: string;
  parameterDefinitionId?: string;
  value: string;
  confirmationToken?: string;
  approvalId?: string;
};

type RollbackSnapshotInput = {
  snapshotId: string;
  confirmationToken?: string;
  approvalId?: string;
};

type ServiceContext = AuditCorrelationContext;

function organizationIdFor(auth: AuthContext) {
  return auth.organization.id || auth.user.organizationId;
}

async function resolveDebugNodeModuleAssignment(
  db: Database,
  organizationId: string,
  input: { module?: string; moduleId?: string }
) {
  if (input.moduleId) {
    const module = await getDebugNodeModuleById(db, { organizationId, moduleId: input.moduleId });
    if (!module) {
      throw notFound("Debug module was not found.");
    }
    return { module: module.name, moduleId: module.id };
  }

  const moduleName = input.module?.trim();
  if (!moduleName) {
    throw new ApiError("VALIDATION_FAILED", "Either module or moduleId is required.");
  }

  const module = await getDebugNodeModuleByName(db, { organizationId, name: moduleName, parentId: null });
  return { module: moduleName, moduleId: module?.id ?? null };
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
    throw new ApiError("NOT_FOUND", "Debug session was not found.");
  }
  if (session.status !== "active") {
    throw new ApiError("VALIDATION_FAILED", "Debug session is not active.");
  }

  return session;
}

/**
 * Device read/write/rollback operate a live device through the session's connection and lease,
 * so they are restricted to the session's own actor — a same-organization user holding another
 * user's sessionId must not drive their device session.
 */
function requireOwnedActiveSession(session: DebugSessionRecord | null, auth: AuthContext): DebugSessionRecord {
  const active = ensureActiveSession(session);
  if (active.actorUserId !== auth.user.id) {
    throw new ApiError("FORBIDDEN", "Debug session belongs to another user.", { sessionId: active.id });
  }
  return active;
}

function resolveExecutionMode(session: DebugSessionRecord): DebugSessionExecutionMode {
  return session.executionMode ?? "server";
}

function runtimeNodeAsParameter(source: RuntimeNodeSource): DebugParameterRecord {
  const node = "node" in source ? source.node : source;
  const nodePath = "node" in source ? source.binding.nodePath : source.nodePath;
  const accessMode = "node" in source ? source.binding.accessMode : source.accessMode;
  return {
    id: node.id,
    organizationId: node.organizationId,
    name: node.name,
    key: node.id,
    description: node.description,
    module: node.module || "Device Nodes",
    nodePath,
    accessMode,
    unit: "",
    range: "",
    minValue: null,
    maxValue: null,
    risk: "Medium",
    currentValue: "",
    targetValue: "",
    sortOrder: 0,
    enabled: node.enabled,
    archivedAt: node.archivedAt,
    archivedBy: node.archivedBy,
    archiveReason: node.archiveReason,
    valueKind: node.valueKind,
    valueFormat: node.valueFormat,
    normalizationMode: node.normalizationMode,
    maxValueBytes: node.maxValueBytes
  };
}

function ensureNodeRuntimeAvailable(node: DebugNodeRecord) {
  if (!node.enabled || node.archivedAt) {
    throw new ApiError("VALIDATION_FAILED", "Debug node is disabled or archived.");
  }
}

function ensureParameterRuntimeAvailable(parameter: DebugParameterRecord) {
  if (!parameter.enabled || parameter.archivedAt !== null) {
    throw new ApiError("VALIDATION_FAILED", "Debug parameter is archived or disabled.");
  }
}

function ensureReadable(parameter: DebugParameterRecord | null, accessMode: DebugAccessMode) {
  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Debug parameter was not found.");
  }
  ensureParameterRuntimeAvailable(parameter);
  if (accessMode !== "RO" && accessMode !== "RW") {
    throw new ApiError("VALIDATION_FAILED", "Parameter is not readable.");
  }
}

function ensureWritable(
  parameter: DebugParameterRecord | null,
  input: WriteNodeInput,
  accessMode: DebugAccessMode
): DebugParameterRecord {
  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Debug parameter was not found.");
  }
  ensureParameterRuntimeAvailable(parameter);
  if (accessMode !== "WO" && accessMode !== "RW") {
    throw new ApiError("VALIDATION_FAILED", "Parameter is read-only.");
  }

  const metadata = resolveDebugValueMetadata(parameter);

  if (metadata.valueKind === DEBUG_VALUE_KIND_COMPLEX) {
    const validation = validateWritePayload(input.value, metadata);
    if (!validation.ok) {
      throw new ApiError("VALIDATION_FAILED", validation.error);
    }
  } else {
    const hasNumericRange = parameter.minValue !== null || parameter.maxValue !== null;
    const numericValue = Number(input.value);
    if (hasNumericRange && !Number.isFinite(numericValue)) {
      throw new ApiError("VALIDATION_FAILED", "Value must be numeric for ranged parameters.", {
        minValue: parameter.minValue,
        maxValue: parameter.maxValue
      });
    }
    if (hasNumericRange) {
      if ((parameter.minValue !== null && numericValue < parameter.minValue) || (parameter.maxValue !== null && numericValue > parameter.maxValue)) {
        throw new ApiError("VALIDATION_FAILED", "Value is outside the allowed range.", {
          minValue: parameter.minValue,
          maxValue: parameter.maxValue
        });
      }
    }
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

async function maybeNotifyDebugWriteFailed(
  db: Queryable,
  auth: AuthContext,
  session: { id: string },
  parameterName: string,
  operation: { id: string; status: string; failureReason?: string | null }
) {
  if (operation.status === "succeeded") {
    return;
  }

  await notifyDebugNodeWriteFailed(db, {
    organizationId: auth.organization.id,
    sessionId: session.id,
    operationId: operation.id,
    recipientUserId: auth.user.id,
    parameterName,
    failureReason: operation.failureReason ?? undefined
  });
}

async function requireDeviceLease(tx: Queryable, auth: AuthContext, session: DebugSessionRecord) {
  const lease = await acquireDebugDeviceLease(tx, {
    organizationId: organizationIdFor(auth),
    deviceId: session.deviceId,
    sessionId: session.id,
    actorUserId: auth.user.id,
    leaseTtlMs: DEVICE_LEASE_TTL_MS
  });
  if (!lease) {
    throw new ApiError("CONFLICT", "Debug device is leased by another active session.", {
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
    throw new ApiError("DEBUG_BINDING_NOT_CONFIGURED", "Debug parameter is not configured for the selected protocol.", {
      parameterId: input.parameterId,
      protocol: input.protocol
    });
  }
  if (!binding.enabled) {
    throw new ApiError("DEBUG_BINDING_DISABLED", "Debug parameter binding is disabled for the selected protocol.", {
      parameterId: input.parameterId,
      protocol: input.protocol
    });
  }
  return binding;
}

async function requireNodeBinding(
  tx: Queryable,
  organizationId: string,
  nodeId: string,
  protocol: DebugConnectionProtocol
): Promise<DebugNodeBindingRecord> {
  const binding = await getDebugNodeBinding(tx, { organizationId, nodeId, protocol, includeDisabled: true });
  if (!binding) {
    throw new ApiError("DEBUG_BINDING_NOT_CONFIGURED", "Debug node is not configured for the selected protocol.", {
      nodeId,
      protocol
    });
  }
  if (!binding.enabled) {
    throw new ApiError("DEBUG_BINDING_DISABLED", "Debug node binding is disabled for the selected protocol.", {
      nodeId,
      protocol
    });
  }
  return binding;
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
    enabled: parameter.enabled,
    archived: parameter.archivedAt !== null,
    ...extra
  };
}

function bindingAuditMetadata(binding: DebugParameterNodeBindingRecord, extra: Record<string, unknown> = {}) {
  return {
    parameterId: binding.parameterId,
    protocol: binding.protocol,
    enabled: binding.enabled,
    accessMode: binding.accessMode,
    hasNotes: Boolean(binding.notes?.trim()),
    ...extra
  };
}

function nodeAuditMetadata(node: DebugNodeRecord, extra: Record<string, unknown> = {}) {
  return {
    nodeId: node.id,
    enabled: node.enabled,
    archived: node.archivedAt !== null,
    ...extra
  };
}

function nodeBindingAuditMetadata(binding: DebugNodeBindingRecord, extra: Record<string, unknown> = {}) {
  return {
    nodeId: binding.nodeId,
    protocol: binding.protocol,
    enabled: binding.enabled,
    accessMode: binding.accessMode,
    hasNotes: Boolean(binding.notes?.trim()),
    ...extra
  };
}

function snapshotEntryFromWrite(
  identity: { parameterId: string | null; nodeId: string | null },
  protocol: DebugConnectionProtocol,
  nodePath: string,
  previousValue: string,
  targetValue: string,
  metadata: DebugValueMetadata
): DebugSnapshotEntry {
  const previousEnvelope = buildValueEnvelope(previousValue, metadata);
  const targetEnvelope = buildValueEnvelope(targetValue, metadata);
  return {
    // Identity is recorded as it really is (#420): parameterId only for a
    // genuine debugging_parameters row, nodeId for the debug_nodes id the
    // write path resolved. The pre-#420 writer smuggled node ids through
    // parameterId; rollback still owns disambiguating those persisted legacy
    // entries (resolveRollbackEntryIdentity).
    ...(identity.parameterId ? { parameterId: identity.parameterId } : {}),
    ...(identity.nodeId ? { nodeId: identity.nodeId } : {}),
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

/**
 * Resolves a snapshot entry's identity into FK-safe node_operations column
 * values. Runs before any rollback gateway I/O — the #416/PR #419 invariant
 * extended to rollback (#420): every FK the post-device-write operation
 * insert references is verified up front, so that insert can no longer fault
 * and roll back the operation, event, audit, and snapshot-claim evidence of a
 * completed physical write-back.
 *
 * Self-describing entries (written since #420) carry their identity under the
 * honest key; each id is still existence-checked because entries are jsonb
 * and the referenced row may have been removed since the write. Legacy
 * entries carry only parameterId, which may hold either a catalog parameter
 * id or a debug_nodes id, so they are disambiguated with a deterministic
 * existence probe: debugging_parameters first (same-id mirror rows resolve to
 * the catalog row, consistent with the historical same-id convention), then
 * debug_nodes, else both columns stay null — the row's node_path still
 * identifies the target, and rollback capability outranks linkage.
 */
async function resolveRollbackEntryIdentity(
  tx: Queryable,
  input: { organizationId: string; protocol: DebugConnectionProtocol; entry: DebugSnapshotEntry }
): Promise<{ parameterId: string | null; nodeId: string | null }> {
  const { organizationId, protocol, entry } = input;

  if (entry.nodeId) {
    const node = await getDebugNode(tx, { organizationId, nodeId: entry.nodeId, includeArchived: true });
    const parameter = entry.parameterId
      ? await getDebugParameter(tx, { organizationId, parameterId: entry.parameterId })
      : null;
    return { parameterId: parameter?.id ?? null, nodeId: node?.id ?? null };
  }

  if (!entry.parameterId) {
    return { parameterId: null, nodeId: null };
  }

  const parameter = await getDebugParameter(tx, { organizationId, parameterId: entry.parameterId });
  if (parameter) {
    return {
      parameterId: parameter.id,
      nodeId: await resolveDebugNodeIdByBinding(tx, { organizationId, protocol, nodePath: entry.nodePath })
    };
  }
  const node = await getDebugNode(tx, { organizationId, nodeId: entry.parameterId, includeArchived: true });
  return { parameterId: null, nodeId: node?.id ?? null };
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
  return new ApiError("NOT_FOUND", message);
}

function hasOwn<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
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
    async listDevices(auth: AuthContext) {
      requireDebugView(auth);
      return listDebugDevices(db, { organizationId: organizationIdFor(auth) });
    },

    async detectTargets(auth: AuthContext, input: DetectTargetsInput, context: ServiceContext = {}) {
      requireDebugRead(auth);
      const organizationId = organizationIdFor(auth);
      const protocol = input.protocol ?? defaultDebugConnectionProtocol;

      if (input.deviceId) {
        const device = await getDebugDevice(db, { organizationId, deviceId: input.deviceId });
        if (!device) {
          throw new ApiError("NOT_FOUND", "Debug device was not found.");
        }
      }

      const gateway = gatewayRegistry.requireGateway(protocol);
      const gatewayResult = await withGatewaySpan("detect", { hasDeviceFilter: Boolean(input.deviceId), protocol }, async (spanAttributes) => {
        try {
          const result = await gateway.detectTargets({ deviceId: input.deviceId });
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
        options.bridgeRpcClient && options.bridgeConnectionPool && input.bridgeId
          ? await detectTargetsAcrossBridges({
              rpc: options.bridgeRpcClient,
              bridges: (
                await listBridgesForUser(db, {
                  userId: auth.user.id,
                  organizationId
                })
              )
                .filter(
                  (bridge) =>
                    bridge.revokedAt === null &&
                    bridge.id === input.bridgeId &&
                    options.bridgeConnectionPool?.isConnected(bridge.id)
                )
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
            kind: "target-detect-failed",
            severity: "error",
            message: failureReason(gatewayResult.error, "Debug target detection failed."),
            metadata: { deviceId: input.deviceId, protocol, error: gatewayResult.error }
          });
        });
        throw new ApiError("DEVICE_UNAVAILABLE", failureReason(gatewayResult.error, "Debug target detection failed."));
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
          targets: persistedTargets
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
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
      const organizationId = organizationIdFor(auth);
      const parameters = await listDebugParameters(db, { organizationId, ...query });
      if (!query.protocol || parameters.length === 0) {
        return parameters;
      }

      const bindings = await listDebugParameterNodeBindings(db, {
        organizationId,
        parameterIds: parameters.map((parameter) => parameter.id),
        protocol: query.protocol
      });
      return attachParameterBindings(parameters, bindings, query.protocol).filter((parameter) => parameter.selectedBinding?.enabled === true);
    },

    async listRuntimeNodes(
      auth: AuthContext,
      query: { protocol?: DebugConnectionProtocol; moduleId?: string; includeDescendants?: boolean } = {}
    ) {
      requireDebugView(auth);
      const organizationId = organizationIdFor(auth);
      return listRuntimeDebugNodes(db, {
        organizationId,
        protocol: query.protocol,
        moduleId: query.moduleId,
        includeDescendants: query.includeDescendants
      });
    },

    async listAdminParameters(auth: AuthContext, query: AdminParameterListQuery = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const parameters = await listDebugParameters(db, {
        organizationId,
        ...query,
        includeArchived: query.includeArchived || query.coverage === "archived"
      });
      if (parameters.length === 0) {
        return [];
      }

      const bindings = await listDebugParameterNodeBindings(db, {
        organizationId,
        parameterIds: parameters.map((parameter) => parameter.id),
        protocol: query.protocol
      });
      return filterByAdminCoverage(attachParameterBindings(parameters, bindings, query.protocol), query.coverage);
    },

    async createAdminParameter(auth: AuthContext, input: AdminParameterWriteInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const { nodePath, accessMode } = legacyParameterBindingFields(input);

      return db.transaction(async (tx) => {
        const parameter = await createDebugParameter(tx, {
          organizationId,
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
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
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
        const { nodePath, accessMode } =
          input.bindings !== undefined ? legacyParameterBindingFields(input) : { nodePath: existing.nodePath, accessMode: existing.accessMode };
        const parameter = await updateDebugParameter(tx, {
          organizationId,
          parameterId: input.parameterId,
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

        for (const bindingInput of input.bindings ?? []) {
          const binding = await upsertDebugParameterNodeBinding(tx, {
            organizationId,
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
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
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
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
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
        const parameter = await restoreDebugParameter(tx, { organizationId, parameterId: input.parameterId });
        if (!parameter) {
          throw notFound();
        }
        const bindings = await listDebugParameterNodeBindings(tx, {
          organizationId,
          parameterIds: [parameter.id]
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
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
        const binding = await upsertDebugParameterNodeBinding(tx, {
          organizationId,
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
              projectId: null,
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
              projectId: null,
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

    async listAdminDebugNodes(
      auth: AuthContext,
      query: { includeArchived?: boolean; moduleId?: string; includeDescendants?: boolean } = {}
    ): Promise<DebugNodeWithBindingsRecord[]> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const nodes = await listDebugNodes(db, {
        organizationId,
        includeArchived: query.includeArchived,
        moduleId: query.moduleId,
        includeDescendants: query.includeDescendants
      });
      if (nodes.length === 0) {
        return [];
      }

      const nodesWithBindings = await Promise.all(
        nodes.map(async (node) => {
          const bindings = await listDebugNodeBindings(db, { organizationId, nodeId: node.id });
          return { ...node, bindings };
        })
      );
      return nodesWithBindings;
    },

    async createAdminDebugNode(auth: AuthContext, input: AdminNodeWriteInput, context: ServiceContext = {}): Promise<DebugNodeWithBindingsRecord> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const moduleAssignment = await resolveDebugNodeModuleAssignment(db, organizationId, input);

      return db.transaction(async (tx) => {
        const node = await createDebugNode(tx, {
          organizationId,
          name: input.name,
          description: input.description ?? "",
          detailedDescription: input.detailedDescription ?? "",
          writeFormatExample: input.writeFormatExample ?? "",
          writeFormatHint: input.writeFormatHint ?? "",
          module: moduleAssignment.module,
          moduleId: moduleAssignment.moduleId,
          valueKind: input.valueKind,
          valueFormat: input.valueFormat,
          normalizationMode: input.normalizationMode,
          maxValueBytes: input.maxValueBytes ?? null,
          enabled: input.enabled ?? true
        });
        for (const bindingInput of input.bindings ?? []) {
          const binding = await upsertDebugNodeBinding(tx, {
            organizationId,
            nodeId: node.id,
            protocol: bindingInput.protocol,
            nodePath: bindingInput.nodePath,
            accessMode: bindingInput.accessMode,
            enabled: bindingInput.enabled,
            notes: bindingInput.notes
          });
          if (!binding) {
            throw notFound("Debug node was not found.");
          }
        }
        const bindings = await listDebugNodeBindings(tx, { organizationId, nodeId: node.id });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
              kind: "debug-node-admin-create",
              action: "create",
              severity: "Medium",
              targetType: "debug-node-registry",
              targetId: node.id,
              metadata: nodeAuditMetadata(node, {
                bindingCount: bindings.length,
                protocols: bindings.map((binding) => binding.protocol)
              })
            },
            context
          )
        );

        return { ...node, bindings };
      });
    },

    async updateAdminDebugNode(auth: AuthContext, input: AdminNodePatchInput, context: ServiceContext = {}): Promise<DebugNodeWithBindingsRecord> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const moduleAssignment =
        input.module !== undefined || input.moduleId !== undefined
          ? await resolveDebugNodeModuleAssignment(db, organizationId, {
              module: input.module,
              moduleId: input.moduleId
            })
          : null;

      return db.transaction(async (tx) => {
        const current = await getDebugNode(tx, { organizationId, nodeId: input.nodeId, includeArchived: true });
        if (!current) {
          throw notFound("Debug node was not found.");
        }
        const node = await updateDebugNode(tx, {
          organizationId,
          nodeId: input.nodeId,
          name: input.name ?? current.name,
          description: input.description ?? current.description,
          detailedDescription: input.detailedDescription ?? current.detailedDescription,
          writeFormatExample: input.writeFormatExample ?? current.writeFormatExample,
          writeFormatHint: input.writeFormatHint ?? current.writeFormatHint,
          module: moduleAssignment?.module ?? current.module,
          moduleId: moduleAssignment?.moduleId ?? current.moduleId ?? null,
          valueKind: input.valueKind ?? current.valueKind,
          valueFormat: input.valueFormat ?? current.valueFormat,
          normalizationMode: input.normalizationMode ?? current.normalizationMode,
          maxValueBytes: resolvePatchedNullable(input, "maxValueBytes", current.maxValueBytes),
          enabled: input.enabled ?? current.enabled
        });
        if (!node) {
          throw notFound("Debug node was not found.");
        }
        const bindings = await listDebugNodeBindings(tx, { organizationId, nodeId: node.id });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
              kind: "debug-node-admin-update",
              action: "update",
              severity: "Medium",
              targetType: "debug-node-registry",
              targetId: node.id,
              metadata: nodeAuditMetadata(node, {
                bindingCount: bindings.length,
                protocols: bindings.map((binding) => binding.protocol)
              })
            },
            context
          )
        );

        return { ...node, bindings };
      });
    },

    async deleteAdminDebugNode(auth: AuthContext, nodeId: string, context: ServiceContext = {}): Promise<void> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      await db.transaction(async (tx) => {
        const current = await getDebugNode(tx, { organizationId, nodeId, includeArchived: true });
        if (!current) {
          throw notFound("Debug node was not found.");
        }

        const result = await deleteDebugNode(tx, { organizationId, nodeId });
        if (!result) {
          throw notFound("Debug node was not found.");
        }
        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
              kind: "debug-node-admin-delete",
              action: "delete",
              severity: "High",
              targetType: "debug-node-registry",
              targetId: current.id,
              metadata: nodeAuditMetadata(current, {
                name: current.name,
                moduleId: current.moduleId ?? null,
                bindingCount: result.bindingCount,
                operationCount: result.operationCount
              })
            },
            context
          )
        );
      });
    },

    async listAdminDebugModules(auth: AuthContext): Promise<DebugNodeModuleRecord[]> {
      requireDebugAdmin(auth);
      return listDebugNodeModules(db, { organizationId: organizationIdFor(auth) });
    },

    async createAdminDebugModule(auth: AuthContext, input: AdminDebugModuleWriteInput, context: ServiceContext = {}): Promise<DebugNodeModuleRecord> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const name = input.name.trim();
      if (!name) {
        throw new ApiError("VALIDATION_FAILED", "Module name is required.");
      }

      const parentId = input.parentId ?? null;
      if (parentId) {
        const parent = await getDebugNodeModuleById(db, { organizationId, moduleId: parentId });
        if (!parent) {
          throw notFound("Target parent debug module was not found.");
        }
      }

      const existing = await getDebugNodeModuleByName(db, { organizationId, name, parentId });
      if (existing) {
        throw new ApiError("CONFLICT", "Debug module already exists.", { name, parentId });
      }

      return db.transaction(async (tx) => {
        const module = await createDebugNodeModule(tx, {
          organizationId,
          name,
          parentId,
          description: input.description?.trim() ?? "",
          scope: input.scope?.trim() ?? "",
          sortOrder: input.sortOrder
        });

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
              kind: "debug-node-module-admin-create",
              action: "create",
              severity: "Low",
              targetType: "debug-node-module",
              targetId: module.id,
              metadata: { name: module.name, parentId: module.parentId, scope: module.scope }
            },
            context
          )
        );

        return module;
      });
    },

    async updateAdminDebugModule(auth: AuthContext, input: AdminDebugModulePatchInput, context: ServiceContext = {}): Promise<DebugNodeModuleRecord> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const current = await getDebugNodeModuleById(db, { organizationId, moduleId: input.moduleId });
      if (!current) {
        throw notFound("Debug module was not found.");
      }

      const nextName = (input.name ?? current.name).trim();
      if (!nextName) {
        throw new ApiError("VALIDATION_FAILED", "Module name is required.");
      }
      if (nextName !== current.name) {
        const conflict = await getDebugNodeModuleByName(db, {
          organizationId,
          name: nextName,
          parentId: current.parentId
        });
        if (conflict && conflict.id !== current.id) {
          throw new ApiError("CONFLICT", "Debug module already exists.", { name: nextName });
        }
      }

      return db.transaction(async (tx) => {
        if (nextName !== current.name) {
          await renameDebugNodeModuleReferences(tx, {
            organizationId,
            fromModule: current.name,
            toModule: nextName
          });
        }

        const module = await updateDebugNodeModule(tx, {
          organizationId,
          moduleId: current.id,
          name: nextName,
          description: input.description?.trim() ?? current.description,
          scope: input.scope?.trim() ?? current.scope,
          sortOrder: input.sortOrder
        });
        if (!module) {
          throw notFound("Debug module was not found.");
        }

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
              kind: "debug-node-module-admin-update",
              action: "update",
              severity: "Low",
              targetType: "debug-node-module",
              targetId: module.id,
              metadata: {
                previousName: current.name,
                name: module.name,
                scope: module.scope
              }
            },
            context
          )
        );

        return module;
      });
    },

    async moveAdminDebugModule(auth: AuthContext, input: AdminDebugModuleMoveInput, context: ServiceContext = {}): Promise<DebugNodeModuleRecord> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const current = await getDebugNodeModuleById(db, { organizationId, moduleId: input.moduleId });
      if (!current) {
        throw notFound("Debug module was not found.");
      }

      const parentId = input.parentId;
      if (parentId) {
        const parent = await getDebugNodeModuleById(db, { organizationId, moduleId: parentId });
        if (!parent) {
          throw notFound("Target parent debug module was not found.");
        }
      }

      if (parentId === current.parentId) {
        return current;
      }

      const conflict = await getDebugNodeModuleByName(db, {
        organizationId,
        name: current.name,
        parentId
      });
      if (conflict && conflict.id !== current.id) {
        throw new ApiError("CONFLICT", "Debug module already exists under the target parent.", {
          name: current.name,
          parentId
        });
      }

      try {
        return await db.transaction(async (tx) => {
          const module = await moveDebugNodeModule(tx, {
            organizationId,
            moduleId: input.moduleId,
            parentId
          });
          if (!module) {
            throw notFound("Debug module was not found.");
          }

          await writeAudit(
            tx,
            auditInput(
              auth,
              {
                projectId: null,
                kind: "debug-node-module-admin-move",
                action: "move",
                severity: "Low",
                targetType: "debug-node-module",
                targetId: module.id,
                metadata: { previousParentId: current.parentId, parentId: module.parentId }
              },
              context
            )
          );

          return module;
        });
      } catch (error) {
        if (error instanceof Error && /cycle/i.test(error.message)) {
          throw new ApiError("CONFLICT", error.message, { moduleId: input.moduleId, parentId });
        }
        throw error;
      }
    },

    async deleteAdminDebugModule(auth: AuthContext, moduleId: string, context: ServiceContext = {}): Promise<void> {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);
      const current = await getDebugNodeModuleById(db, { organizationId, moduleId });
      if (!current) {
        throw notFound("Debug module was not found.");
      }

      const nodeCount = await countDebugNodesForModuleId(db, { organizationId, moduleId });
      if (nodeCount > 0) {
        throw new ApiError("CONFLICT", "Cannot delete a debug module that still has nodes.", {
          moduleId,
          nodeCount
        });
      }

      try {
        await db.transaction(async (tx) => {
          const deleted = await deleteDebugNodeModuleById(tx, { organizationId, moduleId });
          if (!deleted) {
            throw notFound("Debug module was not found.");
          }

          await writeAudit(
            tx,
            auditInput(
              auth,
              {
                projectId: null,
                kind: "debug-node-module-admin-delete",
                action: "delete",
                severity: "Low",
                targetType: "debug-node-module",
                targetId: moduleId,
                metadata: { name: current.name }
              },
              context
            )
          );
        });
      } catch (error) {
        if (error instanceof Error && /child modules|referenced by debug nodes/i.test(error.message)) {
          throw new ApiError("CONFLICT", error.message, { moduleId });
        }
        throw error;
      }
    },

    async upsertAdminDebugNodeBinding(auth: AuthContext, input: AdminNodeBindingWriteInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const node = await getDebugNode(tx, { organizationId, nodeId: input.nodeId, includeArchived: true });
        if (!node) {
          throw notFound("Debug node was not found.");
        }
        const binding = await upsertDebugNodeBinding(tx, {
          organizationId,
          nodeId: input.nodeId,
          protocol: input.protocol,
          nodePath: input.nodePath,
          accessMode: input.accessMode,
          enabled: input.enabled,
          notes: input.notes
        });
        if (!binding) {
          throw notFound("Debug node was not found.");
        }

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
              kind: "debug-node-binding-admin-upsert",
              action: "update",
              severity: "Medium",
              targetType: "debug-node-binding",
              targetId: `${binding.nodeId}:${binding.protocol}`,
              metadata: nodeBindingAuditMetadata(binding)
            },
            context
          )
        );

        return binding;
      });
    },

    async archiveAdminDebugNodeBinding(auth: AuthContext, input: AdminNodeBindingArchiveInput, context: ServiceContext = {}) {
      requireDebugAdmin(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const node = await getDebugNode(tx, { organizationId, nodeId: input.nodeId, includeArchived: true });
        if (!node) {
          throw notFound("Debug node was not found.");
        }
        const binding = await archiveDebugNodeBinding(tx, {
          organizationId,
          nodeId: input.nodeId,
          protocol: input.protocol
        });
        if (!binding) {
          throw notFound("Debug node binding was not found.");
        }

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
              kind: "debug-node-binding-admin-archive",
              action: "archive",
              severity: "Medium",
              targetType: "debug-node-binding",
              targetId: `${binding.nodeId}:${binding.protocol}`,
              metadata: nodeBindingAuditMetadata(binding)
            },
            context
          )
        );

        return binding;
      });
    },

    async createSession(auth: AuthContext, input: CreateSessionInput, context: ServiceContext = {}) {
      requireDebugRead(auth);
      const organizationId = organizationIdFor(auth);
      const protocol = input.protocol ?? defaultDebugConnectionProtocol;

      return db.transaction(async (tx) => {
        const bridgeExecutionRequested = isBridgeBackedTargetId(input.targetId);
        const device = bridgeExecutionRequested ? null : await getDebugDevice(tx, { organizationId, deviceId: input.deviceId });
        if (!bridgeExecutionRequested && !device) {
          throw new ApiError("NOT_FOUND", "Debug device was not found.");
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: input.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.");
        }
        if (target.deviceId !== input.deviceId) {
          throw new ApiError("VALIDATION_FAILED", "Debug target does not belong to the requested device.");
        }
        if (device && device.status !== "online") {
          throw new ApiError("DEVICE_UNAVAILABLE", "Debug device is offline.");
        }
        if (target.status !== "detected") {
          throw new ApiError("DEVICE_UNAVAILABLE", "Debug target is not detected.");
        }
        if (target.protocol !== protocol) {
          throw new ApiError("VALIDATION_FAILED", "Debug target protocol does not match the requested protocol.", {
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
            throw new ApiError("VALIDATION_FAILED", "bridgeId is required for bridge-backed targets.");
          }
          if (target.bridgeId && target.bridgeId !== input.bridgeId) {
            throw new ApiError("VALIDATION_FAILED", "Provided bridgeId does not match the selected debug target.", {
              bridgeId: input.bridgeId,
              targetBridgeId: target.bridgeId
            });
          }
          if (!options.bridgeConnectionPool?.isConnected(input.bridgeId)) {
            throw new ApiError("DEVICE_UNAVAILABLE", "Selected device bridge is offline.", { bridgeId: input.bridgeId });
          }

          const userBridges = await listBridgesForUser(tx, { userId: auth.user.id, organizationId });
          const bridge = userBridges.find((item) => item.id === input.bridgeId && item.revokedAt === null);
          if (!bridge) {
            throw new ApiError("NOT_FOUND", "Device bridge was not found.", { bridgeId: input.bridgeId });
          }

          bridgeId = input.bridgeId;
          bridgeMachineLabel = bridge.machineLabel;
          executionMode = "bridge";
        } else {
          gatewayRegistry.requireGateway(protocol);
        }

        const session = await createDebugSession(tx, {
          organizationId,
          deviceId: input.deviceId,
          targetId: input.targetId,
          protocol,
          executionMode,
          bridgeId,
          bridgeMachineLabel,
          sessionKind: input.sessionKind,
          actorUserId: auth.user.id
        });
        await insertDebugEvent(tx, {
          organizationId,
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
              projectId: null,
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
      return getDebugSessionRecord(db, { organizationId: organizationIdFor(auth), sessionId: input.sessionId });
    },

    async listSessionEvents(auth: AuthContext, input: { sessionId: string }) {
      requireDebugView(auth);
      const organizationId = organizationIdFor(auth);
      const session = await getDebugSessionRecord(db, { organizationId, sessionId: input.sessionId });
      if (!session) {
        throw new ApiError("NOT_FOUND", "Debug session was not found.");
      }
      return listDebugSessionEvents(db, { organizationId, sessionId: input.sessionId });
    },

    async readNode(auth: AuthContext, input: ReadNodeInput, context: ServiceContext = {}) {
      requireDebugRead(auth);
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const session = requireOwnedActiveSession(await getDebugSessionRecord(tx, { organizationId, sessionId: input.sessionId }), auth);
        const protocol = session.protocol ?? defaultDebugConnectionProtocol;
        let catalogParameter: DebugParameterRecord | null = null;
        let catalogNodeId: string | null = null;
        let nodePath = input.nodePath;
        let accessMode: DebugAccessMode = "RW";

        if (input.nodeId) {
          const node = await getDebugNode(tx, { organizationId, nodeId: input.nodeId });
          if (!node) {
            throw new ApiError("NOT_FOUND", "Debug node was not found.");
          }
          ensureNodeRuntimeAvailable(node);
          const binding = await requireNodeBinding(tx, organizationId, node.id, protocol);
          catalogParameter = runtimeNodeAsParameter({ node, binding });
          catalogNodeId = node.id;
          nodePath = binding.nodePath;
          accessMode = binding.accessMode;
          ensureReadable(catalogParameter, accessMode);
        } else if (input.parameterId) {
          catalogParameter = await getDebugParameter(tx, { organizationId, parameterId: input.parameterId });
          const binding = await requireProtocolBinding(tx, { organizationId, parameterId: input.parameterId, protocol });
          ensureReadable(catalogParameter, binding.accessMode);
          nodePath = binding.nodePath;
          accessMode = binding.accessMode;
          // The catalog linkage travels in parameter_id; node_id may only carry
          // a real debug_nodes id (FK), resolved through debug_node_bindings
          // when one covers the same protocol + path (#416).
          catalogNodeId = await resolveDebugNodeIdByBinding(tx, { organizationId, protocol, nodePath: binding.nodePath });
        }

        if (!nodePath) {
          throw new ApiError("VALIDATION_FAILED", "nodeId, parameterId, or nodePath is required.");
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.");
        }
        const executionMode = resolveExecutionMode(session);
        const bridgeId = session.bridgeId;
        if (executionMode === "bridge" && !bridgeId) {
          throw new ApiError("VALIDATION_FAILED", "Bridge-backed session is missing bridge id.");
        }
        if (executionMode === "bridge" && !options.bridgeRpcClient) {
          throw new ApiError("INTERNAL_ERROR", "Bridge RPC client is required for bridge-backed sessions.");
        }
        const gateway = executionMode === "server" ? gatewayRegistry.requireGateway(protocol) : null;

        const readMetadata = catalogParameter ? resolveDebugValueMetadata(catalogParameter) : null;
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
          sessionId: session.id,
          parameterId: input.parameterId ?? null,
          nodeId: catalogNodeId,
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
              projectId: null,
              kind: "debug-node-read",
              action: "read",
              severity: result.ok ? "Low" : "Medium",
              targetType: "debug-node",
              targetId: input.nodeId ?? input.parameterId ?? nodePath,
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
      const isReload = Boolean(input.parameterDefinitionId?.trim());

      return db.transaction(async (tx) => {
        const session = requireOwnedActiveSession(await getDebugSessionRecord(tx, { organizationId, sessionId: input.sessionId }), auth);
        const protocol = session.protocol ?? defaultDebugConnectionProtocol;
        let parameter: DebugParameterRecord;
        let parameterId: string | null = null;
        let parameterDefinitionId: string | null = null;
        let catalogNodeId: string | null = null;
        let nodePath: string;
        let accessMode: DebugAccessMode;
        const operationType: DebugOperationType = "write";

        if (isReload) {
          throw new ApiError("GONE", "Parameter reload is no longer available.");
        } else if (input.nodeId?.trim()) {
          const node = await getDebugNode(tx, { organizationId, nodeId: input.nodeId.trim() });
          if (!node) {
            throw new ApiError("NOT_FOUND", "Debug node was not found.");
          }
          ensureNodeRuntimeAvailable(node);
          const binding = await requireNodeBinding(tx, organizationId, node.id, protocol);
          parameter = ensureWritable(runtimeNodeAsParameter({ node, binding }), input, binding.accessMode);
          catalogNodeId = node.id;
          parameterId = null;
          nodePath = binding.nodePath;
          accessMode = binding.accessMode;
        } else if (input.parameterId?.trim()) {
          parameterId = input.parameterId.trim();
          const parameterRecord = await getDebugParameter(tx, { organizationId, parameterId });
          const binding = await requireProtocolBinding(tx, { organizationId, parameterId, protocol });
          parameter = ensureWritable(parameterRecord, input, binding.accessMode);
          nodePath = binding.nodePath;
          accessMode = binding.accessMode;
          // Resolved before any gateway I/O on purpose: every FK value the
          // post-device-write operation insert references (parameter_id,
          // node_id) is verified here, so that insert can no longer fault and
          // roll back the snapshot + audit evidence of a completed physical
          // write (#416; ADR-0021 snapshot, ADR-0027 audit atomicity).
          catalogNodeId = await resolveDebugNodeIdByBinding(tx, { organizationId, protocol, nodePath: binding.nodePath });
        } else {
          throw new ApiError("VALIDATION_FAILED", "nodeId or parameterId is required.");
        }

        await assertDeviceWriteAuthorization(tx, auth, {
          risk: parameter.risk,
          sessionId: session.id,
          parameterId: input.parameterId,
          nodeId: input.nodeId,
          value: input.value,
          confirmationToken: input.confirmationToken,
          approvalId: input.approvalId
        });

        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.");
        }
        const executionMode = resolveExecutionMode(session);
        const bridgeId = session.bridgeId;
        if (executionMode === "bridge" && !bridgeId) {
          throw new ApiError("VALIDATION_FAILED", "Bridge-backed session is missing bridge id.");
        }
        if (executionMode === "bridge" && !options.bridgeRpcClient) {
          throw new ApiError("INTERNAL_ERROR", "Bridge RPC client is required for bridge-backed sessions.");
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
            sessionId: session.id,
            parameterId,
            nodeId: catalogNodeId,
            parameterDefinitionId,
            protocol,
            nodePath,
            operationType,
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
                projectId: null,
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
          await maybeNotifyDebugWriteFailed(tx, auth, session, parameter.name, operation);
          return operation;
        }

        const previousValue = previous.value ?? previous.stdout ?? "";
        const snapshot = await createDebugSnapshot(tx, {
          organizationId,
          sessionId: session.id,
          risk: parameter.risk,
          entries: [
            snapshotEntryFromWrite({ parameterId, nodeId: catalogNodeId }, protocol, nodePath, previousValue, input.value, metadata)
          ],
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
          sessionId: session.id,
          parameterId,
          nodeId: catalogNodeId,
          parameterDefinitionId,
          protocol,
          nodePath,
          operationType,
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

        if (result.ok && result.verified && parameterId) {
          await updateDebugParameterValues(tx, {
            organizationId,
            parameterId,
            currentValue: input.value,
            targetValue: input.value
          });
        }

        await writeAudit(
          tx,
          auditInput(
            auth,
            {
              projectId: null,
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

        await maybeNotifyDebugWriteFailed(tx, auth, session, parameter.name, operation);
        return operation;
      });
    },

    async rollbackSnapshot(
      auth: AuthContext,
      input: RollbackSnapshotInput,
      context: ServiceContext = {}
    ): Promise<{ operations: NodeOperationRecord[]; snapshot: Awaited<ReturnType<typeof markSnapshotConsumed>> }> {
      requireDebugRollback(auth);
      if (!input.approvalId?.trim() && input.confirmationToken !== "confirm-rollback") {
        throw new ApiError("VALIDATION_FAILED", "Rollback confirmation is required.");
      }
      const organizationId = organizationIdFor(auth);

      return db.transaction(async (tx) => {
        const snapshot = await getDebugSnapshot(tx, { organizationId, snapshotId: input.snapshotId });
        if (!snapshot) {
          throw new ApiError("NOT_FOUND", "Snapshot was not found.");
        }
        const session = requireOwnedActiveSession(await getDebugSessionRecord(tx, { organizationId, sessionId: snapshot.sessionId }), auth);
        if (snapshot.status !== "valid" || snapshot.sessionId !== session.id) {
          throw new ApiError("VALIDATION_FAILED", "Snapshot is not valid for this session.");
        }
        await assertDeviceRollbackAuthorization(tx, auth, {
          snapshotId: snapshot.id,
          confirmationToken: input.confirmationToken,
          approvalId: input.approvalId
        });
        const claimedSnapshot = await claimSnapshotForRollback(tx, { organizationId, snapshotId: snapshot.id });
        if (!claimedSnapshot) {
          throw new ApiError("CONFLICT", "Snapshot is already being rolled back or has been consumed.");
        }
        const target = await getDebugTarget(tx, { organizationId, targetId: session.targetId });
        if (!target) {
          throw new ApiError("NOT_FOUND", "Debug target was not found.");
        }
        const protocol = session.protocol ?? defaultDebugConnectionProtocol;
        const executionMode = resolveExecutionMode(session);
        const bridgeId = session.bridgeId;
        if (executionMode === "bridge" && !bridgeId) {
          throw new ApiError("VALIDATION_FAILED", "Bridge-backed session is missing bridge id.");
        }
        if (executionMode === "bridge" && !options.bridgeRpcClient) {
          throw new ApiError("INTERNAL_ERROR", "Bridge RPC client is required for bridge-backed sessions.");
        }
        const gateway = executionMode === "server" ? gatewayRegistry.requireGateway(protocol) : null;
        await requireDeviceLease(tx, auth, session);

        // Entry identity is resolved into FK-safe column values for every
        // entry before any gateway I/O (#420, extending the #419 invariant):
        // once a physical write-back has happened, nothing knowable up front
        // may fault the inserts that record it. The protocol gate moves up
        // with it so a mismatched entry in a multi-entry snapshot cannot
        // throw after an earlier entry's device write either.
        const preparedEntries: Array<{
          entry: DebugSnapshotEntry;
          identity: { parameterId: string | null; nodeId: string | null };
        }> = [];
        for (const entry of snapshot.entries) {
          const entryProtocol = entry.protocol ?? protocol;
          if (entryProtocol !== protocol) {
            throw new ApiError("VALIDATION_FAILED", "Snapshot protocol does not match the rollback session.");
          }
          preparedEntries.push({
            entry,
            identity: await resolveRollbackEntryIdentity(tx, { organizationId, protocol: entryProtocol, entry })
          });
        }

        const operations: NodeOperationRecord[] = [];
        for (const { entry, identity } of preparedEntries) {
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
              sessionId: session.id,
              // Pre-resolved, FK-safe identity: parameter_id only for genuine
              // catalog parameters, node_id for node entries (#420).
              parameterId: identity.parameterId,
              nodeId: identity.nodeId,
              protocol,
              nodePath: entry.nodePath,
              operationType: "rollback",
              status,
              requestedValue: entry.previousValue,
              readbackValue: readbackValue ?? undefined,
              verified: result.ok && result.verified,
              failureReason: status === "succeeded" ? undefined : failureReason(result.error ?? result.writeResult.error ?? result.readResult?.error, "Rollback write failed."),
              durationMs: Math.max(result.writeResult.durationMs, result.readResult?.durationMs ?? 0),
              approvalId: input.approvalId,
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
              projectId: null,
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

        await notifyDebugSnapshotRollback(tx, {
          organizationId,
          sessionId: session.id,
          snapshotId: claimedSnapshot.id,
          recipientUserId: auth.user.id,
          succeeded: !failed,
          operationCount: operations.length
        });

        return { operations, snapshot: finalSnapshot ?? claimedSnapshot };
      });
    }
  };
}

import { z } from "zod";

import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";

export const debugConnectionProtocolSchema = z.enum(["hdc", "adb"]);
export const debugDeviceTransportSchema = z.enum(["simulator", "hdc", "adb", "multi"]);
export const debugDeviceStatusSchema = z.enum(["online", "offline", "unknown"]);
export const debugTargetStatusSchema = z.enum(["detected", "lost"]);
export const debugAccessModeSchema = z.enum(["RO", "WO", "RW"]);
export const debugRiskLevelSchema = z.enum(["Low", "Medium", "High"]);
export const debugSessionStatusSchema = z.enum(["active", "closed"]);
export const debugOperationTypeSchema = z.enum(["detect", "read", "write", "reload", "rollback"]);
export const debugOperationStatusSchema = z.enum(["pending", "succeeded", "failed", "unknown", "readback_mismatch"]);
export const debugSnapshotStatusSchema = z.enum(["valid", "rollback_pending", "consumed", "invalid"]);
export const debugValueKindSchema = z.enum(["scalar", "complex"]);
export const debugValueFormatSchema = z.enum(["raw", "json", "dts", "line-list", "kv-list"]);
export const debugNormalizationModeSchema = z.enum([
  "exact",
  "trim",
  "line-ending-normalized",
  "json-canonical"
]);

export const debugDeviceDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: debugDeviceTransportSchema.optional(),
  firmware: z.string(),
  status: debugDeviceStatusSchema,
  lastSeenAt: z.string().nullable(),
  organizationId: z.string().optional()
});

export const debugTargetDtoSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  bridgeId: z.string().nullable().optional(),
  bridge_id: z.string().nullable().optional(),
  bridgeMachineLabel: z.string().nullable().optional(),
  bridge_machine_label: z.string().nullable().optional(),
  protocol: debugConnectionProtocolSchema.optional(),
  label: z.string(),
  targetRef: z.string(),
  status: debugTargetStatusSchema,
  organizationId: z.string().optional()
});

export const debugParameterNodeBindingDtoSchema = z.object({
  protocol: debugConnectionProtocolSchema,
  nodePath: z.string(),
  accessMode: debugAccessModeSchema,
  enabled: z.boolean(),
  isSmokeDefault: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  disabledReason: z.string().nullable().optional(),
  id: z.string().optional(),
  organizationId: z.string().optional(),
  parameterId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const debugParameterDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
  module: z.string(),
  nodePath: z.string().optional(),
  accessMode: debugAccessModeSchema.optional(),
  unit: z.string(),
  range: z.string(),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  risk: debugRiskLevelSchema,
  currentValue: z.string(),
  targetValue: z.string(),
  sortOrder: z.number().optional(),
  enabled: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
  archivedBy: z.string().nullable().optional(),
  archiveReason: z.string().nullable().optional(),
  selectedBinding: debugParameterNodeBindingDtoSchema.nullable().optional(),
  bindings: z.array(debugParameterNodeBindingDtoSchema).optional(),
  valueKind: debugValueKindSchema.optional(),
  valueFormat: debugValueFormatSchema.optional(),
  normalizationMode: debugNormalizationModeSchema.optional(),
  maxValueBytes: z.number().nullable().optional(),
  organizationId: z.string().optional()
});

export const debugRuntimeNodeDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  writeFormatExample: z.string().optional(),
  writeFormatHint: z.string().optional(),
  module: z.string(),
  protocol: debugConnectionProtocolSchema,
  nodePath: z.string(),
  accessMode: debugAccessModeSchema,
  enabled: z.boolean(),
  valueKind: debugValueKindSchema.optional(),
  valueFormat: debugValueFormatSchema.optional(),
  normalizationMode: debugNormalizationModeSchema.optional(),
  maxValueBytes: z.number().nullable().optional(),
  organizationId: z.string().optional(),
  detailedDescription: z.string().optional(),
  moduleId: z.string().optional(),
  modulePath: z.array(z.string()).optional(),
  archivedAt: z.string().nullable().optional(),
  archivedBy: z.string().nullable().optional(),
  archiveReason: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const debugSessionDtoSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  targetId: z.string(),
  protocol: debugConnectionProtocolSchema.optional(),
  status: debugSessionStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  organizationId: z.string().optional(),
  executionMode: z.enum(["server", "bridge"]).optional(),
  bridgeId: z.string().nullable().optional(),
  bridgeMachineLabel: z.string().nullable().optional(),
  sessionKind: z.enum(["node", "parameter_reload"]).optional(),
  actorUserId: z.string().optional()
});

export const nodeOperationDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  parameterId: z.string().nullable(),
  nodeId: z.string().optional(),
  protocol: debugConnectionProtocolSchema.optional(),
  nodePath: z.string(),
  operationType: debugOperationTypeSchema,
  status: debugOperationStatusSchema,
  requestedValue: z.string().nullable(),
  previousValue: z.string().nullable(),
  readValue: z.string().nullable(),
  readbackValue: z.string().nullable(),
  verified: z.boolean().nullable(),
  writeOutcome: z.enum(["executed", "failed", "unknown"]).nullable().optional(),
  readbackOutcome: z.enum(["observed", "failed", "unsupported", "not_requested", "unknown"]).nullable().optional(),
  relatedOperationId: z.string().nullable().optional(),
  failureReason: z.string().nullable(),
  durationMs: z.number(),
  snapshotId: z.string().nullable(),
  createdAt: z.string(),
  valueKind: debugValueKindSchema.nullable().optional(),
  valueFormat: debugValueFormatSchema.nullable().optional(),
  normalizationMode: debugNormalizationModeSchema.nullable().optional(),
  requestedValueDigest: z.string().nullable().optional(),
  previousValueDigest: z.string().nullable().optional(),
  readbackValueDigest: z.string().nullable().optional(),
  valuePreview: z.string().nullable().optional()
});

export const debugSnapshotDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: debugSnapshotStatusSchema,
  risk: debugRiskLevelSchema,
  createdAt: z.string()
});

export const debugDeviceListResponseSchema = itemsEnvelopeSchema(debugDeviceDtoSchema);
export const debugTargetListResponseSchema = itemsEnvelopeSchema(debugTargetDtoSchema);
export const debugParameterListResponseSchema = itemsEnvelopeSchema(debugParameterDtoSchema);
export const debugNodeListResponseSchema = itemsEnvelopeSchema(debugRuntimeNodeDtoSchema);
export const debugSessionResponseSchema = itemEnvelopeSchema(debugSessionDtoSchema.nullable());
export const debugSessionEventListResponseSchema = itemsEnvelopeSchema(nodeOperationDtoSchema);
export const debugNodeOperationResponseSchema = z.object({
  operation: nodeOperationDtoSchema,
  snapshot: debugSnapshotDtoSchema.optional()
});
export const debugRollbackResponseSchema = z.object({
  snapshot: debugSnapshotDtoSchema,
  operations: z.array(nodeOperationDtoSchema)
});

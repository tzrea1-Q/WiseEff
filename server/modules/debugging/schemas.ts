import { z } from "zod";
import { debugConnectionProtocols, defaultDebugConnectionProtocol } from "./protocol";
import { debugAccessModes, debugRiskLevels } from "./status";
import {
  DEBUG_NORMALIZATION_MODES,
  DEBUG_VALUE_FORMATS,
  DEBUG_VALUE_KINDS,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_SCALAR,
  DEBUG_NORMALIZATION_MODE_TRIM
} from "./types";

const nonEmptyString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().optional();
const nullableProjectIdSchema = z.union([nonEmptyString, z.null()]).optional();
const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((value) => value === true || value === "true");
const protocolSchema = z.enum(debugConnectionProtocols).default(defaultDebugConnectionProtocol);
const nodePathSchema = z
  .string()
  .trim()
  .min(1)
  .startsWith("/")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), { message: "Node path must not contain control characters." });

export const debugValueKindSchema = z.enum(DEBUG_VALUE_KINDS);
export const debugValueFormatSchema = z.enum(DEBUG_VALUE_FORMATS);
export const debugNormalizationModeSchema = z.enum(DEBUG_NORMALIZATION_MODES);

const debugValueMetadataFields = {
  valueKind: debugValueKindSchema.default(DEBUG_VALUE_KIND_SCALAR),
  valueFormat: debugValueFormatSchema.default(DEBUG_VALUE_FORMAT_RAW),
  normalizationMode: debugNormalizationModeSchema.default(DEBUG_NORMALIZATION_MODE_TRIM),
  maxValueBytes: z.number().int().positive().nullable().optional()
};

function applyScalarValueDefaults<T extends { valueKind?: (typeof DEBUG_VALUE_KINDS)[number] }>(value: T) {
  if (value.valueKind === DEBUG_VALUE_KIND_SCALAR || value.valueKind === undefined) {
    return {
      ...value,
      valueKind: DEBUG_VALUE_KIND_SCALAR,
      valueFormat: DEBUG_VALUE_FORMAT_RAW,
      normalizationMode: DEBUG_NORMALIZATION_MODE_TRIM
    };
  }
  return value;
}

function applyExplicitScalarPatchDefaults<T extends { valueKind?: (typeof DEBUG_VALUE_KINDS)[number] }>(value: T) {
  if (value.valueKind === DEBUG_VALUE_KIND_SCALAR) {
    return {
      ...value,
      valueFormat: DEBUG_VALUE_FORMAT_RAW,
      normalizationMode: DEBUG_NORMALIZATION_MODE_TRIM
    };
  }
  return value;
}

function requireJsonFormatForCanonicalNormalization(value: {
  valueFormat?: (typeof DEBUG_VALUE_FORMATS)[number];
  normalizationMode?: (typeof DEBUG_NORMALIZATION_MODES)[number];
}) {
  return value.normalizationMode !== "json-canonical" || value.valueFormat === "json";
}

export const debugParameterNodeBindingSchema = z.object({
  protocol: z.enum(debugConnectionProtocols),
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: z.string().trim().optional()
});

const debugParameterAdminBaseSchema = z.object({
  projectId: nullableProjectIdSchema,
  name: nonEmptyString,
  key: nonEmptyString,
  description: z.string().trim().default(""),
  module: nonEmptyString,
  risk: z.enum(debugRiskLevels),
  unit: z.string().trim().default(""),
  range: z.string().trim().default(""),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  currentValue: z.string().trim().default(""),
  targetValue: z.string().trim().default(""),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  bindings: z.array(debugParameterNodeBindingSchema).default([]),
  ...debugValueMetadataFields
});

export const listDebuggingParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional(),
  protocol: protocolSchema.optional()
});

export const debugAdminCoverageFilters = [
  "dual-protocol",
  "hdc-configured",
  "adb-configured",
  "missing-hdc",
  "missing-adb",
  "archived"
] as const;

export const listDebuggingAdminParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional(),
  protocol: z.enum(debugConnectionProtocols).optional(),
  coverage: z.enum(debugAdminCoverageFilters).optional(),
  includeArchived: booleanQuerySchema
});

export const debugAdminParameterParamsSchema = z.object({
  parameterId: nonEmptyString
});

export const debugAdminBindingParamsSchema = z.object({
  parameterId: nonEmptyString,
  protocol: z.enum(debugConnectionProtocols)
});

export const upsertDebugParameterNodeBindingBodySchema = z.object({
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: optionalTrimmedString
});

export const writeDebugParameterAdminBodySchema = debugParameterAdminBaseSchema
  .refine(requireJsonFormatForCanonicalNormalization, {
    message: "json-canonical normalization requires json value format.",
    path: ["normalizationMode"]
  })
  .transform(applyScalarValueDefaults);

export const patchDebugParameterAdminBodySchema = debugParameterAdminBaseSchema
  .partial()
  .extend({
    bindings: z.array(debugParameterNodeBindingSchema).optional()
  })
  .refine(requireJsonFormatForCanonicalNormalization, {
    message: "json-canonical normalization requires json value format.",
    path: ["normalizationMode"]
  })
  .transform((value) => applyExplicitScalarPatchDefaults(value));

export const archiveDebugParameterBodySchema = z.object({
  reason: z.string().trim().max(500).optional()
});

export const detectTargetsBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString.optional(),
  bridgeId: nonEmptyString.optional(),
  protocol: protocolSchema
});

export const createDebugSessionBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString,
  targetId: nonEmptyString,
  bridgeId: nonEmptyString.optional(),
  protocol: protocolSchema,
  sessionKind: z.enum(["node", "parameter_reload"]).default("node")
}).refine((value) => !value.targetId.startsWith("bridge:") || Boolean(value.bridgeId), {
  message: "bridgeId is required when targetId references a device bridge target.",
  path: ["bridgeId"]
});

export const readNodeBodySchema = z
  .object({
    sessionId: nonEmptyString,
    parameterId: nonEmptyString.optional(),
    nodeId: nonEmptyString.optional(),
    nodePath: nodePathSchema.optional()
  })
  .refine((value) => Boolean(value.parameterId ?? value.nodeId ?? value.nodePath), {
    message: "Either nodeId, parameterId, or nodePath is required.",
    path: ["nodeId"]
  });

export const writeNodeBodySchema = z
  .object({
    sessionId: nonEmptyString,
    parameterId: nonEmptyString.optional(),
    nodeId: nonEmptyString.optional(),
    nodePath: nodePathSchema.optional(),
    value: nonEmptyString,
    readBack: z.boolean().default(true),
    approvalId: nonEmptyString.optional(),
    confirmationToken: nonEmptyString.optional(),
    expectedPreviousValue: nonEmptyString.optional()
  })
  .refine((value) => Boolean(value.parameterId ?? value.nodeId ?? value.nodePath), {
    message: "Either nodeId, parameterId, or nodePath is required.",
    path: ["nodeId"]
  });

export const rollbackSnapshotBodySchema = z.object({
  confirmationToken: nonEmptyString
});

export const listRuntimeDebugNodesQuerySchema = z.object({
  projectId: nonEmptyString,
  protocol: protocolSchema.optional()
});

export const listParameterReloadTargetsQuerySchema = z.object({
  projectId: nonEmptyString,
  protocol: protocolSchema
});

export const reloadParameterBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterDefinitionId: nonEmptyString,
  value: nonEmptyString,
  approvalId: nonEmptyString.optional(),
  confirmationToken: nonEmptyString.optional()
});

export const listDebugNodesAdminQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  protocol: protocolSchema.optional(),
  includeArchived: booleanQuerySchema
});

export const debugNodeBindingWriteSchema = z.object({
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: optionalTrimmedString
});

export const debugAdminNodeParamsSchema = z.object({
  nodeId: nonEmptyString
});

export const debugAdminNodeBindingParamsSchema = z.object({
  nodeId: nonEmptyString,
  protocol: z.enum(debugConnectionProtocols)
});

export const writeDebugNodeAdminBodySchema = z.object({
  projectId: nullableProjectIdSchema,
  name: nonEmptyString,
  description: optionalTrimmedString.default(""),
  detailedDescription: optionalTrimmedString.default(""),
  writeFormatExample: optionalTrimmedString.default(""),
  writeFormatHint: optionalTrimmedString.default(""),
  module: nonEmptyString,
  valueKind: debugValueKindSchema.default(DEBUG_VALUE_KIND_SCALAR),
  valueFormat: debugValueFormatSchema.default(DEBUG_VALUE_FORMAT_RAW),
  normalizationMode: debugNormalizationModeSchema.default(DEBUG_NORMALIZATION_MODE_TRIM),
  maxValueBytes: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().default(true),
  bindings: z.array(debugParameterNodeBindingSchema).optional()
});

export const patchDebugNodeAdminBodySchema = writeDebugNodeAdminBodySchema.partial();

export const upsertParameterReloadBindingBodySchema = z.object({
  projectId: nullableProjectIdSchema,
  parameterDefinitionId: nonEmptyString,
  protocol: protocolSchema,
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes).default("RW"),
  enabled: z.boolean().default(true),
  notes: z.string().trim().nullable().optional()
});

export const listParameterReloadBindingsAdminQuerySchema = z.object({
  projectId: nonEmptyString.optional()
});

export const debugAdminModuleParamsSchema = z.object({
  moduleName: nonEmptyString
});

export const writeDebugNodeModuleAdminBodySchema = z.object({
  name: nonEmptyString,
  description: optionalTrimmedString.default(""),
  scope: optionalTrimmedString.default("")
});

export const patchDebugNodeModuleAdminBodySchema = writeDebugNodeModuleAdminBodySchema.partial();

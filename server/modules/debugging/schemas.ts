import { z } from "zod";
import { debugConnectionProtocols, defaultDebugConnectionProtocol } from "./protocol";
import { debugAccessModes } from "./status";
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

export const debugParameterNodeBindingSchema = z.object({
  protocol: z.enum(debugConnectionProtocols),
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: z.string().trim().optional()
});

const moduleTreeQueryFields = {
  moduleId: nonEmptyString.optional(),
  includeDescendants: booleanQuerySchema.optional()
};

export const listDebuggingParametersQuerySchema = z.object({
  module: nonEmptyString.optional(),
  ...moduleTreeQueryFields,
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional(),
  protocol: protocolSchema.optional()
});

export const detectTargetsBodySchema = z.object({
  deviceId: nonEmptyString.optional(),
  bridgeId: nonEmptyString.optional(),
  protocol: protocolSchema
});

export const createDebugSessionBodySchema = z.object({
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
    nodePath: nodePathSchema.optional(),
    relatedOperationId: nonEmptyString.optional()
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

export const rollbackSnapshotBodySchema = z
  .object({
    confirmationToken: nonEmptyString.optional(),
    approvalId: nonEmptyString.optional()
  })
  .refine((value) => Boolean(value.confirmationToken || value.approvalId), {
    message: "Either confirmationToken or approvalId is required.",
    path: ["confirmationToken"]
  });

export const listRuntimeDebugNodesQuerySchema = z.object({
  protocol: protocolSchema.optional(),
  ...moduleTreeQueryFields
});

export const listDebugNodesAdminQuerySchema = z.object({
  protocol: protocolSchema.optional(),
  includeArchived: booleanQuerySchema,
  ...moduleTreeQueryFields
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

const writeDebugNodeAdminBodyBaseSchema = z.object({
  name: nonEmptyString,
  description: optionalTrimmedString.default(""),
  detailedDescription: optionalTrimmedString.default(""),
  writeFormatExample: optionalTrimmedString.default(""),
  writeFormatHint: optionalTrimmedString.default(""),
  module: nonEmptyString.optional(),
  moduleId: nonEmptyString.optional(),
  valueKind: debugValueKindSchema.default(DEBUG_VALUE_KIND_SCALAR),
  valueFormat: debugValueFormatSchema.default(DEBUG_VALUE_FORMAT_RAW),
  normalizationMode: debugNormalizationModeSchema.default(DEBUG_NORMALIZATION_MODE_TRIM),
  maxValueBytes: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().default(true),
  bindings: z.array(debugParameterNodeBindingSchema).optional()
});

export const writeDebugNodeAdminBodySchema = writeDebugNodeAdminBodyBaseSchema.refine(
  (value) => Boolean(value.module ?? value.moduleId),
  {
    message: "Either module or moduleId is required.",
    path: ["module"]
  }
);

export const patchDebugNodeAdminBodySchema = writeDebugNodeAdminBodyBaseSchema.partial();

export const debugAdminModuleParamsSchema = z.object({
  moduleId: nonEmptyString
});

export const writeDebugNodeModuleAdminBodySchema = z.object({
  name: nonEmptyString,
  parentId: nonEmptyString.nullable().optional(),
  description: optionalTrimmedString.default(""),
  scope: optionalTrimmedString.default(""),
  sortOrder: z.number().int().optional()
});

export const patchDebugNodeModuleAdminBodySchema = writeDebugNodeModuleAdminBodySchema
  .omit({ parentId: true })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "At least one field is required."
  });

export const moveDebugNodeModuleBodySchema = z.object({
  parentId: nonEmptyString.nullable()
});

export const DEBUG_CATALOG_FORMAT_V1 = "wiseeff.debug-node-catalog.v1" as const;

export const debugCatalogModuleSchema = z.object({
  name: nonEmptyString,
  parentNamePath: z.array(nonEmptyString).default([]),
  description: z.string().trim().default(""),
  scope: z.string().trim().default(""),
  sortOrder: z.number().int().optional()
});

const debugCatalogNodeSchema = z
  .object({
    id: nonEmptyString.optional(),
    name: nonEmptyString,
    description: z.string().trim().default(""),
    detailedDescription: optionalTrimmedString.default(""),
    writeFormatExample: optionalTrimmedString.default(""),
    writeFormatHint: optionalTrimmedString.default(""),
    module: nonEmptyString.optional(),
    moduleId: nonEmptyString.optional(),
    moduleNamePath: z.array(nonEmptyString).optional(),
    valueKind: debugValueKindSchema.default(DEBUG_VALUE_KIND_SCALAR),
    valueFormat: debugValueFormatSchema.default(DEBUG_VALUE_FORMAT_RAW),
    normalizationMode: debugNormalizationModeSchema.default(DEBUG_NORMALIZATION_MODE_TRIM),
    maxValueBytes: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().default(true),
    bindings: z.array(debugParameterNodeBindingSchema).default([])
  })
  .refine((value) => Boolean(value.module ?? value.moduleId ?? value.moduleNamePath?.length), {
    message: "Either module, moduleId, or moduleNamePath is required.",
    path: ["module"]
  });

export const debugCatalogDocumentSchema = z.object({
  format: z.literal(DEBUG_CATALOG_FORMAT_V1),
  modules: z.array(debugCatalogModuleSchema).max(500).default([]),
  nodes: z.array(debugCatalogNodeSchema).max(2000).default([])
});

export const importDebugCatalogBodySchema = debugCatalogDocumentSchema;

export const exportDebugCatalogQuerySchema = z.object({
  includeArchived: booleanQuerySchema
});

export type MoveDebugNodeModuleBody = z.infer<typeof moveDebugNodeModuleBodySchema>;
export type ListDebuggingParametersQuery = z.infer<typeof listDebuggingParametersQuerySchema>;
export type ListRuntimeDebugNodesQuery = z.infer<typeof listRuntimeDebugNodesQuerySchema>;
export type ListDebugNodesAdminQuery = z.infer<typeof listDebugNodesAdminQuerySchema>;
export type DebugCatalogDocument = z.infer<typeof debugCatalogDocumentSchema>;
export type DebugCatalogModule = z.infer<typeof debugCatalogModuleSchema>;
export type DebugCatalogNode = z.infer<typeof debugCatalogNodeSchema>;

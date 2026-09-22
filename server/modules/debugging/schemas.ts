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

const canonicalBindingSchema = z.object({
  projectId: nonEmptyString,
  bindingId: nonEmptyString,
  expectedEffectiveRevisionId: nonEmptyString.optional(),
  expectedCurrentValueId: nonEmptyString.optional(),
  sourcePinId: nonEmptyString.optional()
}).strict();

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
  bindings: z.array(debugParameterNodeBindingSchema).optional(),
  canonicalBinding: canonicalBindingSchema.nullable().optional()
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
export const DEBUG_CATALOG_FORMAT_V2 = "wiseeff.debug-node-catalog.v2" as const;

/**
 * Contract file-size ceiling for one debug-node catalog document, counted in UTF-8
 * bytes. It replaces the former 500-module / 2,000-node count limits so export and
 * import accept the same documents instead of the service producing files it cannot
 * read back.
 */
export const DEBUG_CATALOG_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const debugCatalogModuleSchema = z.object({
  name: nonEmptyString,
  parentNamePath: z.array(nonEmptyString).default([]),
  description: z.string().trim().default(""),
  scope: z.string().trim().default(""),
  sortOrder: z.number().int().optional()
}).strict();

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
  .strict()
  .refine((value) => Boolean(value.module ?? value.moduleId ?? value.moduleNamePath?.length), {
    message: "Either module, moduleId, or moduleNamePath is required.",
    path: ["module"]
  });

export const debugCatalogDocumentSchema = z
  .object({
    format: z.literal(DEBUG_CATALOG_FORMAT_V1),
    modules: z.array(debugCatalogModuleSchema).default([]),
    nodes: z.array(debugCatalogNodeSchema).default([])
  })
  .strict();

const catalogNullableTextSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (value === null ? null : value.trim()));

const catalogTextSchema = z.string().trim();

const catalogModuleNamePathSchema = z.array(nonEmptyString);

/** v2 binding: `notes` accepts an explicit `null` so a clear is distinguishable from omission. */
const debugCatalogV2BindingSchema = z
  .object({
    protocol: z.enum(debugConnectionProtocols),
    nodePath: nodePathSchema,
    accessMode: z.enum(debugAccessModes),
    enabled: z.boolean().default(true),
    notes: catalogNullableTextSchema.optional()
  })
  .strict();

/**
 * v2 module entry. `sortOrder` is optional and presence-aware: an omitted value keeps the
 * target ordering, while a provided value applies.
 */
const debugCatalogV2ModuleSchema = z
  .object({
    name: nonEmptyString,
    parentNamePath: catalogModuleNamePathSchema.default([]),
    description: catalogTextSchema.optional(),
    scope: catalogTextSchema.optional(),
    sortOrder: z.number().int().optional()
  })
  .strict();

/**
 * v2 node entry. Optional fields carry presence semantics: an omitted field keeps the
 * matched target value, `""` clears a clearable text field, and `null` clears a nullable
 * field. Zod defaults are deliberately absent so parsing never turns "omitted" into
 * "cleared"; declared v2 content is complete for the fields it does provide.
 */
const debugCatalogV2NodeSchema = z
  .object({
    sourceId: nonEmptyString.optional(),
    name: nonEmptyString,
    description: catalogTextSchema.optional(),
    detailedDescription: catalogTextSchema.optional(),
    writeFormatExample: catalogTextSchema.optional(),
    writeFormatHint: catalogTextSchema.optional(),
    moduleNamePath: catalogModuleNamePathSchema,
    valueKind: debugValueKindSchema.optional(),
    valueFormat: debugValueFormatSchema.optional(),
    normalizationMode: debugNormalizationModeSchema.optional(),
    maxValueBytes: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    archived: z.boolean().optional(),
    archiveReason: catalogNullableTextSchema.optional(),
    bindings: z.array(debugCatalogV2BindingSchema).optional()
  })
  .strict();

const debugCatalogV2SourceSchema = z
  .object({
    organizationId: nonEmptyString.optional(),
    organizationName: nonEmptyString.optional(),
    exportedAt: z.string().trim().optional()
  })
  .strict();

const debugCatalogV2CountsSchema = z
  .object({
    modules: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    bindings: z.number().int().nonnegative()
  })
  .strict();

export const debugCatalogV2DocumentSchema = z
  .object({
    format: z.literal(DEBUG_CATALOG_FORMAT_V2),
    source: debugCatalogV2SourceSchema,
    counts: debugCatalogV2CountsSchema,
    modules: z.array(debugCatalogV2ModuleSchema),
    nodes: z.array(debugCatalogV2NodeSchema)
  })
  .strict();

/** Any catalog document this service can read: current v2 plus the supported legacy v1 shape. */
export const anyDebugCatalogDocumentSchema = z.union([debugCatalogV2DocumentSchema, debugCatalogDocumentSchema]);

export const importDebugCatalogBodySchema = anyDebugCatalogDocumentSchema;

export const executeDebugCatalogImportBodySchema = z
  .object({
    document: anyDebugCatalogDocumentSchema,
    previewDigest: nonEmptyString
  })
  .strict();

/** Legacy export query shape: the route accepts it but export is always the full catalog. */
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
export type DebugCatalogV2Document = z.infer<typeof debugCatalogV2DocumentSchema>;
export type DebugCatalogV2Module = z.infer<typeof debugCatalogV2ModuleSchema>;
export type DebugCatalogV2Node = z.infer<typeof debugCatalogV2NodeSchema>;
export type AnyDebugCatalogDocument = z.infer<typeof anyDebugCatalogDocumentSchema>;
export type ExecuteDebugCatalogImportBody = z.infer<typeof executeDebugCatalogImportBodySchema>;

import { z } from "zod";
import { debugConnectionProtocols, defaultDebugConnectionProtocol } from "./protocol";
import { debugAccessModes, debugRiskLevels } from "./status";

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

export const debugParameterNodeBindingSchema = z.object({
  protocol: z.enum(debugConnectionProtocols),
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: z.string().trim().optional()
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

export const writeDebugParameterAdminBodySchema = z.object({
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
  bindings: z.array(debugParameterNodeBindingSchema).default([])
});

export const patchDebugParameterAdminBodySchema = writeDebugParameterAdminBodySchema.partial().extend({
  bindings: z.array(debugParameterNodeBindingSchema).optional()
});

export const archiveDebugParameterBodySchema = z.object({
  reason: z.string().trim().max(500).optional()
});

export const detectTargetsBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString.optional(),
  protocol: protocolSchema
});

export const createDebugSessionBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString,
  targetId: nonEmptyString,
  protocol: protocolSchema
});

export const readNodeBodySchema = z
  .object({
    sessionId: nonEmptyString,
    parameterId: nonEmptyString.optional(),
    nodePath: nodePathSchema.optional()
  })
  .refine((value) => Boolean(value.parameterId ?? value.nodePath), {
    message: "Either parameterId or nodePath is required.",
    path: ["parameterId"]
  });

export const writeNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString,
  nodePath: nodePathSchema.optional(),
  value: nonEmptyString,
  readBack: z.boolean().default(true),
  approvalId: nonEmptyString.optional(),
  confirmationToken: nonEmptyString.optional(),
  expectedPreviousValue: nonEmptyString.optional()
});

export const rollbackSnapshotBodySchema = z.object({
  confirmationToken: nonEmptyString
});

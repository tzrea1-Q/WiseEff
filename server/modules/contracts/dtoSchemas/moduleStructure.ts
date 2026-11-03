import { z } from "zod";

const recognitionValue = z.object({ compatibles: z.array(z.string()), nodeTypeName: z.string().nullable(),
  driverNature: z.enum(["physical-device", "logical-service"]).nullable(),
  instanceCardinality: z.enum(["multiple", "singleton-per-project"]).nullable() }).strict();

export const moduleStructureExportSchema = z.object({
  format: z.literal("wiseeff-module-structure"), version: z.literal(1),
  source: z.object({ exportId: z.string(), organizationId: z.string(), catalogReleaseId: z.string() }).strict(),
  limits: z.object({ maxBytes: z.number().int(), maxEntries: z.number().int() }).strict(),
  counts: z.object({ modules: z.number().int(), subjects: z.number().int() }).strict(),
  modules: z.array(z.object({ ref: z.string(), sourceId: z.string(), operation: z.literal("upsert"), name: z.string(),
    parentRef: z.string().nullable(), description: z.string(), scope: z.string(), sortOrder: z.number().int(), importance: z.enum(["high", "medium", "low"]),
    reference: z.object({ importanceOverride: z.boolean(), origin: z.string() }).strict() }).strict()),
  subjects: z.array(z.object({ subjectId: z.string(), kind: z.enum(["driver", "node-type", "configuration-schema"]), ownerSubjectId: z.string().nullable(), state: z.enum(["active", "retired"]),
    cascadeRetired: z.boolean(), placement: z.union([z.object({ kind: z.literal("unset") }).strict(),
      z.object({ kind: z.literal("unclassified") }).strict(), z.object({ kind: z.literal("module"), moduleRef: z.string() }).strict(),
      z.object({ kind: z.literal("reference"), sourceId: z.string() }).strict()]).nullable(),
    displayAlias: z.string().nullable(), recognition: z.object({ mode: z.enum(["inherit", "override"]),
      override: recognitionValue.nullable(), effective: recognitionValue }).strict().nullable() }).strict()),
  references: z.array(z.object({ sourceId: z.string(), parentId: z.string().nullable(), name: z.string(), kind: z.string(), archived: z.boolean() }).strict()),
}).strict();

const moduleUpdate = moduleStructureExportSchema.shape.modules.element.extend({
  ref: z.string().min(1).max(512),
  sourceId: z.string().optional(),
  operation: z.enum(["upsert", "delete"]).optional(), parentRef: z.string().min(1).max(512).nullable().optional(),
  reference: moduleStructureExportSchema.shape.modules.element.shape.reference.optional(),
  name: z.string().optional(), description: z.string().optional(), scope: z.string().optional(),
  sortOrder: z.number().int().min(-2147483648).max(2147483647).optional(), importance: z.enum(["high", "medium", "low"]).optional(),
});
const subjectUpdate = moduleStructureExportSchema.shape.subjects.element.partial().required({ subjectId: true }).extend({
  recognition: z.object({ mode: z.enum(["inherit", "override"]).optional(), override: recognitionValue.partial().nullable().optional(),
    effective: recognitionValue.partial().optional() }).strict().nullable().optional(),
});
export const moduleStructureUpdateDocumentSchema = moduleStructureExportSchema.extend({
  modules: z.array(moduleUpdate).max(10_000), subjects: z.array(subjectUpdate).max(10_000),
});
const resolutions = z.record(z.string(), z.enum(["current", "file"]));
export const moduleStructurePreviewRequestSchema = z.object({ mode: z.literal("update").default("update"), document: moduleStructureUpdateDocumentSchema, resolutions }).strict();
export const moduleStructureApplyRequestSchema = moduleStructurePreviewRequestSchema.extend({ token: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(1000) }).strict();
const fieldValue = z.union([z.string(), z.number(), z.null(), z.array(z.string()),
  moduleStructureExportSchema.shape.subjects.element.shape.placement,
  moduleStructureExportSchema.shape.subjects.element.shape.recognition,
  recognitionValue.extend({ kind: z.enum(["driver", "node-type"]), recognitionSubjectId: z.string().nullable(), overridden: z.boolean(),
    unmigratedRecognition: recognitionValue.optional() }).strict(), recognitionValue]);
export const moduleStructurePreviewResponseSchema = z.object({
  changes: z.array(z.object({ moduleId: z.string(), field: z.string(), before: fieldValue, after: fieldValue }).strict()),
  conflicts: z.array(z.object({ key: z.string(), moduleId: z.string(), field: z.string(), baseline: fieldValue, file: fieldValue, current: fieldValue }).strict()),
  impact: z.array(z.object({ subjectId: z.string(), projectId: z.string() }).strict()),
  token: z.string(),
}).strict();
export const moduleStructureReceiptSchema = z.object({ id: z.string(), organizationId: z.string(), changedModules: z.number().int(), changedFields: z.number().int() }).strict();

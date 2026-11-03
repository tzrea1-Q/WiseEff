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

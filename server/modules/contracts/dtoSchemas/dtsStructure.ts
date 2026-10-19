import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const dtsValueTypeSchema = z.enum([
  "u32-array", "bytes", "string-list", "phandle-list", "mixed", "bool", "empty"
]);

export const sourceLocatorSchema = z.object({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive()
});

export const structuralPropertySchema = z.object({
  name: nonEmptyString,
  valueType: dtsValueTypeSchema,
  rawText: z.string(),
  normalizedValue: z.string(),
  source: sourceLocatorSchema.optional()
});

export const structuralPhandleRefSchema = z.object({
  fromProperty: nonEmptyString,
  targetLabel: nonEmptyString,
  resolvedTargetPath: z.string().min(1).optional()
});

export const structuralNodeSchema = z.object({
  // Overlay root uses empty nodePath in the resolved/ingest model.
  nodePath: z.string(),
  name: nonEmptyString,
  unitAddress: z.string().min(1).optional(),
  labels: z.array(z.string()),
  compatible: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  properties: z.array(structuralPropertySchema),
  phandleRefs: z.array(structuralPhandleRefSchema),
  source: sourceLocatorSchema.optional()
});

export const structuralReadResponseSchema = z.object({
  nodes: z.array(structuralNodeSchema),
  navigation: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ready"),
      catalogReleaseId: nonEmptyString,
      managedNodePaths: z.array(z.string())
    }),
    z.object({
      status: z.literal("unavailable"),
      reason: z.enum(["catalog-unavailable", "registration-unavailable"])
    })
  ]).optional()
});

export type StructuralReadResponse = z.infer<typeof structuralReadResponseSchema>;
export const dtsSearchBySchema = z.enum(["path", "address", "label", "compatible", "value", "file"]);
export type DtsSearchBy = z.infer<typeof dtsSearchBySchema>;

export const structuralReadQuerySchema = z.object({
  navigationScope: z.literal("organization").optional()
});

export const dtsSearchQuerySchema = z.object({
  q: z.string(),
  // Omit `by` to search all dimensions (path/address/label/compatible/value/file).
  by: dtsSearchBySchema.optional(),
  navigationScope: z.literal("organization").optional()
});

export const dtsSearchHitSchema = z.object({
  fileId: nonEmptyString,
  fileName: nonEmptyString,
  versionId: nonEmptyString,
  nodePath: z.string(),
  propertyName: nonEmptyString.optional(),
  snippet: z.string().optional(),
  source: sourceLocatorSchema.optional()
});

export const dtsSearchResponseSchema = z.object({
  hits: z.array(dtsSearchHitSchema)
});

export type DtsSearchResponse = z.infer<typeof dtsSearchResponseSchema>;

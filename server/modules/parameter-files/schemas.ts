import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const uploadProjectParameterFileInputSchema = z.object({
  projectId: nonEmptyString,
  fileName: nonEmptyString,
  bytes: z.instanceof(Buffer)
});

export type UploadProjectParameterFileInput = z.infer<typeof uploadProjectParameterFileInputSchema>;

export const unsupportedConstructSchema = z.object({
  code: z.enum([
    "include",
    "unit-address-node",
    "overlay-ref",
    "inline-label",
    "boolean-property",
    "multi-cell-group"
  ]),
  message: z.string(),
  sample: z.string()
});

export const uploadProjectParameterFileResponseSchema = z.object({
  item: z.record(z.string(), z.unknown()),
  version: z.record(z.string(), z.unknown()),
  unsupportedConstructs: z.array(unsupportedConstructSchema).optional()
});

export const configSetRoleSchema = z.enum(["base", "overlay", "charging", "thermal", "misc"]);

export const createConfigSetBody = z.object({
  name: nonEmptyString,
  description: z.string().optional(),
  derivedFromId: nonEmptyString.optional()
});

export const addConfigSetFileBody = z.object({
  fileId: nonEmptyString,
  role: configSetRoleSchema,
  sortOrder: z.number().int().optional()
});

export const createBaselineBody = z.object({
  name: nonEmptyString,
  notes: z.string().optional()
});

export const dtsValueTypeSchema = z.enum([
  "u32-array",
  "bytes",
  "string-list",
  "phandle-list",
  "mixed",
  "bool",
  "empty"
]);

export const structuralPropertySchema = z.object({
  name: nonEmptyString,
  valueType: dtsValueTypeSchema,
  rawText: z.string(),
  normalizedValue: z.string()
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
  phandleRefs: z.array(structuralPhandleRefSchema)
});

export const structuralReadResponseSchema = z.object({
  nodes: z.array(structuralNodeSchema)
});

export type StructuralReadResponse = z.infer<typeof structuralReadResponseSchema>;

export const dtsSearchBySchema = z.enum(["path", "address", "label", "compatible", "value"]);

export type DtsSearchBy = z.infer<typeof dtsSearchBySchema>;

export const dtsSearchQuerySchema = z.object({
  q: z.string(),
  by: dtsSearchBySchema.default("path")
});

export const dtsSearchHitSchema = z.object({
  fileId: nonEmptyString,
  fileName: nonEmptyString,
  versionId: nonEmptyString,
  nodePath: z.string(),
  propertyName: nonEmptyString.optional(),
  snippet: z.string().optional()
});

export const dtsSearchResponseSchema = z.object({
  hits: z.array(dtsSearchHitSchema)
});

export type DtsSearchResponse = z.infer<typeof dtsSearchResponseSchema>;

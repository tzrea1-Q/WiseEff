import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const uploadProjectParameterFileInputSchema = z.object({
  projectId: nonEmptyString,
  fileName: nonEmptyString,
  bytes: z.instanceof(Buffer)
});

export type UploadProjectParameterFileInput = z.infer<typeof uploadProjectParameterFileInputSchema>;

export const uploadProjectParameterFileResponseSchema = z.object({
  item: z.record(z.string(), z.unknown()),
  version: z.record(z.string(), z.unknown()),
  driverSummary: z
    .object({
      matchedRegistered: z.array(z.string()),
      newUnregistered: z.array(z.string()),
      matchedRegisteredCount: z.number().int().nonnegative(),
      newUnregisteredCount: z.number().int().nonnegative(),
    })
    .optional(),
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
  notes: z.string().optional(),
  gateToken: nonEmptyString,
  acknowledgedWarningIds: z.array(nonEmptyString).optional()
});

export const releaseBaselineBody = z.object({
  gateToken: nonEmptyString,
  acknowledgedWarningIds: z.array(nonEmptyString).optional()
});

export {
  dtsValueTypeSchema, sourceLocatorSchema, structuralPropertySchema, structuralPhandleRefSchema,
  structuralNodeSchema, structuralReadResponseSchema, dtsSearchBySchema, structuralReadQuerySchema,
  dtsSearchQuerySchema, dtsSearchHitSchema, dtsSearchResponseSchema,
  type StructuralReadResponse, type DtsSearchBy, type DtsSearchResponse
} from "../contracts/dtoSchemas/dtsStructure";

export const submitStructuredEditsBodySchema = z.object({
  edits: z
    .array(
      z.object({
        fileId: nonEmptyString,
        nodePath: z.string(),
        propertyName: nonEmptyString,
        rawText: z.string(),
        reason: z.string().optional(),
        projectParameterBindingId: nonEmptyString.optional(),
        parameterSpecId: nonEmptyString.optional()
      })
    )
    .min(1),
  reason: z.string().optional(),
  assignees: z
    .object({
      hardwareCommitterId: nonEmptyString,
      softwareCommitterId: nonEmptyString,
      softwareUserId: nonEmptyString
    })
    .optional()
});

export type SubmitStructuredEditsBody = z.infer<typeof submitStructuredEditsBodySchema>;

import { z } from "zod";
import { memberAdditionApplyResponseSchema, memberAdditionPreviewResponseSchema } from "./canonicalMemberAddition";

export const updateConfigurationMetadataSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullish()
}).strict();

export const updateDraftBaselineSchema = z.object({
  name: z.string().trim().min(1),
  notes: z.string().nullish()
}).strict();

export const appendBaselineErratumSchema = z.object({
  note: z.string().trim().min(1),
  source: z.string().trim().min(1)
}).strict();

export const correctedConfigSetResponseSchema = z.object({ item: z.object({
  id: z.string(), organizationId: z.string(), projectId: z.string(), name: z.string(),
  description: z.string().optional(), derivedFromId: z.string().optional(), createdAt: z.string(), updatedAt: z.string()
}) });

const baseline = z.object({
  id: z.string(), organizationId: z.string(), configSetId: z.string(), name: z.string(), notes: z.string().optional(),
  status: z.enum(["draft", "released", "historical"]), createdAt: z.string(), createdBy: z.string().optional(),
  errata: z.array(appendBaselineErratumSchema.extend({ id: z.string(), actorName: z.string(), createdAt: z.string() })).optional()
});
export const correctedBaselineResponseSchema = z.object({ item: baseline });
export const correctedBaselineDetailResponseSchema = correctedBaselineResponseSchema.extend({
  members: z.array(z.object({ baselineId: z.string(), fileId: z.string(), fileVersionId: z.string(),
    fileName: z.string().optional(), versionNumber: z.number().int() }))
});
export const correctedBaselineListResponseSchema = z.object({ items: z.array(baseline) });

const confirmation = {
  proofToken: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(1).max(2000),
  clientMutationId: z.string().trim().min(1).max(160)
};
export const pathCorrectionSchema = z.object({ sourceName: z.string().min(1).max(240) }).strict();
export const pathCorrectionApplySchema = pathCorrectionSchema.extend(confirmation);
const pathCorrection = z.object({ from: z.string(), to: z.string(),
  references: z.array(z.object({ sourceName: z.string(), target: z.string(), line: z.number().int().positive(), column: z.number().int().positive() })),
  versions: z.array(z.object({ fileId: z.string(), fileVersionId: z.string(), baseFileVersionId: z.string(), contentChanged: z.boolean() }))
});
const preview = memberAdditionPreviewResponseSchema.shape.item;
export const pathCorrectionPreviewResponseSchema = z.object({ item: preview.pick({
  proofToken: true, entryFile: true, includeSearchPaths: true, overlayOrder: true, diagnostics: true
}).extend({ pathCorrection }) });
export const pathCorrectionApplyResponseSchema = z.object({ item: memberAdditionApplyResponseSchema.shape.item.extend({ pathCorrection }) });

const jsonMapping = z.object({ definitionId: z.string().min(1).max(240), pointer: z.string().max(2000) }).strict();
const jsonMappingValue = jsonMapping.extend({ value: z.unknown() });
export const jsonCorrectionSchema = z.object({
  configurationSchemaId: z.string().trim().min(1).max(240), rootPointer: z.string().max(2000),
  mappings: z.array(jsonMapping).min(1).max(1000)
}).strict();
export const jsonCorrectionApplySchema = jsonCorrectionSchema.extend(confirmation);
export const jsonCorrectionPreviewResponseSchema = z.object({ item: preview.pick({ proofToken: true }).extend({ values: z.array(jsonMappingValue) }) });
export const jsonCorrectionApplyResponseSchema = z.object({ item: memberAdditionApplyResponseSchema.shape.item.extend({
  jsonCorrection: z.object({ previousOccurrenceId: z.string(), successorOccurrenceId: z.string(), bindingIds: z.array(z.string()) })
}) });
export const jsonCorrectionOptionsResponseSchema = z.object({
  configSetId: z.string().nullable(), fileVersionId: z.string().nullable(),
  items: z.array(z.object({ occurrenceId: z.string(), configurationInstanceId: z.string(), subjectId: z.string(),
    configurationSchemaId: z.string(), rootPointer: z.string(), bindings: z.array(jsonMappingValue.extend({ bindingId: z.string(), valueId: z.string() })) })),
  schemas: z.array(z.object({ id: z.string(), definitions: z.array(z.object({ id: z.string(), key: z.string() })) }))
});

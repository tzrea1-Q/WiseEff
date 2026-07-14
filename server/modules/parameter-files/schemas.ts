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

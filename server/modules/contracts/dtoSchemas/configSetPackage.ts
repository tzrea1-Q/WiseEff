import { z } from "zod";
import { dtsBuildInputsSchema, dtsDefinesSchema, dtsPreprocessingReceiptSchema } from "./dtsPreprocessing";
import { sharedDtsiDependencySchema, sharedDtsiManifestSchema } from "./sharedDtsi";

export const configSetPackageManifestName = "wiseeff-config-set-export-manifest.json";
export const configSetPackageLimits = { maxFiles: 128, maxFileBytes: 2_097_152, maxManifestBytes: 4_194_304, maxTotalBytes: 16_777_216, maxArchiveBytes: 17_825_792 };
const path = z.string().min(1).max(240).refine(value => value === value.trim() && !/[:\\\u0000-\u001f\u007f]/u.test(value)
  && value.split("/").every(part => part && part !== "." && part !== ".."), "文件路径必须是完整的相对路径。");
const sharedMember = z.object({ resourceId: z.string(), versionId: z.string(), memberId: z.string() });
export const configSetSourcePackageSchema = z.object({
  schemaVersion: z.literal("wiseeff-config-set/v1"),
  entryFile: path.nullable(), includeSearchPaths: z.array(dtsBuildInputsSchema.shape.includeSearchPaths.removeDefault().element).max(128), overlayOrder: z.array(path).max(128),
  formerRootOverlayFiles: z.array(path).max(128).default([]),
  declaredBuildInputs: dtsBuildInputsSchema,
  resolvedBuildInputs: z.object({ includeSearchPaths: z.array(dtsBuildInputsSchema.shape.includeSearchPaths.removeDefault().element).max(128), defines: dtsDefinesSchema }),
  preprocessing: dtsPreprocessingReceiptSchema.optional(),
  members: z.array(z.object({ sourceName: path, format: z.enum(["dts", "json"]),
    role: z.enum(["base", "include", "overlay", "charging", "thermal", "misc"]), sortOrder: z.number().int().min(0).max(100000),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u), shared: sharedMember.optional() })).min(1).max(128),
  sharedClosure: z.array(sharedDtsiDependencySchema.extend({ digest: z.string(), manifest: sharedDtsiManifestSchema, direct: z.boolean() })).max(64),
  jsonSources: z.array(z.object({ sourceName: path, configurationSchemaId: z.string().min(1).max(240), rootPointer: z.string().max(2000),
    mappings: z.array(z.object({ definitionId: z.string().min(1).max(240), pointer: z.string().max(2000) })).min(1).max(1000) })).max(128)
});
export type ConfigSetSourcePackage = z.infer<typeof configSetSourcePackageSchema>;
const importFields = {
  name: z.string().trim().min(1).max(120), ownership: z.enum(["reuse", "private"]),
  sourceConfiguration: z.object({ entryFile: path.nullable(), overlayOrder: z.array(path).max(128), buildInputs: dtsBuildInputsSchema }).strict().optional(),
  archive: z.object({ name: z.string().max(240), contentBase64: z.string().min(1).max(Math.ceil(configSetPackageLimits.maxArchiveBytes / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/u) }).strict()
};
export const configSetImportPreviewBodySchema = z.object(importFields).strict();
export const configSetImportApplyBodySchema = z.object({ ...importFields, proofToken: z.string().regex(/^[a-f0-9]{64}$/u),
  reason: z.string().trim().min(1).max(2000), clientMutationId: z.string().trim().min(1).max(160) }).strict();
const importReadySchema = z.object({ proofToken: z.string(), name: z.string(), ownership: z.enum(["reuse", "private"]),
  entryFile: z.string().nullable(), members: z.array(z.object({ sourceName: z.string(), format: z.enum(["dts", "json"]), ownership: z.enum(["shared", "private"]) })),
  sharedVersions: z.array(z.object({ name: z.string(), version: z.number(), mountPath: z.string() })),
  nodeCount: z.number(), diagnostics: z.array(z.object({ severity: z.enum(["warning", "error"]), message: z.string() })) });
const sourceSelectionSchema = z.object({ kind: z.literal("source-selection"), members: z.array(z.object({ sourceName: z.string(), format: z.enum(["dts", "json"]) })) });
export const configSetImportPreviewResponseSchema = z.object({ item: z.union([importReadySchema, sourceSelectionSchema]) });
export const configSetImportApplyResponseSchema = z.object({ item: z.object({ configSetId: z.string(), configRevisionId: z.string(),
  fileIds: z.array(z.string()), ownership: z.enum(["reuse", "private"]) }) });
export type ConfigSetImportBody = z.infer<typeof configSetImportPreviewBodySchema>;
export type ConfigSetImportPreview = z.infer<typeof importReadySchema>;
export type ConfigSetImportInspection = z.infer<typeof configSetImportPreviewResponseSchema>["item"];
export type ConfigSetImportResult = z.infer<typeof configSetImportApplyResponseSchema>["item"];

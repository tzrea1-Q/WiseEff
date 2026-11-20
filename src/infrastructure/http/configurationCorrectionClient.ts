import {
  correctedBaselineResponseSchema, correctedConfigSetResponseSchema, jsonCorrectionApplyResponseSchema, jsonCorrectionApplySchema,
  jsonCorrectionOptionsResponseSchema, jsonCorrectionPreviewResponseSchema, jsonCorrectionSchema,
  pathCorrectionApplyResponseSchema, pathCorrectionApplySchema, pathCorrectionPreviewResponseSchema
} from "@wiseeff/dto-schemas";
import type { z } from "zod";
import type { ApiClient } from "./apiClient";

export type JsonCorrection = z.infer<typeof jsonCorrectionSchema>;
export type JsonCorrectionOptions = z.infer<typeof jsonCorrectionOptionsResponseSchema>;
export type SourceCorrectionPreview = z.infer<typeof pathCorrectionPreviewResponseSchema>["item"]
  | z.infer<typeof jsonCorrectionPreviewResponseSchema>["item"];

export function createConfigurationCorrectionClient(client: ApiClient, projectId: string) {
  const project = encodeURIComponent(projectId);
  const v1 = `/api/v1/projects/${project}`;
  const set = (id: string) => `${v1}/config-sets/${encodeURIComponent(id)}`;
  const baseline = (id: string) => `${v1}/baselines/${encodeURIComponent(id)}`;
  const file = (setId: string, id: string) => `${set(setId)}/files/${encodeURIComponent(id)}/path-correction`;
  const json = (id: string) => `/api/v2/projects/${project}/parameter-files/${encodeURIComponent(id)}/configuration-instances`;
  const association = (id: string, occurrenceId: string) => `${json(id)}/${encodeURIComponent(occurrenceId)}/correction`;
  return {
    updateSet: async (id: string, body: { name: string; description: string | null }) =>
      correctedConfigSetResponseSchema.parse(await client.patch(set(id), body)),
    updateBaseline: async (id: string, body: { name: string; notes: string | null }) =>
      correctedBaselineResponseSchema.parse(await client.patch(baseline(id), body)),
    appendErratum: async (id: string, body: { note: string; source: string }) =>
      correctedBaselineResponseSchema.parse(await client.post(`${baseline(id)}/errata`, body)),
    previewPath: async (setId: string, id: string, sourceName: string) =>
      pathCorrectionPreviewResponseSchema.parse(await client.post(`${file(setId, id)}/preview`, { sourceName })),
    applyPath: async (setId: string, id: string, body: z.infer<typeof pathCorrectionApplySchema>) =>
      pathCorrectionApplyResponseSchema.parse(await client.post(`${file(setId, id)}/apply`, body)),
    listInstances: async (id: string) => jsonCorrectionOptionsResponseSchema.parse(await client.get(json(id))),
    previewJson: async (id: string, occurrenceId: string, body: JsonCorrection) =>
      jsonCorrectionPreviewResponseSchema.parse(await client.post(`${association(id, occurrenceId)}/preview`, body)),
    applyJson: async (id: string, occurrenceId: string, body: z.infer<typeof jsonCorrectionApplySchema>) =>
      jsonCorrectionApplyResponseSchema.parse(await client.post(`${association(id, occurrenceId)}/apply`, body))
  };
}

export type ConfigurationCorrectionClient = ReturnType<typeof createConfigurationCorrectionClient>;

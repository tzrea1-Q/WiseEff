import { xiaozeSuggestResponseSchema } from "@wiseeff/dto-schemas";

import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import { parseContractDto } from "./parseContractDto";

type ApiClient = ReturnType<typeof createApiClient>;

export type XiaozeSuggestionsContext = {
  path?: string;
  pageKey?: string;
  projectId?: string;
  projectName?: string;
};

export async function requestXiaozeSuggestions(
  context: XiaozeSuggestionsContext,
  apiClient: ApiClient = createDefaultApiClient()
) {
  const response = parseContractDto(
    xiaozeSuggestResponseSchema,
    await apiClient.post<unknown>("/api/v1/agent/xiaoze/suggest", { context }),
    "XiaozeSuggestResponse"
  );
  return response.suggestions;
}

import { catalogLegacyGoneResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

import { LEGACY_SUCCESSOR_PATH } from "./types";
import { successorLinkHeaders } from "./headers";
import type { LegacyHttpResult } from "./types";

export const LEGACY_WRITE_GONE_MESSAGE = "Legacy structural writes are retired.";
export const LEGACY_GOVERNANCE_GONE_MESSAGE = "Legacy governance and raw catalog reads are retired.";

export function catalogLegacyGoneResult(
  requestId: string,
  message: string,
): LegacyHttpResult {
  const body = catalogLegacyGoneResponseSchema.parse({
    error: {
      code: "GONE",
      message,
      details: {
        reason: "legacy-surface-retired",
        successor: LEGACY_SUCCESSOR_PATH,
        retryable: false,
      },
      requestId,
    },
  });
  return {
    status: 410,
    body,
    headers: successorLinkHeaders(),
  };
}

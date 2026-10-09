import { catalogLegacyGoneResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

import { LEGACY_SUCCESSOR_PATH } from "./types";
import type { LegacyHttpResult } from "./types";

export const LEGACY_WRITE_GONE_MESSAGE = "Legacy structural writes are retired.";
export const LEGACY_GOVERNANCE_GONE_MESSAGE = "Legacy governance and raw catalog reads are retired.";

export const legacyRouteSuccessor = (routeId: string): string =>
  routeId === "parameterSpecs.resolveReviewTask" ||
  routeId === "parameterTopology.resolveIdentityMappingTask" ||
  routeId === "parameterTopology.reopenIdentityMappingTask"
    ? "/parameter-admin/specs?review=open"
    : LEGACY_SUCCESSOR_PATH;

export function catalogLegacyGoneResult(
  requestId: string,
  message: string,
  successor = LEGACY_SUCCESSOR_PATH,
): LegacyHttpResult {
  const body = catalogLegacyGoneResponseSchema.parse({
    error: {
      code: "GONE",
      message,
      details: {
        reason: "legacy-surface-retired",
        successor,
        retryable: false,
      },
      requestId,
    },
  });
  return {
    status: 410,
    body,
    headers: { Link: `<${successor}>; rel="successor-version"` },
  };
}

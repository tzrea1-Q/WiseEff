import type {
  CatalogConditionalWriteContext,
  CatalogIdempotentWriteContext
} from "@/application/ports/ParameterCatalogGovernanceRepository";

import { catalogApiFailure } from "./errors";

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function requireIdempotentWriteContext(
  context: CatalogIdempotentWriteContext
): CatalogIdempotentWriteContext {
  if (!nonEmpty(context.catalogReleaseId)) {
    throw catalogApiFailure("release-drift");
  }
  if (!nonEmpty(context.idempotencyKey)) {
    throw catalogApiFailure("revision-conflict");
  }
  return {
    catalogReleaseId: context.catalogReleaseId,
    idempotencyKey: context.idempotencyKey
  };
}

export function requireConditionalWriteContext(
  context: CatalogConditionalWriteContext
): CatalogConditionalWriteContext {
  const idempotent = requireIdempotentWriteContext(context);
  if (!nonEmpty(context.ifMatch)) {
    throw catalogApiFailure("revision-conflict");
  }
  return {
    ...idempotent,
    ifMatch: context.ifMatch
  };
}

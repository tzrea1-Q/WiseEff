import type { z } from "zod";

import type { TrustedInvocationContext } from "../../auth/trustedInvocation";
import type {
  lookupProtectedIdentity,
  MappingQueryable,
} from "../../catalog-cutover/mapping";
import type { catalogLegacyIdentifierDtoSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import type { RouteRequest } from "../../../shared/http/router";

export const LEGACY_LOOKUP_SOURCE_SYSTEM = "wiseeff-v1";

export const LEGACY_SUCCESSOR_PATH = "/api/v2/catalog";

export type CatalogLegacyIdentifierItem = z.infer<typeof catalogLegacyIdentifierDtoSchema>;

export type LegacyLookupFn = typeof lookupProtectedIdentity;

export type LegacyCatalogInvocationResolver = (
  request: RouteRequest,
) => Promise<TrustedInvocationContext | null> | TrustedInvocationContext | null;

export type LegacyCatalogOptions = {
  readonly catalogReleaseId: string;
  readonly resolveCatalogReleaseId?: () => Promise<string>;
  readonly sunsetHttpDate: string;
  readonly getQueryable: () => MappingQueryable | Promise<MappingQueryable>;
  readonly resolveInvocation: LegacyCatalogInvocationResolver;
  readonly lookup?: LegacyLookupFn;
};

export type LegacyHttpHeaders = Record<string, string>;

export type LegacyHttpResult = {
  readonly status: number;
  readonly body: unknown;
  readonly headers: LegacyHttpHeaders;
};

export type LegacyLookupOutcome =
  | { readonly kind: "mapped"; readonly item: CatalogLegacyIdentifierItem }
  | { readonly kind: "archived" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "not-found" };

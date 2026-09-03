export { catalogLegacyGoneResult, LEGACY_GOVERNANCE_GONE_MESSAGE, LEGACY_WRITE_GONE_MESSAGE } from "./gone";
export {
  boundedLegacyHeaders,
  LEGACY_DEPRECATION_VALUE,
  LEGACY_IDENTITY_CONTRACT,
  LEGACY_MODULE_CONTRACT,
  LEGACY_SPEC_CONTRACT,
  LEGACY_SPEC_WARNING,
  LEGACY_SUCCESSOR_LINK,
} from "./headers";
export { createLegacyCatalogHttpServer, listenLegacyCatalogHttpServer } from "./httpServer";
export { catalogTargetHref, lookupLegacyIdentifier } from "./lookup";
export {
  handleLegacyCatalogRequest,
  registerCatalogLegacyRoutes,
  legacyEligibleRouteManifest,
  legacyWriteRouteManifest,
} from "./routes";
export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixRow } from "./threatMatrix";
export {
  LEGACY_LOOKUP_SOURCE_SYSTEM,
  LEGACY_SUCCESSOR_PATH,
} from "./types";
export type {
  CatalogLegacyIdentifierItem,
  LegacyCatalogOptions,
  LegacyHttpResult,
  LegacyLookupFn,
  LegacyLookupOutcome,
} from "./types";

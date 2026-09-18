import {
  CATALOG_CAPABILITY_ALLOW_LIST,
  CATALOG_CAPABILITY_V3_ALLOW_LIST,
} from "../builder/capabilities";
import {
  CATALOG_CAPABILITY_CONTRACT_REVISION,
  CATALOG_CAPABILITY_V3_REVISION,
} from "../builder/types";

/**
 * First-version consumer capability set. This is not a general negotiation
 * platform. Unknown catalog capability revisions fail closed.
 */
export const SUPPORTED_CATALOG_CONSUMER_CAPABILITIES = Object.freeze({
  revision: CATALOG_CAPABILITY_CONTRACT_REVISION,
  allowListId: CATALOG_CAPABILITY_ALLOW_LIST.id,
  compiler: "catalog-kernel/compileCatalogRelease",
  content: CATALOG_CAPABILITY_ALLOW_LIST.id,
  matcher: "catalog-kernel/subjectMatch",
  valueValidator: "parameter-bindings/projectValue",
});

/**
 * Frozen v3 consumer: historical meaning only. Tests inject this set; production
 * does not.
 */
export const CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS: ReadonlySet<string> = new Set([
  "catalog-capability/v1",
  "catalog-capability/v2",
  CATALOG_CAPABILITY_V3_REVISION,
]);

/**
 * Historical revisions stay admitted so previously published releases keep their
 * original interpretation; the current revision adds nested value schemas.
 */
export const SUPPORTED_CATALOG_CONSUMER_REVISIONS: ReadonlySet<string> = new Set([
  ...CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS,
  CATALOG_CAPABILITY_CONTRACT_REVISION,
]);

export const admitCatalogCapabilityRevision = (
  revision: string,
  supported: ReadonlySet<string> = SUPPORTED_CATALOG_CONSUMER_REVISIONS,
): boolean => supported.has(revision);

export const catalogConsumerSupportsRevision = (revision: string): boolean =>
  admitCatalogCapabilityRevision(revision);

export {
  CATALOG_CAPABILITY_ALLOW_LIST,
  CATALOG_CAPABILITY_V3_ALLOW_LIST,
};

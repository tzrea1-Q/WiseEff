import { CATALOG_CAPABILITY_ALLOW_LIST } from "../builder/capabilities";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../builder/types";

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

export const catalogConsumerSupportsRevision = (revision: string): boolean =>
  revision === SUPPORTED_CATALOG_CONSUMER_CAPABILITIES.revision;

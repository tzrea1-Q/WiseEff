import type { CatalogBrowserEvidenceRefusal, CatalogBrowserEvidenceRefusalKind } from "./types";

export const catalogBrowserEvidenceRefusal = (
  kind: CatalogBrowserEvidenceRefusalKind,
  detail: string,
): CatalogBrowserEvidenceRefusal => ({ kind, detail });

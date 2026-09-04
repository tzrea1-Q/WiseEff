import type { CatalogApiEvidenceRefusal, CatalogApiEvidenceRefusalKind } from "./types";

export const catalogApiEvidenceRefusal = (
  kind: CatalogApiEvidenceRefusalKind,
  detail: string,
): CatalogApiEvidenceRefusal => ({ kind, detail });

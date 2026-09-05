export const CATALOG_PAGE_PATH = "/parameter-admin/specs";

export type CatalogUrlAnchor = {
  subjectId: string | null;
  definitionId: string | null;
  catalogReleaseId: string | null;
  reviewItemId: string | null;
};

export const EMPTY_CATALOG_URL_ANCHOR: CatalogUrlAnchor = {
  subjectId: null,
  definitionId: null,
  catalogReleaseId: null,
  reviewItemId: null
};

const ANCHOR_KEYS = ["subjectId", "definitionId", "catalogReleaseId", "reviewItemId"] as const;

function readOpaque(params: URLSearchParams, key: (typeof ANCHOR_KEYS)[number]): string | null {
  const value = params.get(key);
  if (!value || !value.trim()) return null;
  return value;
}

export function parseCatalogUrlAnchor(search: string): CatalogUrlAnchor {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    subjectId: readOpaque(params, "subjectId"),
    definitionId: readOpaque(params, "definitionId"),
    catalogReleaseId: readOpaque(params, "catalogReleaseId"),
    reviewItemId: readOpaque(params, "reviewItemId")
  };
}

export function serializeCatalogUrlAnchor(anchor: CatalogUrlAnchor): string {
  const params = new URLSearchParams();
  for (const key of ANCHOR_KEYS) {
    const value = anchor[key];
    if (value && value.trim()) {
      params.set(key, value);
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function buildCatalogHref(anchor: CatalogUrlAnchor): string {
  return `${CATALOG_PAGE_PATH}${serializeCatalogUrlAnchor(anchor)}`;
}

export type CatalogLegacyBookmark = {
  legacyType: "parameter-spec";
  legacyId: string;
};

/** Official leftover spec-library keys. Name search is not a bookmark resolver. */
export function readLegacyCatalogBookmark(search: string): CatalogLegacyBookmark | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const legacyId = params.get("spec")?.trim() || params.get("parameterSpecId")?.trim() || "";
  if (!legacyId) {
    return null;
  }
  return { legacyType: "parameter-spec", legacyId };
}

export function withCatalogReleasePin<T extends { catalogReleaseId?: string }>(
  query: T | undefined,
  catalogReleaseId: string | null
): T | { catalogReleaseId: string } | undefined {
  if (!catalogReleaseId) {
    return query;
  }
  return { ...(query ?? ({} as T)), catalogReleaseId };
}

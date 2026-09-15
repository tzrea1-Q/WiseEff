export const CATALOG_PAGE_PATH = "/parameter-admin/specs";

export type CatalogUrlAnchor = {
  subjectId: string | null;
  definitionId: string | null;
  catalogReleaseId: string | null;
  reviewItemId: string | null;
  /**
   * Restored-workspace collection state. It lives in the same opaque anchor so
   * reload, Back and Forward reproduce an exact context (issue #847 story 13).
   */
  q: string | null;
  lifecycle: string | null;
  moduleNodeId: string | null;
  pageSize: number | null;
  cursor: string | null;
};

export const CATALOG_PAGE_SIZES = [20, 50, 100] as const;
export type CatalogPageSize = (typeof CATALOG_PAGE_SIZES)[number];
export const CATALOG_DEFAULT_PAGE_SIZE: CatalogPageSize = 50;

export const EMPTY_CATALOG_URL_ANCHOR: CatalogUrlAnchor = {
  subjectId: null,
  definitionId: null,
  catalogReleaseId: null,
  reviewItemId: null,
  q: null,
  lifecycle: null,
  moduleNodeId: null,
  pageSize: null,
  cursor: null
};

const ANCHOR_KEYS = [
  "subjectId",
  "definitionId",
  "catalogReleaseId",
  "reviewItemId",
  "q",
  "lifecycle",
  "moduleNodeId",
  "cursor"
] as const;

export function parseCatalogPageSize(value: string | null): CatalogPageSize | null {
  if (!value) return null;
  const parsed = Number(value);
  return (CATALOG_PAGE_SIZES as readonly number[]).includes(parsed)
    ? (parsed as CatalogPageSize)
    : null;
}

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
    reviewItemId: readOpaque(params, "reviewItemId"),
    q: readOpaque(params, "q"),
    lifecycle: readOpaque(params, "lifecycle"),
    moduleNodeId: readOpaque(params, "moduleNodeId"),
    pageSize: parseCatalogPageSize(params.get("pageSize")),
    cursor: readOpaque(params, "cursor")
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
  if (anchor.pageSize) {
    params.set("pageSize", String(anchor.pageSize));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/** True when the anchor carries any non-identity collection state. */
export function hasCatalogCollectionState(anchor: CatalogUrlAnchor): boolean {
  return Boolean(
    anchor.q || anchor.lifecycle || anchor.moduleNodeId || anchor.cursor || anchor.pageSize
  );
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

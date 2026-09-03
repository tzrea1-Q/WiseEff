export type ThreatMatrixRow = {
  readonly id: number;
  readonly name: string;
  readonly initialState: string;
  readonly action: string;
  readonly expected: string;
  readonly leftover: string;
};

const freezeRow = (row: ThreatMatrixRow): ThreatMatrixRow => Object.freeze(row);

export const THREAT_MATRIX: readonly ThreatMatrixRow[] = Object.freeze([
  freezeRow({
    id: 1,
    name: "nine-route-kernel-closure",
    initialState: "frozen S8-CON read request, captured Kernel pin, trusted scope, and cursor",
    action: "dispatch each of the nine GET /api/v2/catalog read routes",
    expected: "exactly the S8-CON Kernel snapshot operation for that route; one canonical DTO or typed error",
    leftover: "no extra Catalog read, no handler-owned alias/lifecycle/revision/page policy",
  }),
  freezeRow({
    id: 2,
    name: "catalog-isolation",
    initialState: "production TypeScript of S8-READ",
    action: "static scan of production sources for Catalog structural DML/SELECT and raw repositories",
    expected: "consume CatalogRuntime snapshot results only; never SELECT or INSERT Catalog relations",
    leftover: "only S8-CON DTO mapping, S3-RUN tagged results, and injected registration/usage/timeline ports",
  }),
  freezeRow({
    id: 3,
    name: "no-post-filter",
    initialState: "Kernel page whose item order is not the HTTP-preferred order",
    action: "map the page to a collection envelope",
    expected: "items and next cursor pass through unchanged; no sort, drop, or fill-from-another-source",
    leftover: "Kernel page cardinality and cursor bytes preserved",
  }),
  freezeRow({
    id: 4,
    name: "scope-hiding",
    initialState: "authenticated caller plus spoof role/org/agent headers, or an out-of-scope identifier",
    action: "GET a catalog read route",
    expected: "trusted scope only; out-of-scope IDs are 404 with the unknown reason and no existence leak",
    leftover: "Kernel is not consulted for a hidden identifier; spoof headers are stripped",
  }),
  freezeRow({
    id: 5,
    name: "catalog-not-ready",
    initialState: "readiness seam not ready, or current pin disagrees with loadCurrentCatalog",
    action: "GET /api/v2/catalog",
    expected: "503 SERVICE_UNAVAILABLE details.reason=catalog-not-ready with Retry-After; never an empty document",
    leftover: "no subject/definition body and no invented digest/fingerprint",
  }),
  freezeRow({
    id: 6,
    name: "release-header-and-cursor",
    initialState: "ready current snapshot and a Kernel continuation cursor",
    action: "successful list/detail read, including the opaque next cursor replay",
    expected: "X-WiseEff-Catalog-Release equals the snapshot release id; nextCursor is the Kernel cursor",
    leftover: "cursor is not decoded, re-encoded, or rebound to another query/release",
  }),
  freezeRow({
    id: 7,
    name: "no-revision-fallback",
    initialState: "getDefinitionRevision returns revision-unavailable while a selected revision exists",
    action: "GET the pinned revision route",
    expected: "404 definition-not-found; selected/current revision is not substituted",
    leftover: "getDefinitionById is not used to fill the missing revision",
  }),
  freezeRow({
    id: 8,
    name: "unregistered-and-usage-projection",
    initialState: "published subject/definition in the snapshot; registration and usage ports return projections",
    action: "GET subject and definition resources",
    expected: "registration/usage come from owning seams; Kernel membership/revision stay Platform truth",
    leftover: "no auto-registration and no legacy spec-identity fallback",
  }),
  freezeRow({
    id: 9,
    name: "pcat-api-01-ready-document",
    initialState: "verify-backed current pin and matching CurrentCatalogSnapshot",
    action: "GET /api/v2/catalog",
    expected: "status=ready, exact digest/fingerprint, release header, canonical subject/definition links",
    leftover: "mismatch remains 503 catalog-not-ready",
  }),
  freezeRow({
    id: 10,
    name: "pcat-api-02-subject-definition-reads",
    initialState: "opaque IDs, default active filters, unregistered projection, and trusted org scope",
    action: "list/detail subjects and definitions",
    expected: "deterministic Kernel pages, unregistered projection, and scope-hidden unknowns",
    leftover: "no handler-side membership rewrite",
  }),
  freezeRow({
    id: 11,
    name: "pcat-api-03-revision-timeline",
    initialState: "current or pinned snapshot with exact revisions and publication facts",
    action: "GET revision list/detail and definition timeline",
    expected: "exact revision and composed timeline; no current/latest substitute; no raw migration rows",
    leftover: "HTTP maps the composed page only",
  }),
]);

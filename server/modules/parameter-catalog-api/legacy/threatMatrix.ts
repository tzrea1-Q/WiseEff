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
    name: "exact-mapped-lookup",
    initialState:
      "authorized caller, frozen S7-MAP head with one operational target, captured catalog release pin",
    action: "GET /api/v2/catalog/legacy-identifiers/{allow-listed type}/{exact source id}",
    expected:
      "200 CatalogLegacyIdentifierResponse disposition=mapped, typed href, deprecation/sunset/successor headers",
    leftover: "mapping head unchanged; no Archive payload, candidates, or property-key match",
  }),
  freezeRow({
    id: 2,
    name: "archived-gone-no-payload",
    initialState: "frozen mapping head whose outcome is archived (S7-ARC metadata exists)",
    action: "exact authorized legacy lookup of that source id",
    expected: "410 GONE details.reason=legacy-id-archived; body has no archive id or plaintext",
    leftover: "restoreArchive is not invoked; encrypted object unread",
  }),
  freezeRow({
    id: 3,
    name: "blocked-or-ambiguous-conflict",
    initialState: "R0 blocked ledger or more than one authorized mapping head/disposition",
    action: "exact legacy lookup",
    expected: "409 CONFLICT details.reason=legacy-id-ambiguous; no candidate list",
    leftover: "no reclassification and no disclosed alternate targets",
  }),
  freezeRow({
    id: 4,
    name: "unknown-or-unauthorized-not-found",
    initialState: "missing identity, unmapped head, or org-scoped identity outside caller scope",
    action: "exact legacy lookup",
    expected: "404 NOT_FOUND; unknown and unauthorized are indistinguishable",
    leftover: "no owner-scope leak and no identity enumeration",
  }),
  freezeRow({
    id: 5,
    name: "inference-and-search-refused",
    initialState: "eligible spec list/detail with q, propertyKey, prefix, or non-allow-listed type",
    action: "lookup or eligible read using inferred/search keys",
    expected: "404 or 400; never a mapped target from similarity or search",
    leftover: "lookupProtectedIdentity is not called with a guessed source id",
  }),
  freezeRow({
    id: 6,
    name: "reverse-mapping-refused",
    initialState: "canonical target id presented as a legacy identifier or query key",
    action: "lookup by target kind/id or SELECT mapping versions by target_id",
    expected: "404; production sources contain no reverse target_id lookup",
    leftover: "no mapping row disclosed from the canonical side",
  }),
  freezeRow({
    id: 7,
    name: "raw-archive-refused",
    initialState: "archived or operational mapping head",
    action: "restoreArchive, persistArchive, or read parameter_catalog_archives / object bytes",
    expected: "production adapter never imports S7-ARC restore/persist; 410 archived has no payload",
    leftover: "ciphertext and archive metadata unread by this seam",
  }),
  freezeRow({
    id: 8,
    name: "structural-write-retired",
    initialState:
      "any parameterCatalogLegacyWriteRouteIds method/path, including If-Match, Idempotency-Key, and release headers",
    action: "POST/PATCH/DELETE/retired GET write or overlay/promotion",
    expected:
      "410 CatalogLegacyGoneResponse reason=legacy-surface-retired retryable=false successor=/api/v2/catalog",
    leftover: "no spec/module/overlay row written; replay of the same key is still 410",
  }),
  freezeRow({
    id: 9,
    name: "eligible-read-headers",
    initialState: "allow-listed bounded legacy GET (effective/default) with an exact source id when required",
    action: "eligible read adapter",
    expected:
      "200 with Deprecation, Sunset, Link rel=successor-version, Warning, X-WiseEff-Legacy-Contract; exact id is a typed redirect",
    leftover: "unbounded list does not reverse-enumerate mapping heads",
  }),
  freezeRow({
    id: 10,
    name: "governance-raw-retired",
    initialState: "legacy GET with view=governance, view=raw, or overlay-shaped read already in the write allow-list",
    action: "call the retired read shape",
    expected: "410 CatalogLegacyGoneResponse; no Effective/Governance dual body",
    leftover: "raw migration rows and overlay DTOs are not returned",
  }),
  freezeRow({
    id: 11,
    name: "spoof-and-agent-readonly",
    initialState: "trusted user/agent/system invocation; request also carries catalogForbiddenSpoofHeaders",
    action: "lookup and retired write with spoofed role/org/agent headers",
    expected:
      "authz from trusted invocation only; agent/system/user writes stay 410; spoof does not enlarge scope",
    leftover: "no self-asserted Organization or Agent identity honored",
  }),
  freezeRow({
    id: 12,
    name: "no-p12-p15-activation",
    initialState: "S8-LEG production TypeScript",
    action: "static scan and any attempt to execute cutover activation",
    expected:
      "no executeCutover/P12-P15 tokens as runnable API; consume lookupProtectedIdentity only",
    leftover: "no mapping append, no Kernel catalog DML, no dual write",
  }),
]);

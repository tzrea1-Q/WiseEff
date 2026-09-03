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
    name: "register-success",
    initialState:
      "open ReviewItem with matching ETag, captured pin, explicit PlacementIntent, and Org Admin trusted context",
    action: "resolveReviewItem register-subject through the coordinator",
    expected:
      "one ReviewResolutionResult and one Registration/Placement via writeGuardedRegistration",
    leftover: "one ReviewResolution, one Registration, one Placement, one success audit, item resolved",
  }),
  freezeRow({
    id: 2,
    name: "stale-etag",
    initialState: "open ReviewItem with a current ETag",
    action: "resolve with a non-matching If-Match ETag",
    expected: "typed revision-conflict refusal",
    leftover: "item remains open; zero Resolution/Registration/Placement/success-audit residue",
  }),
  freezeRow({
    id: 3,
    name: "concurrent-resolvers",
    initialState: "one open ReviewItem; two independent sessions resolve it at once",
    action: "two resolveReviewItem calls with matching ETags and distinct idempotency keys",
    expected: "one winner commits; loser typed revision-conflict; exactly one Resolution",
    leftover: "one Registration/Placement pair; loser transaction rolled back",
  }),
  freezeRow({
    id: 4,
    name: "lost-response-replay",
    initialState: "resolveReviewItem committed; caller lost the result",
    action: "replay the same idempotency key and request fingerprint",
    expected: "exact stored ReviewResolutionResult with outcome=replayed; guard not re-executed",
    leftover: "no second Resolution, Registration, Placement, or success audit",
  }),
  freezeRow({
    id: 5,
    name: "guard-pca-mapped",
    initialState: "open ReviewItem; writer/guard would emit PCA01-PCA05",
    action: "resolve through the coordinator so writeGuardedRegistration maps the SQLSTATE",
    expected: "durable typed refusal; coordinator transaction rolls back",
    leftover: "item remains open; zero Governance mutation residue; refusal audit survives rollback",
  }),
  freezeRow({
    id: 6,
    name: "retired-membership",
    initialState: "current Catalog membership of the chosen Subject is retired",
    action: "register-subject against the retired Subject",
    expected: "PCA03 mapped subject-retired refusal",
    leftover: "zero Resolution/Registration residue; ReviewItem stays open",
  }),
  freezeRow({
    id: 7,
    name: "catalog-isolation",
    initialState: "production TypeScript of S5-RSL",
    action: "static scan of production sources for Catalog structural DML/SELECT and a second guard",
    expected:
      "no Catalog structural-relation SELECT/INSERT; only writeGuardedRegistration; no second guard adapter",
    leftover: "no public repository, transaction, or unit-of-work types",
  }),
]);

export type ThreatMatrixId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type ThreatMatrixRow = {
  readonly id: ThreatMatrixId;
  readonly name: string;
  readonly attack: string;
  readonly expected: string;
  readonly evidenceOwner: "PG+HTTP";
};

const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "mock-runtime-rejected",
    attack: "captureCatalogApiEvidence with runtime.kind=mock or VITE_WISEEFF_RUNTIME_MODE=mock",
    expected: "typed refusal mock-runtime; no TypedEvidenceRef bundle is produced",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 2,
    name: "stale-pin-rejected",
    attack: "capture against a live catalog/database identity that does not equal plan.pins",
    expected: "typed refusal stale-pins; no bundle is produced",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 3,
    name: "missing-request-id-rejected",
    attack: "candidate HTTP response omits X-Request-Id and body.error.requestId, or echoes a different id",
    expected: "typed refusal missing-request-id; fail closed",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 4,
    name: "twelve-gates-same-candidate-pin",
    attack: "capture PCAT-API-01..12 on one candidate",
    expected: "exact bundle of 12 digest-verified refs sharing candidate, target, runtime, database, principal, and pin identity",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 5,
    name: "authorization-negatives-captured",
    attack: "unauthenticated, forbidden, agent-write, and spoofed role/org/agent headers against production handlers",
    expected: "each negative keeps a request id and does not adopt spoofed identity",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 6,
    name: "audit-refs-bound-to-request",
    attack: "governance mutation evidence without a persisted audit identity",
    expected: "mutation gates record audit event ids from PostgreSQL bound to the same request and pins",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 7,
    name: "never-starts-runtime-or-selects-gates",
    attack: "adapter listen/spawn of the product API, or caller-supplied gate list/waiver/skip",
    expected: "no listen/spawn in capture; typed refusal gate-selection-forbidden; applicability stays on the plan profile",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 8,
    name: "not-yet-executable-before-isolated",
    attack: "run API adapters on a pre-activation or post-retirement-runtime plan",
    expected: "status not-yet-executable with successor isolated-candidate-acceptance; no HTTP dispatch",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 9,
    name: "catalog-release-etag-deprecation-headers",
    attack: "ready catalog, governance write, and legacy write/read probes",
    expected: "evidence records X-WiseEff-Catalog-Release, ETag, and Deprecation/Sunset/Link when the producer emits them",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 10,
    name: "pcat-api-11-nine-kernel-routes",
    attack: "capture without all nine Kernel catalog GET routes",
    expected: "PCAT-API-11 evidence lists exactly the frozen nine routes driven through handleCatalogRead",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 11,
    name: "pcat-api-12-canonical-binding-identity",
    attack: "project binding HTTP still exposes parameterSpecId or omits definitionId/effectiveRevisionId/currentValueId",
    expected: "PCAT-API-12 stays in the bundle with request id; gate fails rather than skip when canonical identity is unproven",
    evidenceOwner: "PG+HTTP",
  },
  {
    id: 12,
    name: "production-handlers-not-reimplemented",
    attack: "evidence adapter reimplements catalog HTTP or S10-PER prepare/run/assemble/approve/readReport",
    expected: "production sources only dispatch frozen S8 handlers and consume TypedEvidenceRef/pins",
    evidenceOwner: "PG+HTTP",
  },
] as const satisfies readonly ThreatMatrixRow[]);

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
    initialState: "current Catalog pin installed; Organization taxonomy destination present; no Registration",
    action: "register with captured Kernel pin, trusted context, PlacementIntent, proof, and idempotency fingerprint",
    expected: "one Registration and exactly one Placement; outcome=committed",
    leftover: "one registration row, one placement row, one committed idempotency row",
  }),
  freezeRow({
    id: 2,
    name: "catalog-isolation",
    initialState: "production TypeScript of S4-REG",
    action: "static scan of production sources for Catalog structural DML/SELECT",
    expected: "only scalar parameter_catalog.assert_catalog_subject_active($1,$2,$3,$4) after idempotency lookup",
    leftover: "no Catalog structural-relation SELECT or INSERT from Governance production TypeScript",
  }),
  freezeRow({
    id: 3,
    name: "double-placement",
    initialState: "one committed Registration with its retained Placement",
    action: "second Placement for the same Registration or a conflicting destination",
    expected: "typed placement-conflict refusal",
    leftover: "original Registration and Placement unchanged; no second placement row",
  }),
  freezeRow({
    id: 4,
    name: "stale-pin",
    initialState: "current pointer advanced past the captured pin",
    action: "register with the stale Kernel pin",
    expected: "PCA01 mapped release-drift failure",
    leftover: "zero Registration, Placement, and idempotency residue",
  }),
  freezeRow({
    id: 5,
    name: "retired-membership",
    initialState: "current release membership of the Subject is retired",
    action: "register the retired Subject against the current pin",
    expected: "PCA03 mapped subject-retired failure",
    leftover: "zero Registration residue",
  }),
  freezeRow({
    id: 6,
    name: "shared-vs-exclusive",
    initialState: "installer holds exclusive lock 688004000041, or governance holds the shared guard",
    action: "register through the shared guard while the exclusive pointer lock is contended",
    expected: "PCA05 synchronization-busy or wait-until-end; never a torn write",
    leftover: "holder state unchanged; waiter wrote no Registration/Placement",
  }),
  freezeRow({
    id: 7,
    name: "lost-response-replay",
    initialState: "register committed; caller lost the result",
    action: "replay the same idempotency key and request fingerprint",
    expected: "exact stored result with outcome=replayed; guard not required for the replay path",
    leftover: "no second Placement or Registration",
  }),
  freezeRow({
    id: 8,
    name: "auto-restore-forbidden",
    initialState: "Organization Registration is retired; Catalog membership remains active",
    action: "automatic register of the same Organization/Subject",
    expected: "typed auto-restore-forbidden refusal",
    leftover: "retired Registration and original Placement retained",
  }),
  freezeRow({
    id: 9,
    name: "writer-rollback",
    initialState: "writer transaction inserts Registration/Placement then aborts",
    action: "rollback the Governance unit of work",
    leftover: "zero Registration, Placement, and idempotency residue",
    expected: "injected failure surfaces; COMMIT never succeeds",
  }),
  freezeRow({
    id: 10,
    name: "fingerprint-conflict",
    initialState: "committed idempotency row for the key",
    action: "reuse the key with a different request fingerprint",
    expected: "revision-conflict; stored result unchanged",
    leftover: "original Registration/Placement/idempotency bytes retained",
  }),
]);

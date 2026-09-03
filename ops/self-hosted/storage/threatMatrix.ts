const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "quiesced-exact-target-capture",
    attack:
      "captureRecoveryPoint against a quiesced exact target with PostgreSQL, object-store, and Redis adapters",
    expected:
      "one three-store manifest, per-store checksums, verification result, and a run-bound restore token",
    evidenceOwner: "L+PG",
  },
  {
    id: 2,
    name: "pre-quiesce-capture-refused",
    attack: "captureRecoveryPoint before writers, queue, and proxy are proved quiesced",
    expected: "typed pre-quiesce refusal; no restore token is minted",
    evidenceOwner: "L+PG",
  },
  {
    id: 3,
    name: "partial-store-fail-closed",
    attack:
      "captureRecoveryPoint with PostgreSQL without object-store, object-store without Redis, or any missing store",
    expected: "typed partial-store refusal; fail closed with no restore token",
    evidenceOwner: "L+PG",
  },
  {
    id: 4,
    name: "stale-boundary-or-checksum-drift",
    attack:
      "verifyRecoveryPoint or restoreCheck after the plan maximum age elapses, or after a store checksum changes",
    expected: "typed stale-boundary or checksum-drift rejection",
    evidenceOwner: "L+PG",
  },
  {
    id: 5,
    name: "wrong-target-identity",
    attack:
      "capture against a mismatched store identity, snapshot the default compose 5432/wiseeff database without an explicit test-database allow, or restore-check into that compose database",
    expected:
      "typed wrong-target rejection; no restore token is minted; restore into 5432/wiseeff remains forbidden",
    evidenceOwner: "L+PG",
  },
  {
    id: 6,
    name: "restore-check-token-failure",
    attack: "restoreCheck with no token, or with a restore token minted for a different run",
    expected: "typed token-failure; stores are not mutated",
    evidenceOwner: "L+PG",
  },
  {
    id: 7,
    name: "consume-s10-per-types-without-reimplementing-gates",
    attack:
      "pin capture output onto prepareVerification recovery fields and scan production sources for S10-PER operations",
    expected:
      "recoveryPointId and recoveryPointDigest are assignable to S10-PER pins; prepareVerification and readReport are not reimplemented",
    evidenceOwner: "L",
  },
] as const);

export type ThreatMatrixRow = (typeof THREAT_MATRIX)[number];
export type ThreatMatrixId = ThreatMatrixRow["id"];

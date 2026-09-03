const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "prepare-success-pins-purpose-and-lineage",
    attack: "prepareVerification with a closed purpose, subject, and typed evidence requirements",
    expected:
      "immutable plan pins purpose and lineage from the registry; callers do not supply a gate list",
    evidenceOwner: "L+PG",
  },
  {
    id: 2,
    name: "prepare-refuses-caller-waiver-or-gate-list",
    attack: "prepareVerification with a caller-supplied waiver or gate list",
    expected: "typed refusal; no plan row is stored",
    evidenceOwner: "L+PG",
  },
  {
    id: 3,
    name: "run-missing-applicable-gate-never-waived",
    attack: "runVerification when an applicable required-now gate has no executable adapter",
    expected: "gate result is not-yet-executable or failed; never skipped-as-waived",
    evidenceOwner: "L+PG",
  },
  {
    id: 4,
    name: "assemble-incomplete-attempt-refuses-half-report",
    attack: "assembleReport from an attempt that does not cover the purpose profile",
    expected: "typed refusal; no half-report row is stored",
    evidenceOwner: "L+PG",
  },
  {
    id: 5,
    name: "approve-wrong-principal-or-purpose-refused",
    attack: "approveReport by a verifier, a reused principal, or a mismatched purpose",
    expected: "typed refusal; report bytes stay unchanged",
    evidenceOwner: "L+PG",
  },
  {
    id: 6,
    name: "second-approve-append-only-conflict",
    attack: "second approve that would mutate stored report bytes, or duplicate the same principal kind",
    expected: "append-only conflict; original report bytes unchanged",
    evidenceOwner: "L+PG",
  },
  {
    id: 7,
    name: "read-report-missing-or-unapproved-tagged-absence",
    attack: "readReport of a missing digest or an unapproved purpose-gated report",
    expected: "tagged absence; never a mutable stub report",
    evidenceOwner: "L+PG",
  },
  {
    id: 8,
    name: "concurrent-prepare-or-run-same-purpose-conflict",
    attack: "concurrent prepareVerification or runVerification for the same purpose and pins",
    expected: "one winner; the other returns concurrent-conflict",
    evidenceOwner: "PG",
  },
  {
    id: 9,
    name: "migration-apply-and-rollback-on-fresh-pgvector",
    attack: "apply the verification-core migration on fresh pgvector, then roll the transaction back",
    expected: "apply creates verification relations; rollback leaves zero verification relations",
    evidenceOwner: "PG",
  },
  {
    id: 10,
    name: "sql-omits-legacy-identity-token",
    attack: "scan the allocated verification-core migration SQL for a forbidden identity token",
    expected: "SQL bytes do not contain the composed legacy identity token",
    evidenceOwner: "L",
  },
] as const);

export type ThreatMatrixRow = (typeof THREAT_MATRIX)[number];
export type ThreatMatrixId = ThreatMatrixRow["id"];

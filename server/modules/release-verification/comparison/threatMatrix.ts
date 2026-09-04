const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "missing-family-registration",
    attack: "register or aggregate with fewer than the eleven required family providers",
    expected: "typed refusal PCAT-CMP-MISSING-FAMILY before comparison; no corpus or report bytes",
    evidenceOwner: "L",
  },
  {
    id: 2,
    name: "duplicate-family-registration",
    attack: "register or aggregate with the same family more than once",
    expected: "typed refusal PCAT-CMP-DUPLICATE-FAMILY before comparison; no corpus or report bytes",
    evidenceOwner: "L",
  },
  {
    id: 3,
    name: "unknown-family-or-comparison-id",
    attack: "register an unknown family or ingest a case whose comparisonId is outside D01-D09 or the family mapping",
    expected:
      "typed refusal PCAT-CMP-UNKNOWN-FAMILY or PCAT-CMP-UNKNOWN-COMPARISON-ID; no corpus or report bytes",
    evidenceOwner: "L",
  },
  {
    id: 4,
    name: "checksum-or-canonical-order-drift",
    attack: "alter contribution checksum bytes or reorder cases away from family/comparisonId/kind/id/caseId order",
    expected: "typed refusal PCAT-CMP-CHECKSUM-INVALID or PCAT-CMP-ORDER-DRIFT; no passing report",
    evidenceOwner: "L",
  },
  {
    id: 5,
    name: "sampled-populated-inventory",
    attack: "submit a populated contribution whose unique protected references are fewer than sourceInventoryCount",
    expected: "typed refusal PCAT-CMP-SAMPLED-POPULATED; sampling is never accepted as corpus input",
    evidenceOwner: "L+PG",
  },
  {
    id: 6,
    name: "reused-pre-activation-after-p13",
    attack: "reuse pre-activation contribution bytes, corpus checksum, family checksums, or report checksum as post-p13",
    expected: "typed refusal PCAT-CMP-PHASE-REUSE; post-p13 attempt must be independently bound",
    evidenceOwner: "L+PG",
  },
  {
    id: 7,
    name: "fresh-phase-without-real-postgres-zero-inventory",
    attack: "claim inventoryMode=fresh without a successful real-PostgreSQL query proving zero inventory and zero cases",
    expected:
      "fresh pre-activation and fresh post-p13 each query an independent real database; skipped, mocked, or non-zero inventory is not zero",
    evidenceOwner: "PG",
  },
  {
    id: 8,
    name: "unexplained-or-unqueryable-nonzero",
    attack: "emit unexplained-difference or unqueryable/protected-reference-missing on the aggregated green path",
    expected:
      "typed refusal PCAT-CMP-UNEXPLAINED-DIFFERENCE or PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE; both counts must be zero",
    evidenceOwner: "L+PG",
  },
] as const);

export type ThreatMatrixRow = (typeof THREAT_MATRIX)[number];
export type ThreatMatrixId = ThreatMatrixRow["id"];

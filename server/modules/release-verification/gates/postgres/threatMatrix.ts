const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "v01-false-zero-duplicate-current-definition",
    attack:
      "runVerification after two current-release Definitions share (subject_id, property_key)",
    expected:
      "PCAT-DB-V01 fails with PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION and duplicate group count 1, never 0",
    evidenceOwner: "PG",
  },
  {
    id: 2,
    name: "run-never-skipped-or-waived",
    attack: "runVerification for a closed purpose with postgres V/M/P adapters registered",
    expected: "every V/M/P result is passed or failed with a stable failure ID; never skipped or waived",
    evidenceOwner: "PG",
  },
  {
    id: 3,
    name: "p01-sqlstate-catalog-immutability",
    attack: "production roles attempt INSERT/UPDATE/DELETE on immutable Catalog rows or SET ROLE to writers",
    expected: "each forbidden statement fails with SQLSTATE 42501; a successful write fails PCAT-DB-P01",
    evidenceOwner: "PG",
  },
  {
    id: 4,
    name: "p02-sqlstate-legacy-writer",
    attack: "production roles attempt legacy structural writes or SECURITY DEFINER writer functions",
    expected: "each forbidden statement fails with SQLSTATE 42501; a successful write fails PCAT-DB-P02",
    evidenceOwner: "PG",
  },
  {
    id: 5,
    name: "gate-does-not-repair",
    attack: "runVerification against injected Catalog or migration inventory violations",
    expected: "violating rows remain; adapters issue no INSERT/UPDATE/DELETE outside rolled-back privilege probes",
    evidenceOwner: "PG",
  },
  {
    id: 6,
    name: "v17-mode-result-mismatch",
    attack: "fresh-mode plan with a non-zero Registration, or a migration digest that does not match the packaged inventory",
    expected: "PCAT-DB-V17 fails with PCAT-VRF-V17-MODE-RESULT-MISMATCH and exact counts, never a skip",
    evidenceOwner: "PG",
  },
  {
    id: 7,
    name: "m01-package-inventory-drift",
    attack: "prepareVerification pins a migration inventory digest that is not the packaged filename/checksum digest",
    expected: "PCAT-DB-M01 fails with PCAT-MIG-PACKAGE-INVENTORY-DRIFT",
    evidenceOwner: "PG",
  },
  {
    id: 8,
    name: "m02-applied-file-missing",
    attack: "schema_migrations contains an applied name that is not a packaged file or historical alias",
    expected: "PCAT-DB-M02 fails with PCAT-MIG-APPLIED-FILE-MISSING and missing count 1",
    evidenceOwner: "PG",
  },
  {
    id: 9,
    name: "missing-cutover-producer-does-not-skip",
    attack:
      "runVerification on a migrated database with empty mapping/Archive/ledger tables while S7-ORC is unresolved",
    expected:
      "V08-V11, V14, and V09 record exact zero counts as passed or fail on pin mismatch; they are never skipped",
    evidenceOwner: "PG",
  },
  {
    id: 10,
    name: "v12-materialization-pin-mismatch",
    attack: "plan catalog pins name a release that is not the current materialization",
    expected: "PCAT-DB-V12 fails with PCAT-VRF-V12-CATALOG-MATERIALIZATION-DRIFT",
    evidenceOwner: "PG",
  },
  {
    id: 11,
    name: "privilege-grant-bypass-detected",
    attack: "GRANT INSERT on an immutable Catalog relation to parameter_governance_writer_role, then run P01",
    expected: "PCAT-DB-P01 fails with PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS after the probe write is rolled back",
    evidenceOwner: "PG",
  },
  {
    id: 12,
    name: "production-source-omits-legacy-identity-token",
    attack: "scan postgres gate production TypeScript for the composed legacy identity token",
    expected: "production source bytes do not contain the forbidden substring",
    evidenceOwner: "L",
  },
] as const);

export type ThreatMatrixRow = (typeof THREAT_MATRIX)[number];
export type ThreatMatrixId = ThreatMatrixRow["id"];

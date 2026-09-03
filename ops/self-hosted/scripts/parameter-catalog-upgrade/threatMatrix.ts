const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "legal-journal-transition-idempotent",
    attack: "replay a legal journal transition with the same action and input digest",
    expected: "the committed journal snapshot is unchanged and the controller reports a replayed success",
    evidenceOwner: "L",
  },
  {
    id: 2,
    name: "illegal-action-journal-unchanged",
    attack: "dispatch an action that is not legal in the current controller state",
    expected: "typed illegal-action refusal; journal bytes are unchanged",
    evidenceOwner: "L",
  },
  {
    id: 3,
    name: "crash-resume-same-journal",
    attack: "crash during execute, open the same journal path, then resume the same run",
    expected: "resume continues the same run identity and appends to the same journal lineage",
    evidenceOwner: "L",
  },
  {
    id: 4,
    name: "cannot-select-verification-gates",
    attack: "prepareVerification or runVerification with a caller-supplied gate list, waiver, or gateSelection",
    expected: "PCAT-UPG-GATE-SELECTION-FORBIDDEN; verification ports are not called; journal unchanged",
    evidenceOwner: "L",
  },
  {
    id: 5,
    name: "cannot-guess-or-migrate-via-api",
    attack: "dispatch API startup migration or guess an unknown commit outcome",
    expected: "PCAT-UPG-API-MIGRATE-FORBIDDEN or PCAT-UPG-UNKNOWN-OUTCOME; journal unchanged",
    evidenceOwner: "L",
  },
  {
    id: 6,
    name: "consume-s7-orc-and-s10-per-types",
    attack:
      "scan production sources for S7-ORC plan/execute/inspect/recover and S10-PER prepare/run types",
    expected:
      "ports consume frozen Cutover and Verification types; plan/execute/inspect/recover and prepare/run are not reimplemented",
    evidenceOwner: "L",
  },
  {
    id: 7,
    name: "no-catalog-releases-writer-dml",
    attack: "scan production sources for catalog_releases writer DML and banned relation literals",
    expected: "no catalog_releases insert/update/delete; banned relation tokens only via join-split in tests",
    evidenceOwner: "L",
  },
] as const);

export type ThreatMatrixRow = (typeof THREAT_MATRIX)[number];
export type ThreatMatrixId = ThreatMatrixRow["id"];

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
    name: "planned-p0-p10-checkpoints",
    initialState:
      "populated PG; frozen Kernel+Governance+Binding+classifier+mapping+Archive types; no activation",
    action: "plan then execute-or-resume P0-P10 on the public cutover seam",
    expected: "immutable plan digest and P0-P10 checkpoints committed in order",
    leftover: "activation P11-P16 unavailable; internal repositories stay private",
  }),
  freezeRow({
    id: 2,
    name: "duplicate-plan-execute-resume",
    initialState: "same source fingerprint, target artifact, release digest, and plan digest",
    action: "duplicate planCutover and executeCutover",
    expected: "same-plan resume; no second live run row",
    leftover: "one cutover run tuple; checkpoints are not duplicated",
  }),
  freezeRow({
    id: 3,
    name: "unknown-or-adhoc-phase",
    initialState: "planned or running pre-activation cutover",
    action: "unknown phase, ad-hoc SQL recovery, or P12-P15 activation",
    expected: "typed refusal (unknown-phase / ad-hoc / activation-unavailable)",
    leftover: "no ad-hoc mutation; current checkpoint unchanged",
  }),
  freezeRow({
    id: 4,
    name: "rollback-dump-equality",
    initialState: "P3 recovery-point dump captured before P4-P10 mutations",
    action: "recoverCutover whole-state-restore with the run-bound token",
    expected: "rollback dump equals the pre-execute / P3 dump",
    leftover: "source inventory dump matches P3; run invalidated; append-only journal retained",
  }),
  freezeRow({
    id: 5,
    name: "crash-mid-phase-resume",
    initialState: "execute in flight before a later pre-activation phase checkpoint",
    action: "crash, inspectCutover, then execute-or-resume the same plan",
    expected: "inspect shows the exact last checkpoint; resume continues the same plan",
    leftover: "no new plan digest or second live run",
  }),
  freezeRow({
    id: 6,
    name: "populated-catalog-required",
    initialState: "empty public inventory or empty mapping/Archive after a claimed P0-P10",
    action: "plan/execute against zero inventory, or inspect a run with empty producer residue",
    expected: "typed not-populated refusal; empty mapping/Archive is not P0-P10 evidence",
    leftover: "no completed P0-P10 run on an empty catalog",
  }),
  freezeRow({
    id: 7,
    name: "frozen-producer-types-no-release-writer",
    initialState: "S7-ORC production TypeScript",
    action: "static scan of owned production sources",
    expected:
      "consume frozen classifier/mapping/archive/install/governance types; Kernel install owns Catalog Release writes",
    leftover: "no catalog_releases writer DML; banned relation tokens only via join-split",
  }),
]);

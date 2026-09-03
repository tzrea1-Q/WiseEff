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
    name: "stabilize-success",
    initialState:
      "frozen Kernel snapshot; active Registration; exact DefinitionRevision; owner; project; logical-node identity",
    action: "stabilize the composite Binding agreement",
    expected: "one Binding with a stable ID; outcome=committed",
    leftover: "one canonical Binding row; identity columns agree; no module_id identity column",
  }),
  freezeRow({
    id: 2,
    name: "module-latest-disagreement",
    initialState: "frozen snapshot whose selected revision is not the latest current head, or a legacy module-only identity",
    action: "stabilize using module identity or a latest-head revision that disagrees with the frozen snapshot",
    expected: "typed agreement-conflict; no Binding",
    leftover: "zero canonical Binding residue for the refused composite",
  }),
  freezeRow({
    id: 3,
    name: "cross-owner-race",
    initialState: "two independent sessions targeting the same project/logical-node/definition composite",
    action: "stabilize concurrently as two owners or as the same owner twice",
    expected: "one winner or both refuse; never mixed owner columns",
    leftover: "at most one Binding row; organization/registration/subject agree with the winner",
  }),
  freezeRow({
    id: 4,
    name: "cas-mismatch",
    initialState: "Binding exists with an effective revision",
    action: "cut over with a stale expectedEffectiveRevisionId",
    expected: "typed cas-mismatch; no silent overwrite",
    leftover: "stored effective revision and catalog release unchanged",
  }),
  freezeRow({
    id: 5,
    name: "legacy-migration-adapter",
    initialState: "one legacy binding identity plus captured snapshot and active Registration proof",
    action: "map through the private legacy-to-canonical adapter",
    expected: "canonical Binding preserving the stable ID, or typed refusal; no Catalog structural writes",
    leftover: "Catalog release/subject/definition counts unchanged by the adapter",
  }),
  freezeRow({
    id: 6,
    name: "composite-replay",
    initialState: "composite agreement already committed",
    action: "replay the same snapshot+registration+revision+owner+project+node agreement",
    expected: "same Binding ID; outcome=replayed",
    leftover: "no second Binding row",
  }),
  freezeRow({
    id: 7,
    name: "catalog-isolation",
    initialState: "production TypeScript of S6-BND",
    action: "static scan of production sources for Catalog structural DML/SELECT and latest-head inference",
    expected: "consume Kernel snapshot types only; never SELECT or INSERT Catalog release rows as a writer",
    leftover: "only Binding, placeholder value, and Registration-read identifiers",
  }),
]);

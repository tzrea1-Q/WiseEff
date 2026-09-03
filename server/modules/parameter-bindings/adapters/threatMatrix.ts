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
    name: "success-read",
    initialState:
      "matching Binding, current ProjectValue, and exact DefinitionRevision from frozen Binding plus immutable history",
    action: "read the protected-reference adapter",
    expected: "exact canonical pin DTO; no legacy identity on the pin",
    leftover: "Binding current tip and history bytes unchanged",
  }),
  freezeRow({
    id: 2,
    name: "success-writeback",
    initialState: "matching source identity, expected current tip, and payload against a stable Binding",
    action: "write back through S6-VAL append/CAS",
    expected: "typed writeback result with the new exact canonical pin",
    leftover: "one appended ProjectValue; Binding current tip equals the new id",
  }),
  freezeRow({
    id: 3,
    name: "parameter-spec-id-fallback-refused",
    initialState: "any read or writeback command that carries a legacy spec identity",
    action: "accept or return a legacy spec-identity fallback pin",
    expected: "typed block; no canonical pin",
    leftover: "no Binding or ProjectValue mutation from the refused command",
  }),
  freezeRow({
    id: 4,
    name: "missing-binding-or-current-value",
    initialState: "command Binding is absent, or Binding.currentValueId is absent from immutable history",
    action: "read or write back a protected reference",
    expected: "typed block; no pin",
    leftover: "no invented identity and no store write",
  }),
  freezeRow({
    id: 5,
    name: "revision-disagreement",
    initialState: "requested DefinitionRevision or current value revision disagrees with Binding.effectiveRevisionId",
    action: "read or write back using the disagreeing revision",
    expected: "typed block; no latest-head substitution",
    leftover: "stored effective revision and current tip unchanged",
  }),
  freezeRow({
    id: 6,
    name: "cas-source-conflict",
    initialState: "S6-VAL would refuse the append for a stale expected tip or disagreeing source",
    action: "write back through the protected adapter",
    expected: "typed block; no mixed pin",
    leftover: "stored current tip unchanged; no extra success history row",
  }),
  freezeRow({
    id: 7,
    name: "catalog-isolation",
    initialState: "production TypeScript of S6-WFA",
    action: "static scan of production sources for Catalog structural DML/SELECT and legacy spec fallback",
    expected:
      "consume Binding and ProjectValue public types only; never SELECT or INSERT Catalog release rows as a writer",
    leftover: "only protected-reference DTO, typed read/writeback results, and public S6-VAL calls",
  }),
]);

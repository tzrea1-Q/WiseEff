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
    name: "append-success",
    initialState:
      "stable Binding with identity-placeholder current tip; exact DefinitionRevision; source identity; value payload; expected tip",
    action: "append a ProjectValue and CAS the explicit current tip",
    expected: "one immutable ProjectValue; CAS-advanced current tip; outcome=committed",
    leftover: "one value row; Binding.current_value_id equals the new id; one binding_history_events row with success_audit_ref",
  }),
  freezeRow({
    id: 2,
    name: "stale-tip-lost-update",
    initialState: "Binding current tip already advanced; a later wall-clock writer still holds the stale expected tip",
    action: "append with a newer payload timestamp but the stale expected tip",
    expected: "typed cas-mismatch; clock/max-time last-write-wins is forbidden",
    leftover: "stored current tip unchanged; no new value row; no success audit",
  }),
  freezeRow({
    id: 3,
    name: "in-place-mutation-refused",
    initialState: "an existing ProjectValue row",
    action: "UPDATE or DELETE the existing ProjectValue row",
    expected: "typed immutable-value failure",
    leftover: "original value bytes remain; placeholder row is not mutated in place",
  }),
  freezeRow({
    id: 4,
    name: "history-completeness",
    initialState: "several committed appends for one Binding and exact DefinitionRevision",
    action: "read complete ordered history",
    expected: "every committed append is visible in order; no gaps or rewritten rows",
    leftover: "history length equals placeholder plus committed appends for that revision",
  }),
  freezeRow({
    id: 5,
    name: "cas-race",
    initialState: "two independent sessions share the same expected tip and different payloads",
    action: "append concurrently",
    expected: "one committed winner and one typed cas-mismatch; never mixed tips",
    leftover: "exactly one current tip; loser wrote no value row and no success audit",
  }),
  freezeRow({
    id: 6,
    name: "source-ownership",
    initialState: "Binding already owns a real source identity, or the expected tip belongs to another Binding",
    action: "append with a disagreeing source_ref or a cross-binding expected tip",
    expected: "typed source-conflict; no mixed owner history",
    leftover: "original Binding values unchanged; no extra history row",
  }),
  freezeRow({
    id: 7,
    name: "audit-continuity",
    initialState: "Binding ready for a tip change, or a stale expected tip",
    action: "commit a tip change, then retry a failed CAS",
    expected:
      "successful tip change appends binding_history_events with old/new current value ids and success_audit_ref; failed CAS writes no value row and no success audit",
    leftover: "history event count equals successful tip changes only",
  }),
  freezeRow({
    id: 8,
    name: "replay",
    initialState: "same payload and expected tip already committed",
    action: "replay the append command",
    expected: "same ProjectValue id; outcome=replayed; no second history row",
    leftover: "value count and history count unchanged",
  }),
  freezeRow({
    id: 9,
    name: "catalog-isolation",
    initialState: "production TypeScript of S6-VAL",
    action: "static scan of production sources for Catalog structural DML/SELECT and in-place value mutation",
    expected:
      "consume frozen Binding and Kernel snapshot types only; never SELECT or INSERT Catalog release rows as a writer; never UPDATE/DELETE ProjectValue rows",
    leftover: "only Binding, ProjectValue, history-event, and success-audit identifiers",
  }),
]);

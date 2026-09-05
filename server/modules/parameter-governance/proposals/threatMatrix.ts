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
    name: "submit-success",
    initialState:
      "current Catalog pin installed; captured base Definition revision; trusted Org Admin proposer",
    action: "submit a DefinitionProposal with the captured base revision and idempotency fingerprint",
    expected: "one submitted proposal with immutable revision 1; outcome=committed",
    leftover: "one proposal row, one revision row, one committed idempotency row; zero publication intents; zero Catalog structural writes",
  }),
  freezeRow({
    id: 2,
    name: "withdraw-proposer-only",
    initialState: "submitted proposal owned by the Org Admin proposer",
    action: "withdraw as Platform Admin reviewer, then withdraw as the proposer",
    expected: "reviewer is permission-denied; proposer withdraws to withdrawn",
    leftover: "no publication intent; proposal remains proposer-owned; reviewer withdraw writes no status change",
  }),
  freezeRow({
    id: 3,
    name: "distinct-reviewer-accept",
    initialState: "submitted proposal authored by an Org Admin",
    action: "accept as the same principal, then accept as a distinct Platform Admin",
    expected: "self-accept is proposal-self-approval-forbidden; distinct reviewer commits publication intent",
    leftover: "self-accept leaves submitted status and zero intents; distinct accept appends one intent and trusted success audit",
  }),
  freezeRow({
    id: 4,
    name: "stale-base",
    initialState: "captured base release/revision is behind the current Catalog pin",
    action: "submit or accept using the stale captured base",
    expected: "typed proposal-stale refusal",
    leftover: "zero new proposal/intent rows for the refused command; durable refusal audit survives",
  }),
  freezeRow({
    id: 5,
    name: "catalog-isolation",
    initialState: "production TypeScript of S5-PRP",
    action: "static scan of production sources for Catalog structural DML/SELECT and Catalog writer imports",
    expected: "no Catalog structural relation writes or queries; no Kernel installer; no review-resolution writer",
    leftover: "only proposal, proposal-revision, publication-intent, idempotency, and audit identifiers",
  }),
  freezeRow({
    id: 6,
    name: "intent-only-publication",
    initialState: "submitted proposal; captured base still current",
    action: "accept by a distinct Platform Admin with a repository publication reference",
    expected: "append-only catalog_publication_intents row plus trusted audit; Catalog current pointer and release counts unchanged",
    leftover: "exactly one intent for the proposal; no installed release; no Catalog subject/definition rows added",
  }),
  freezeRow({
    id: 7,
    name: "lost-response-replay",
    initialState: "submit committed; caller lost the result",
    action: "replay the same idempotency key and request fingerprint",
    expected: "exact stored proposal and revision 1 with outcome=replayed",
    leftover: "no second proposal or revision row",
  }),
  freezeRow({
    id: 8,
    name: "create-draft-then-submit-existing",
    initialState: "no Proposal; captured Catalog pin and Definition revision",
    action: "create-draft then submit-existing of the same proposalId",
    expected: "one draft then the same identity submitted; no second Proposal",
    leftover: "one proposal row, one revision row; ETag advanced; no publication intent",
  }),
  freezeRow({
    id: 9,
    name: "submit-existing-not-create-and-submit",
    initialState: "internal kind:submit adapter still used by existing callers",
    action: "compare submit-existing against kind:submit create-and-submit",
    expected: "submit-existing never inserts a Proposal; adapter remains one-transaction create-and-submit",
    leftover: "HTTP /proposals/:id/submit must not use the adapter",
  }),
]);

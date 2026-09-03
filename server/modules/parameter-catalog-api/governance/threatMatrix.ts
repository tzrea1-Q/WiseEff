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
    name: "tx-handle",
    initialState: "frozen S8-CON governance request and public S4-REG/S4-REV/S5-RSL/S5-PRP commands",
    action: "dispatch any canonical Registration, Placement, Review, resolution, or Proposal route",
    expected: "HTTP maps headers and body, then invokes one public domain command; no handler BEGIN/COMMIT",
    leftover: "no handler-owned unit of work, savepoint, or advisory lock",
  }),
  freezeRow({
    id: 2,
    name: "multiwriter",
    initialState: "one HTTP governance write that would need Registration plus Placement plus audit",
    action: "POST/PATCH a governance write route",
    expected: "exactly one public command call; that command owns the atomic write set",
    leftover: "no second writer, no private repository, no dual Registration/Placement HTTP writes",
  }),
  freezeRow({
    id: 3,
    name: "spoof-principal",
    initialState: "trusted invocation plus catalogForbiddenSpoofHeaders for role, org, actor, or agent",
    action: "read or write a governance route with spoofed identity headers",
    expected: "spoof headers stripped; authz from trusted principal only; Agent stays read-only",
    leftover: "no self-asserted Organization, role, or Agent identity honored",
  }),
  freezeRow({
    id: 4,
    name: "partial-write",
    initialState: "public command would insert Registration then fail before Placement or audit",
    action: "governance write through the HTTP handler",
    expected: "typed failure; HTTP does not compensate or finish the leftover write",
    leftover: "zero handler-created rows; domain rollback is the only mutation boundary",
  }),
  freezeRow({
    id: 5,
    name: "missing-etag-idempotency",
    initialState: "authenticated Org Admin, current release pin, otherwise valid write body",
    action: "omit If-Match where required or omit Idempotency-Key on a governance write",
    expected: "409 CONFLICT details.reason=revision-conflict; domain command is not invoked",
    leftover: "no Registration, Placement, Review resolution, Proposal, or audit row from the refused request",
  }),
  freezeRow({
    id: 6,
    name: "private-s4-reg-import",
    initialState: "production TypeScript of S8-GOV",
    action: "static scan for internalGuardedRegistrationWriter and other private S4-REG writer/UoW imports",
    expected: "only public command types and injected public command ports",
    leftover: "no private S4-REG writer, no review-resolution UoW, no proposal writer SQL",
  }),
  freezeRow({
    id: 7,
    name: "pcat-api-04-registration-placement",
    initialState: "trusted Org Admin, current pin, explicit PlacementIntent, Idempotency-Key",
    action: "list/get/create/retire/restore Registration and get/update Placement",
    expected: "one executeRegistration or registration query command; ETag and release headers on success",
    leftover: "Agent and Platform Admin cannot mutate Organization structure",
  }),
  freezeRow({
    id: 8,
    name: "pcat-api-05-review-observation",
    initialState: "trusted Org Admin, captured pin, open Review Item ETag",
    action: "list/get observations and review items; POST resolve with If-Match and Idempotency-Key",
    expected: "one listReviewQueue, getReviewItem, observation query, or resolveReviewItem command",
    leftover: "unknown/ambiguous outcomes preserved; no partial resolution write from HTTP",
  }),
  freezeRow({
    id: 9,
    name: "pcat-api-06-proposal",
    initialState: "Org Admin proposer and a distinct Platform Admin reviewer",
    action: "create/submit/withdraw/accept/reject DefinitionProposal",
    expected: "one executeProposal command per route; self-accept maps proposal-self-approval-forbidden",
    leftover: "acceptance records publication intent only; no Catalog structural write from HTTP",
  }),
  freezeRow({
    id: 10,
    name: "pcat-api-07-not-legacy-lookup",
    initialState: "S8-GOV production route table built from PCAT-API-04..06",
    action: "match GET /api/v2/catalog/legacy-identifiers/:legacyType/:legacyId",
    expected: "unmatched; S8-GOV does not own PCAT-API-07 runtime lookup",
    leftover: "no S7-MAP/S7-ARC import and no property-key inference",
  }),
]);

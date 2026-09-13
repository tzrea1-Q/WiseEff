export type ThreatMatrixRow = {
  readonly id: string;
  readonly name: string;
  readonly initialState: string;
  readonly action: string;
  readonly expected: string;
  readonly leftover: string;
};

const freezeRow = (row: ThreatMatrixRow): ThreatMatrixRow => Object.freeze(row);

export const THREAT_MATRIX: readonly ThreatMatrixRow[] = Object.freeze([
  freezeRow({
    id: "T04.a",
    name: "idempotent-replay",
    initialState: "no job",
    action: "publish twice same scope+key+digest",
    expected: "one job, second returns same id",
    leftover: "no second authorization or Catalog write from HTTP",
  }),
  freezeRow({
    id: "T04.b",
    name: "idempotency-key-conflict",
    initialState: "job exists",
    action: "same key different request fields",
    expected: "409 idempotency-key-conflict; no second job",
    leftover: "original job identity unchanged",
  }),
  freezeRow({
    id: "T04.c",
    name: "crash-before-job-commit",
    initialState: "crash before job INSERT commit",
    action: "client error then retry",
    expected: "no durable job; retry with same key may insert",
    leftover: "zero Catalog side effects",
  }),
  freezeRow({
    id: "T04.d",
    name: "crash-after-job-commit",
    initialState: "job INSERT committed, HTTP return lost",
    action: "retry same key",
    expected: "same job; not a duplicate",
    leftover: "one job row",
  }),
  freezeRow({
    id: "T12.a",
    name: "stale-fence",
    initialState: "running with fence N",
    action: "lease expires; manager B claims fence N+1; A resumes",
    expected: "A cannot activate/overwrite; B may activate once",
    leftover: "at most one official Catalog side effect",
  }),
  freezeRow({
    id: "T05",
    name: "concurrent-predecessor",
    initialState: "two authorized Candidates on same predecessor",
    action: "concurrent manager execute",
    expected: "exactly one Catalog success; other needs-rebase; no mixed heads",
    leftover: "no automatic predecessor rewrite",
  }),
  freezeRow({
    id: "T08",
    name: "revoke-vs-activate",
    initialState: "queued/running",
    action: "revoke or policy disable or freeze vs activate",
    expected: "linearize: revoke/freeze first ⇒ no activation; activation first ⇒ history kept",
    leftover: "old approval cannot reuse a new policy/candidate",
  }),
  freezeRow({
    id: "T10",
    name: "recover-from-receipt",
    initialState: "activation COMMIT done, job status update / HTTP lost",
    action: "recover",
    expected: "Receipt match; no rematerialize; at most one official side effect",
    leftover: "job becomes queryable active from Receipt",
  }),
  freezeRow({
    id: "T11",
    name: "active-superseded",
    initialState: "R2 Receipt exists, R3 is current",
    action: "GET job / recover R2",
    expected: "active-superseded; no rollback",
    leftover: "R3 remains current; R2 history kept",
  }),
  freezeRow({
    id: "T25",
    name: "manager-stopped",
    initialState: "manager process stopped",
    action: "GET catalog / GET job",
    expected: "published catalog readable; jobs retained; no silent CLI bypass",
    leftover: "API /health/ready is not 503 solely because manager is down",
  }),
  freezeRow({
    id: "AUTH.z",
    name: "api-synchronizer-fence",
    initialState: "API env has synchronizer role or ordinary worker calls install",
    action: "start / call",
    expected: "fail closed; no Catalog write",
    leftover: "ordinary API pool never SET ROLE catalog_synchronizer_role",
  }),
  freezeRow({
    id: "SCOPE.z",
    name: "cross-org",
    initialState: "other-org candidateId/jobId",
    action: "GET/POST",
    expected: "uniform not-found/forbidden; no draft/impact leak",
    leftover: "no change-set or usage details in the error body",
  }),
  freezeRow({
    id: "AGENT.z",
    name: "agent-denied",
    initialState: "Agent principal",
    action: "POST candidate/publish",
    expected: "denied even if a body injects capabilities",
    leftover: "no Candidate or job row",
  }),
  freezeRow({
    id: "POLICY.z",
    name: "publication-disabled",
    initialState: "publication_enabled=false",
    action: "publish",
    expected: "403 publication-policy-disabled",
    leftover: "isolated tests may enable with EPHEMERAL_POLICY_REVISION_CONFIRMATION",
  }),
]);

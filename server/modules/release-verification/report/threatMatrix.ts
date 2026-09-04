const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "wrong-purpose-predecessor",
    attack:
      "assemble a public-release report from predecessor digests whose purposes do not match pre-activation, post-retirement-runtime, and isolated-candidate-acceptance, or use one purpose report to authorize a different purpose",
    expected: "typed refusal; no public-release row is stored; a report authorizes only its own purpose",
    evidenceOwner: "L+PG",
  },
  {
    id: 2,
    name: "self-approval-or-verifier-as-approval",
    attack:
      "approveReport with the same principal as both operator and platform-owner, or with principalKind=verifier",
    expected: "typed refusal; verifier signatures are not approvals; report bytes stay unchanged",
    evidenceOwner: "L+PG",
  },
  {
    id: 3,
    name: "pre-pin-runtime-projection",
    attack:
      "readApprovedRuntimePin before P13 is retired or while writerRetirementFingerprint is missing, or treat startup as prepare/run/assemble/approve",
    expected:
      "tagged pre-pin absence; no post-retirement-runtime report is returned; startup cannot prepare, run, assemble, or approve",
    evidenceOwner: "L+PG",
  },
  {
    id: 4,
    name: "nondeterministic-digest",
    attack: "assemble equivalent inputs twice or include Date.now in canonical report bytes",
    expected: "same inputs yield the same report digest; assembledAt is excluded from canonical bytes",
    evidenceOwner: "L+PG",
  },
  {
    id: 5,
    name: "read-report-missing-or-unapproved-tagged-absence",
    attack: "readReport of a missing digest or an unapproved purpose-gated report",
    expected: "tagged absence missing or unapproved; never a mutable stub report",
    evidenceOwner: "L+PG",
  },
  {
    id: 6,
    name: "public-release-missing-predecessor-digest",
    attack: "assemble public-release with an empty or incomplete predecessor digest list",
    expected: "typed refusal; no public-release row is stored",
    evidenceOwner: "L+PG",
  },
  {
    id: 7,
    name: "retention-closed-expired-not-present",
    attack: "readReport after retention expires or after unbound cleanup of a p16-cleanup report",
    expected: "expired or unbound cleanup cannot keep a present report",
    evidenceOwner: "L+PG",
  },
  {
    id: 8,
    name: "assemble-cannot-execute-gates-or-broaden-applicability",
    attack: "report assembly runs gates, selects a gate list, or rewrites the purpose applicability profile",
    expected: "assembly composes frozen S10-PER assemble only; applicability stays on the plan profile",
    evidenceOwner: "L",
  },
] as const);

export type ThreatMatrixRow = (typeof THREAT_MATRIX)[number];
export type ThreatMatrixId = ThreatMatrixRow["id"];

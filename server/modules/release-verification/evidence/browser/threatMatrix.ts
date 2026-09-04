export type ThreatMatrixId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type ThreatMatrixRow = {
  readonly id: ThreatMatrixId;
  readonly name: string;
  readonly attack: string;
  readonly expected: string;
  readonly evidenceOwner: "L+PG" | "B later";
};

const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "mock-runtime-rejected",
    attack: "captureCatalogBrowserEvidence with runtime.kind=mock or VITE_WISEEFF_RUNTIME_MODE=mock",
    expected: "typed refusal mock-runtime; no TypedEvidenceRef bundle is produced and collect is not called",
    evidenceOwner: "L+PG",
  },
  {
    id: 2,
    name: "stale-pin-rejected",
    attack: "capture against a live catalog/database identity that does not equal plan.pins",
    expected: "typed refusal stale-pins; no bundle is produced",
    evidenceOwner: "L+PG",
  },
  {
    id: 3,
    name: "screenshot-only-rejected",
    attack: "viewport observation supplies a screenshot digest without snapshot, console, and candidate network",
    expected: "typed refusal screenshot-only; no bundle is produced",
    evidenceOwner: "L+PG",
  },
  {
    id: 4,
    name: "pre-p13-rejected",
    attack: "capture with p13State not retired, missing writer-retirement fingerprint, P12-or-earlier phase, or public traffic",
    expected: "typed refusal pre-p13; collect is not called",
    evidenceOwner: "L+PG",
  },
  {
    id: 5,
    name: "redaction-failed-rejected",
    attack: "observation redaction.status=failed or unredacted Bearer/authorization/secret/JWT material remains",
    expected: "typed refusal redaction-failed; no bundle is produced",
    evidenceOwner: "L+PG",
  },
  {
    id: 6,
    name: "fifteen-gates-three-viewports-same-candidate-pin",
    attack: "capture PCAT-UI-01..15 on one candidate",
    expected:
      "exact bundle of 15 digest-verified refs sharing candidate, target, runtime, database, principal, and pin identity; each gate binds 1440x900, 768x1024, and 390x844",
    evidenceOwner: "L+PG",
  },
  {
    id: 7,
    name: "never-executes-ui-or-selects-gates",
    attack: "adapter Playwright launch/spawn of the product UI, or caller-supplied gate list/waiver/skip",
    expected:
      "no Playwright/spawn/dev-server in capture; typed refusal gate-selection-forbidden; applicability stays on the plan profile",
    evidenceOwner: "L+PG",
  },
  {
    id: 8,
    name: "not-yet-executable-before-isolated",
    attack: "run browser adapters on a pre-activation or post-retirement-runtime plan",
    expected: "status not-yet-executable with successor isolated-candidate-acceptance; no collect",
    evidenceOwner: "L+PG",
  },
  {
    id: 9,
    name: "candidate-api-identity-bound",
    attack: "network exchanges omit candidate runtime, request id, or the pinned catalog release",
    expected: "typed refusal incomplete-bundle or stale-pins; mock network is mock-runtime",
    evidenceOwner: "L+PG",
  },
  {
    id: 10,
    name: "console-and-network-diagnostics-required",
    attack: "gate evidence without console and relevant network records at every required viewport",
    expected: "capture refuses screenshot-only or incomplete-bundle rather than emitting a screenshot-only ref",
    evidenceOwner: "L+PG",
  },
  {
    id: 11,
    name: "catalog-page-b-unclaimed",
    attack: "treat unmounted CatalogPage /parameter-admin/specs as browser-real Catalog-page B",
    expected:
      "production adapter never assigns a mounted CatalogPage claim or Catalog-page B proof; B remains S9-BRW/Hosted later",
    evidenceOwner: "B later",
  },
  {
    id: 12,
    name: "production-handlers-not-reimplemented",
    attack: "evidence adapter reimplements S10-PER prepare/run/assemble/approve/readReport or product UI actions",
    expected: "production sources only parse S9-BRW observations and consume TypedEvidenceRef/pins",
    evidenceOwner: "L+PG",
  },
] as const satisfies readonly ThreatMatrixRow[]);

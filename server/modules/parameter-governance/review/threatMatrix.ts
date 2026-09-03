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
    name: "authorized-group-once",
    initialState:
      "authorized Org Admin; two ReviewEvidence rows share one identity/key under one matcher revision and captured pin",
    action: "list the Review Queue for that Organization and pin",
    expected: "exactly one open grouped item; no duplicate groups for the same identity/key",
    leftover: "ReviewEvidence rows unchanged; at most one open ReviewItem for the group",
  }),
  freezeRow({
    id: 2,
    name: "unauthorized-scope",
    initialState: "ReviewEvidence exists for Organization A",
    action: "list or get as agent, anonymous, or Organization B's Org Admin",
    expected: "permission-denied or empty; never Organization A's items or raw evidence",
    leftover: "no ReviewItem/Resolution/Registration/Catalog writes from the unauthorized call",
  }),
  freezeRow({
    id: 3,
    name: "stale-captured-pin",
    initialState: "evidence captured against pin A; current Kernel pointer advanced to pin B",
    action: "query with captured pin A, or mix current Catalog candidates into A-pinned groups",
    expected: "typed stale-candidate failure; no silent current-release candidate mix",
    leftover: "evidence bytes unchanged; no Resolution/Registration/Catalog mutation",
  }),
  freezeRow({
    id: 4,
    name: "raw-evidence-redaction",
    initialState: "ReviewEvidence jsonb payload contains raw bytes/secrets",
    action: "authorized default list and detail, and unauthorized queries",
    expected: "projections omit payload/bytes/raw evidence; only candidate-safe digests and grouping fields",
    leftover: "stored evidence jsonb unchanged",
  }),
  freezeRow({
    id: 5,
    name: "etag-stability",
    initialState: "unchanged grouped evidence and captured pin",
    action: "repeat list/detail, then add evidence to the group",
    expected: "ETag identical for unchanged evidence+pin; ETag changes when grouped state changes",
    leftover: "no Resolution writer; open grouping identity retained",
  }),
  freezeRow({
    id: 6,
    name: "no-forbidden-writes",
    initialState: "production S4-REV query module",
    action: "authorized list/detail and static scan of production sources",
    expected: "no INSERT/UPDATE/DELETE on review resolution, Registration, or Catalog rows",
    leftover: "only Review Queue grouping/read projections; no public repository/UoW/transaction types",
  }),
  freezeRow({
    id: 7,
    name: "query-replay",
    initialState: "authorized grouped open projection for a pin",
    action: "replay the exact same list and detail query",
    expected: "same grouping, item ids, candidate state, and ReviewItem ETag",
    leftover: "no additional Resolution/Registration/Catalog rows",
  }),
]);

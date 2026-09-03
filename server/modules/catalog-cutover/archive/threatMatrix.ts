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
    name: "archived-disposition-success",
    initialState: "S7-CLS archived R1/R7/R10 identity, cutover run, current catalog release",
    action: "persistArchive of the archived disposition and source graph",
    expected: "metadata row + encrypted object + matching source/graph checksums",
    leftover: "one immutable archive; restore returns plaintext only to an authorized caller",
  }),
  freezeRow({
    id: 2,
    name: "plaintext-public-leak",
    initialState: "source payload contains a unique plaintext token",
    action: "persistArchive then scan object bytes, metadata columns, and public restore",
    expected: "fail closed on leak; public restore is permission-denied",
    leftover: "no plaintext source bytes in the object store or archive row",
  }),
  freezeRow({
    id: 3,
    name: "partial-commit-crash",
    initialState: "persist in flight with injected failure before both sides commit",
    action: "fail after object-without-metadata, metadata-without-object, or before-commit",
    expected: "typed atomicity failure",
    leftover: "zero archive rows and zero object-store residue after rollback",
  }),
  freezeRow({
    id: 4,
    name: "restore-checksum-mismatch",
    initialState: "committed archive whose object was replaced with a different valid envelope",
    action: "authorized restoreArchive",
    expected: "PCAT-ARC-CHECKSUM-MISMATCH; result contains no payload",
    leftover: "metadata unchanged; object unread by unauthorized callers",
  }),
  freezeRow({
    id: 5,
    name: "unauthorized-restore",
    initialState: "committed archive",
    action: "restore as public/verifier/governance or cutover-operator without audit",
    expected: "PCAT-ARC-PERMISSION-DENIED",
    leftover: "object store get is not invoked; ciphertext unread",
  }),
  freezeRow({
    id: 6,
    name: "truncated-object",
    initialState: "committed archive whose object bytes were truncated",
    action: "authorized restoreArchive",
    expected: "PCAT-ARC-INTEGRITY; result contains no payload",
    leftover: "metadata unchanged",
  }),
  freezeRow({
    id: 7,
    name: "replay-identity-run-checksum",
    initialState: "identical persist already committed",
    action: "replay persistArchive with the same identity+run+checksum, then a different checksum",
    expected: "already-archived no-op or PCAT-ARC-CONFLICT",
    leftover: "never a second mutable object; original restore still matches",
  }),
  freezeRow({
    id: 8,
    name: "mapping-not-imported",
    initialState: "archive adapter production sources",
    action: "persistArchive returns archiveId for a later mapping caller",
    expected: "archiveId is opaque and returned to the caller",
    leftover: "no S7-MAP import; mapping module is not a production dependency",
  }),
]);

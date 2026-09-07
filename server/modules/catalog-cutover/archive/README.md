# Immutable Archive adapter

> Chinese: [Chinese](README.zh-CN.md)

The [accepted Archive contract](../../../../docs/design-docs/parameter-catalog-cutover-archive-rollback.md#immutable-archive-contract)
requires source ownership in identity metadata and encrypted source payloads.
`persistArchive` and `persistEvidenceArchive` share the same persistence path;
neither exposes source payloads to ordinary readers. This repair changes no
schema, privileges, archive format, classification or public interface.

## Validated owner metadata and plaintext protection

An organization source row contains its organization ID, and Archive metadata
must preserve the same owner ID. Treating every long source string as forbidden
in every metadata field incorrectly rejects this required identity projection.
The earlier organization test used a short ID and a source payload without an
organization field, so it did not exercise that case.

The bounded correction keeps every plaintext needle. Encrypted object bytes are
checked against all needles. Before writing anything, the adapter must read the
actual `legacy_identities` row and exactly match the requested owner kind and ID.
Only the `owner_scope_id` identity column uses this validated value without a
payload substring rejection. All other metadata retains the original complete
scan. An owner ID copied into reason or audit metadata is still rejected; there
is no global string exemption, caller-supplied allow-list or private-value
classification heuristic. Checksums, authenticated encryption and authorized
restore retain the complete original source graph.

The permanent PostgreSQL cases use the existing adapter interface and owned
`bindings-pg16` lane. They cover an actual organization source with a UUID owner,
source readback and authorized round-trip, unchanged owner/checksum metadata,
absence of owner/source bytes in ciphertext, copied owner/secret bytes in reason
and audit references, and a forged owner field. Rejections must leave no new
Archive row or object. The original eight threat rows and their tests remain.

The prior custody transport preparation reached P7 and exposed this issue; its
platform-only workaround did not prove organization archiving. This adapter's
new Red/Green execution is separate evidence, and does not prove approved P12,
whole-controller cutover, recovery readiness or production authorization.

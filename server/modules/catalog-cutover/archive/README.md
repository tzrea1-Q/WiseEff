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

Actual owned PG16 Red `4bf7a876631c6de82c193119c7de79b14a3830ed` ran the
existing nine-file `bindings-pg16` suite: 98 collected, 96 passed, two failed,
70.32s. The failures were the legitimate long-owner archive and the forged
owner's identity-first rejection code. Green
`82bf84d50b6e06097e3845d79124dbe1de8f18eb` passed all 98 in 69.87s,
including all 24 Archive PostgreSQL cases and seven Archive pure cases. Both
runs verified owned-resource cleanup. The profile was Linux/arm64
`postgres:16-alpine`, image
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`.
The original timeouts and eight threat rows were unchanged.

Logs `/tmp/pr824-archive-owner-red.log` and
`/tmp/pr824-archive-owner-green.log` have SHA-256
`b380f3904291241fc564cab392403d180499ad11e567851018ab0e463eefdad0`
and `c0afa125b151e43bec5b482aaba7b6066172cde4610ec9b1f36d48f3cf7d592a`.
These are local exact-checkout observations, not executions of this subsequent
documentation update or Hosted acceptance.

# ConfigurationSchema extension — R3 threat matrix (Issue #849 PU-01)

Status: prepared before implementation, per the [Agent Delivery Execution Protocol](../../../agents/agent-delivery-protocol.md) Step 4. Scope: adding a third canonical Catalog subject kind `configuration-schema` with selector kind `configuration-schema-id`, as required by [ADR-0045](../../../adr/0045-configuration-schema-subject-and-seed-rebuild.md). File-by-file surface: `configurationschema-extension-recon.md`.

## Invariant under protection

Existing published Catalog releases and their interpretation must not change, while a new release may introduce a `configuration-schema` subject whose identity is a governed model identifier — never a device compatible, filename, extension or display label.

## Rows

| # | Dimension | Expected observation | Evidence owner / case |
| --- | --- | --- | --- |
| T1 | Initial state — existing two-kind releases | Every already-published release still compiles, materializes, verifies and reads identically; the golden bytes of the two-kind contracts are unchanged | Catalog kernel compiler/installer/verification suites; `catalog-release.schema.test.ts` |
| T2 | Success — new kind admitted | A release introducing a `configuration-schema` subject compiles and installs; the new capability revision is the only one that admits it | New focused compiler test + capability admission test |
| T3 | Admission boundary | A consumer that does not advertise the new capability revision fails closed rather than ignoring the new kind | `runtime/capabilities.ts` admission test; `readiness` unsupported-capability case |
| T4 | Identity forgery | A filename, file extension, upload label, display module name or a driver `compatible` can never allocate a `configuration-schema` identity | Contract parse tests; SQL constraint test with an invalid canonical key |
| T5 | Selector collision across roots | A `configuration-schema-id` selector can never collide with a driver compatible or a node-type name; the cross-root advisory-lock trigger keeps one committed namespace | SQL trigger test (three roots) |
| T6 | Alias ownership | An alias may not be reassigned across subject kinds; retiring an alias keeps its previous selector | Existing alias ownership tests extended with the third kind |
| T7 | Subtype exclusivity | A subject of kind `configuration-schema` has exactly one configuration-schema subtype row and no driver/node-type subtype row | SQL constraint test |
| T8 | Placement | A `configuration-schema` registration places into the correct module context; a mismatched module kind is rejected | Placement trigger test |
| T9 | Historical replay | A release bundle recorded under the two-kind contract still replays byte-for-byte; an unsupported new artifact fails before any write | Existing release-replay/verification suites |
| T10 | Golden pins | The S0-ID serialization golden and its pinned blob OID / byte length / SHA-256 are recomputed exactly once and verified | `serialization.test.ts` + `stable-id-rules` pin check |
| T11 | Concurrent introduction | Two concurrent releases introducing the same canonical key cannot both commit | SQL unique constraint + advisory lock; concurrency case |
| T12 | Retirement | A configuration-schema subject retires through the existing lifecycle with a tombstone and no identity reassignment | Existing retirement suites extended |
| T13 | Delete/mutation | A materialized release's subjects cannot be mutated or deleted; append-only constraints hold | Existing immutability tests |
| T14 | Generated artifacts | OpenAPI, DB schema documentation and the compiler golden are regenerated from their owners, never hand-edited | `contract:check`, `db:schema-doc:check`, compiler golden test |
| T15 | Boundary allow-list | The S12 consumer-boundary fingerprint does not regress; no new unallowlisted violation appears | `parameter-catalog-boundaries:check` |
| T16 | Fail-closed default | Any unrecognized subject/selector kind is rejected by the contract, the compiler, the SQL constraint and the matcher — no permissive fallback is introduced | Contract reject test; SQL CHECK test; matcher unknown case |

## Non-goals (explicitly out of this change)

- No second definition/value store; ConfigurationSchema shares ParameterDefinition, DefinitionRevision, registration, placement, Binding, ProjectValue and the single publication writer.
- No change to Driver compatible matching or NodeType fallback ordering.
- No rewrite of applied migrations or historical ADR text; the extension is a new append-only migration.
- No softening of the existing two-kind capability revisions: they stay admitted and unchanged.

## Self-review result and known limits

This matrix was authored by the implementing agent, not an independent reviewer. Per the protocol the R3 lanes should also receive an adversarial Spec review before sealing; that independent review has **not** been performed, and this document does not claim it. Rows T1, T9, T10 and T15 are enforced by existing repository gates; rows T2–T8, T11, T12, T16 are the cases the implementation must add.

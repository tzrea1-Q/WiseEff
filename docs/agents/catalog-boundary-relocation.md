# Exact Catalog boundary occurrence relocation

> Chinese: [Chinese](../zh-CN/agents/catalog-boundary-relocation.md)

## D-A: natural knowledge audit test repair

The user separately authorized the three identity relocations caused by the
natural audit test correction `009ce086a3050ce555806394463bb8d179c70fbb`.
The test observes the add before removal and compares complete audit contents
under both legal timestamp tie orders; it changes no production audit behavior.
This does not reuse the earlier 23-pair approval below.

The separate `knowledge-audit-relocation.json` record binds file
`server/modules/knowledge/parameterReferences.test.ts`, full source blob
`79c7bdf5cd4535d5d340e546a0037080ebae8c9b`, destination blob
`e019e246ea36a9ced4a70b572bc4c03d22eaad0b`, and exactly three unchanged slices.
They move from lines 365/384/423 to 376/395/434 (+1017 UTF-8 bytes, +11 lines).
The record SHA256 is
`3b10d26e362a35676d0f6d352e43d1085aca41769507ac331f222fc8fe539e1a`.
Parent and independent review must verify the full blobs, raw slice hashes,
permission metadata and unique pairing before this candidate is sealed.

The existing validator admits only the two closed, explicitly pinned records:
the original 23 and these three. Original fixture/allowance counts and trusted
base remain unchanged. A fourth pair, future blob, altered slice/permission,
duplicate mapping or missing discovery refuses; a record cannot approve itself.
This is not a general displacement rule or permission to preserve source layout.

## Earlier 23-pair authorization

This bounded #820 / PR #821 repair preserves the S0-ID inventory and its replacement-resistant identities. The user requested CI repair after the precise 23-pair failure was explained. Independent Standards and Spec preflight accepted this limited implementation authorization; it does not authorize merging, Policy contract changes, target operations or production release. Historical unapproved proposals remain unchanged.

The fixture correction in `e156215197f56f25cfb058ebde14c8506543646f` moved 23 unchanged occurrence slices in `server/modules/parameter-specs/propertyKeyCutover.integration.test.ts` by 216 UTF-8 bytes and five lines. The surrounding source changed; this is not approval of arbitrary SQL equivalence. The original fixture still contains 3519 occurrences at `9b3ba7df7e21f5589684bc92c872da593ad4c246`. Current allowances contain 3513 entries, with the six prior removals retained. Neither original fixture nor allowance shards are rewritten.

The separate [exact record](../../scripts/fixtures/parameter-catalog-allowlist/property-key-cutover-relocation.json) binds the full old blob `dd0168f369b615f45eeb1e5539557fb63967e1dd`, destination blob `1854772393388a8778b27594d2789b8635bfa3de`, original fixture digest, and each complete old/new occurrence record plus raw slice digest. Its byte digest is pinned in the reviewed validator after independent pre-seal review. Editing JSON cannot approve another mapping.

The checker first performs its existing fixture-integrity, explicit-base ancestry and allowance-growth checks. It then verifies every pair, both whole-file blobs, exact source/destination positions, identical raw bytes and unchanged permission metadata. Old IDs must still exist in both original inventory and current allowances, destinations must be actual scanner discoveries, neither side may be reused, and already-bound or unused pairs fail. Only after all checks succeed are those 23 observed IDs mapped to the existing identities. The report retains historical identity records and exposes current locations separately in `relocations`.

This is one exact record, not a general displacement/search rule. Missing or altered records, changed source bytes (including dirty/future edits), incomplete mappings and cross-file replacements fail closed. Other discoveries still pass through the unchanged comparison. New debt remains unallowlisted; removed debt cannot be restored through this seam. Later legitimate edits require removing migrated debt or another explicitly reviewed identity decision; do not regenerate the inventory, infer SQL equivalence, pad source, change trusted base or disable checks.

Validation uses `npm run test:scripts -- scripts/parameter-catalog-allowlist/exactRelocation.test.ts scripts/check-parameter-catalog-boundaries.test.ts` and `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`. The existing inventory assertion is unchanged and gains explicit alias uniqueness assertions. Actual commands, review SHAs and Hosted checkout evidence belong to the [delivery plan](../exec-plans/active/2026-09-05-catalog-r2-delivery.md); documentation alone is not CI evidence.

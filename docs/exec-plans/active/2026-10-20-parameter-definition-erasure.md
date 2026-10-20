# Platform parameter-definition erasure

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-10-20-parameter-definition-erasure.md)

Status: local implementation complete; PR CI and merge verification are owned by the delivery coordinator. User decision: 2026-10-20.

## Authorized outcome

A platform administrator can permanently remove a shared definition and its values, revisions and related records in every organization. Original DTS/JSON source files remain unchanged. This explicitly adds a controlled exception to the permanent-identity and immutable-history retention policy in ADR-0040/0041; ordinary publication, parameter writes and database-role restrictions remain unchanged.

## Invariants

- Only an authenticated, global `platform-admin` may preview or execute erasure. Preview and execution use the same target closure; a stale preview cannot authorize a changed deletion.
- Remove the definition, all its revision/head rows, bindings, values, histories and associated governance/legacy records. Shared source occurrences/files, other definitions and their actual values remain.
- Revoke affected multi-parameter requests rather than retaining a misleading approval over changed contents. Detach surviving replacement-value provenance instead of deleting the surviving value.
- Rewrite affected Catalog release artifacts, embedded source documents and materialization fingerprints together. Keep surviving definition/revision identities and contents. Old pins become stale; caches and later installation must not revive an erased definition.
- Scrub database and object archives. Preserve embedded original configuration files. Object deletion failure remains retryable and cannot report complete deletion.
- Keep an erasure marker and audit containing identity, actor, counts and old/new hashes, without deleted definition contents or values.

## Implementation and verification

1. Catalog owner prepares and validates a deterministic erasure plan; protected SQL applies it with the relational deletion under the existing Catalog/publication locks.
2. A platform-only preview/delete API orchestrates transaction, object cleanup and audit. UI uses one impact confirmation and refreshes current Catalog state after completion.
3. Real PostgreSQL checks cover populated deletion, cross-organization scope, surviving definitions/values, cycles, rollback, stale/concurrent writes, role restrictions, archives, artifact repair and resurrection refusal.
4. Focused frontend checks and a real API browser check cover platform-only access, impact preview, errors and completion. Run changed-file static checks, build, contract/schema docs and independent destructive-seam review.

Earlier module/navigation changes in the same owned worktree remain intact. No production deletion or deployment is part of implementation verification.

## Documentation Impact Matrix

| Area | Update |
| --- | --- |
| Definition and release retention | ADR-0040/0041 maintenance exception and Chinese companions |
| HTTP and database schema | Regenerate OpenAPI and database schema reference |
| Archive configuration and operation | Environment variable references, example configuration and this bilingual plan |

## Documentation Update Gate

Regenerate contracts and schema from the final migrations; run `npm run contract:check` and `npm run docs:check`. Keep English and Chinese amendments aligned. Record actual verification separately from planned or unrun acceptance.

## Archive configuration and compatibility

The ordinary source object store serves project-plane archives. Historical encrypted cutover archives additionally require both `WISEEFF_CATALOG_ARCHIVE_ROOT` and `WISEEFF_CATALOG_ARCHIVE_KEY_HEX` (the original 32-byte key, encoded as 64 hexadecimal characters). Neither has a default. Never substitute a new key for an existing archive.

Erasure validates every archive before writing. Project-plane v2 archives retain their original source objects and topology while removing owned rows and structured parameter snapshots. The native cutover `legacy-row` graph and single-identity `legacy-source-row` graph can be erased after decryption and checksum verification. An unknown or mixed encrypted graph, including one containing another parameter or original file, stops the operation before database deletion; it needs a compatible archive migration first. Missing keys, corrupt archives and retained object references also prevent a false completion.

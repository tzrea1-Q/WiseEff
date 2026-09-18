# T2.2-DBG S12-DBG file×rule classification

Companion to t22-dbg-debug-consumers-acceptance.md. 5 groups / 17 entries. 0 unexplained.

| n | file | rule | class |
| --- | --- | --- | --- |
| 7 | `server/modules/debugging/repository.ts` | unresolved-boundary-expression | canonical-current-debug-overlay |
| 4 | `server/modules/debugging/catalogSplitRepository.ts` | unresolved-boundary-expression | canonical-current-debug-overlay |
| 3 | `server/modules/debugging/repository.ts` | legacy-parameter-spec-identifier | canonical-current-exact-pin |
| 2 | `server/modules/debugging/routes.ts` | legacy-catalog-route | canonical-current-debug-overlay |
| 1 | `server/modules/debugging/service.test.ts` | unresolved-boundary-expression | exact-canonical-history |

| Class | Count |
| --- | --- |
| canonical-current-debug-overlay | 13 |
| canonical-current-exact-pin | 3 |
| exact-canonical-history | 1 |
| archived-notice | 0 |

`exactDebugOperationValues` is gone. Shard IDs were not deleted: checker did not complete (T2.2-TOP `editService.ts` relocation blob; fixtures not rewritten). Remaining identifier tokens are `parameter_spec_id` columns on `node_operations` inserts.

# T2.2-LOG S12-LOG file×rule classification

Companion to t22-log-log-consumers-acceptance.md. 3 groups / 10 entries. 0 unexplained.

| n | file | rule | class |
| --- | --- | --- | --- |
| 7 | `server/modules/logs/analyzer/tools/dbToolBackends.ts` | legacy-catalog-raw-read | canonical-current-exact-pin |
| 2 | `server/modules/logs/repository.ts` | unresolved-boundary-expression | canonical-current-logs |
| 1 | `server/modules/logs/domainsRepository.ts` | unresolved-boundary-expression | canonical-current-logs |

| Class | Count |
| --- | --- |
| canonical-current-logs | 3 |
| canonical-current-exact-pin | 7 |
| exact-canonical-history | 0 |
| archived-notice | 0 |

`interceptExactRelatedParameterSql` / `pinLogRelatedParameterQuery` are gone from production. Shard IDs were not deleted: checker did not complete (T2.2-TOP `editService.ts` relocation blob; fixtures not rewritten). Remaining `dbToolBackends.ts` raw-reads are the exact binding lookup.

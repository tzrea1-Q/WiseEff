# T2.2-DTS S12-DTS file×rule classification

Companion to t22-dts-reload-consumers-acceptance.md. 12 groups / 54 entries. 0 unexplained.

| n | file | rule | class |
| --- | --- | --- | --- |
| 17 | `server/modules/dts-reload/repository.ts` | legacy-catalog-raw-read | canonical-current-exact-pin |
| 6 | `server/modules/dts-reload/deploy.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 6 | `server/modules/dts-reload/history.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 6 | `server/modules/dts-reload/promote.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 6 | `server/modules/dts-reload/service.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 4 | `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 3 | `server/modules/dts-reload/behaviouralVerify.ts` | legacy-catalog-raw-read | canonical-current-exact-pin |
| 2 | `server/modules/dts-reload/provenance.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 1 | `server/modules/dts-reload/promote.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 1 | `server/modules/dts-reload/repository.ts` | unresolved-boundary-expression | canonical-current-reload |
| 1 | `server/modules/dts-reload/resolveConfiguration.test.ts` | unresolved-boundary-expression | exact-canonical-history |
| 1 | `server/modules/dts-reload/restoreBaseline.test.ts` | legacy-catalog-raw-read | exact-canonical-history |

| Class | Count |
| --- | --- |
| canonical-current-reload | 1 |
| canonical-current-exact-pin | 20 |
| canonical-current-promote | 0 |
| exact-canonical-history | 33 |
| archived-notice | 0 |

`interceptExactReloadPinSql` / `pinDtsReloadQueryable` are gone. Shard IDs were not deleted: checker did not complete (T2.2-TOP `editService.ts` relocation blob; fixtures not rewritten). Remaining production raw-reads are exact binding/property/revision SQL.

# T2.2-KNW S12-KNW file×rule classification

Companion to t22-knw-knowledge-consumers-acceptance.md. 15 groups / 50 entries. 0 unexplained.

| n | file | rule | class |
| --- | --- | --- | --- |
| 13 | `server/modules/knowledge/parameterReferences.ts` | legacy-catalog-raw-read | canonical-current-stored-ref |
| 8 | `e2e/acceptance/knowledge.acceptance.spec.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 6 | `server/modules/knowledge/parameterReferences.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 4 | `server/modules/knowledge/routes.test.ts` | legacy-catalog-route | exact-canonical-history |
| 3 | `e2e/acceptance/knowledge.acceptance.spec.ts` | legacy-catalog-route | exact-canonical-history |
| 3 | `server/modules/knowledge/parameterReferences.ts` | legacy-parameter-spec-identifier | canonical-current-stored-ref |
| 3 | `server/modules/knowledge/routes.ts` | legacy-catalog-route | canonical-current-picker |
| 2 | `server/modules/knowledge/logDomainRetrieval.ts` | unresolved-boundary-expression | canonical-current-knowledge |
| 2 | `server/modules/knowledge/repository.ts` | unresolved-boundary-expression | canonical-current-knowledge |
| 1 | `e2e/acceptance/knowledge.acceptance.spec.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 1 | `e2e/acceptance/knowledge.acceptance.spec.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 1 | `server/modules/knowledge/indexing/vectorEnsure.integration.test.ts` | unresolved-boundary-expression | exact-canonical-history |
| 1 | `server/modules/knowledge/reloadDistillationService.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 1 | `src/infrastructure/http/knowledgeClient.test.ts` | legacy-catalog-route | exact-canonical-history |
| 1 | `src/infrastructure/http/knowledgeClient.ts` | legacy-catalog-route | canonical-current-picker |

| Class | Count |
| --- | --- |
| canonical-current-picker | 4 |
| canonical-current-stored-ref | 16 |
| canonical-current-knowledge | 4 |
| exact-canonical-history | 26 |
| archived-notice | 0 |

`pinK` / `interceptKnowledgeReferenceSql` are gone. Shard IDs were not deleted: checker did not complete (T2.2-TOP `editService.ts` relocation blob; fixtures not rewritten). Remaining production raw-reads are LEFT JOIN + exact property-key projection.

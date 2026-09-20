# T2.2-AGT S12-AGT file×rule classification

Companion to t22-agt-agent-consumers-acceptance.md. 7 groups / 30 entries. 0 unexplained.

| n | file | rule | class |
| --- | --- | --- | --- |
| 14 | `server/modules/agent/tools/actionTools.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 6 | `server/modules/agent/tools/actionTools.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 3 | `server/modules/agent/tools/actionTools.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 2 | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 2 | `server/modules/agent/tools/actionTools.integration.test.ts` | legacy-overlay-catalog-contract | exact-canonical-history |
| 2 | `server/modules/agent/tools/actionTools.ts` | legacy-parameter-spec-identifier | canonical-current-agent-draft |
| 1 | `server/modules/agent/tools/actionTools.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |

| Class | Count |
| --- | --- |
| canonical-current-agent-read | 0 |
| canonical-current-agent-draft | 2 |
| exact-canonical-history | 28 |
| archived-notice | 0 |

`submitLegacyParameterChange` is gone from production. Shard IDs were not deleted: checker did not complete (T2.2-TOP `editService.ts` relocation blob; fixtures not rewritten). Remaining production identifiers are submit `parameterSpecId` from the draft.

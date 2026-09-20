# T2.2-OPS S12-OPS file×rule classification

Companion to t22-ops-operations-consumers-acceptance.md. 2 groups / 4 entries. 0 unexplained.

| n | file | rule | class |
| --- | --- | --- | --- |
| 2 | `scripts/reconcile-parameter-definitions.ts` | legacy-catalog-module-import | archived-notice (import deleted; shard IDs remain because checker blocked) |
| 2 | `scripts/reconcile-parameter-definitions.ts` | legacy-effective-governance-contract | archived-notice (import deleted; shard IDs remain because checker blocked) |

| Class | Count |
| --- | --- |
| archived-notice | 4 |
| exact-canonical-history | 0 (CLI tests not in shard) |

`parameter-specs` imports are gone from the CLI. Shard IDs were not deleted: checker did not complete (T2.2-TOP `editService.ts` relocation blob; fixtures not rewritten).

# T3.3a S2 controller and Docker rehearsal — progress receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t33a-s2-rehearsal.md)

Status: **local candidate green for T3.3a.** T3.3b is not pass (see [t33b-remaining-verification.md](t33b-remaining-verification.md)). T3.2 remaining target-synthetic/minimal-upgrade stay deferred. Not SEALED. Not pushed. T3.4a remains the seal point.

## Known gaps this todo must close

From [round report S2](../2026-09-15-parameter-unification-round-report.md) and [PU-07](../2026-09-14-parameter-unification-and-seed-parity.md#controlled-archive-rebuild-procedure):

| Gap | Current | T3.3a obligation |
| --- | --- | --- |
| P2 quiescence | `orchestrator.ts` returns hardcoded `writersFenced/queuesDrained/publicProxyStopped: true` | Observed writer/queue/proxy/publication fencing; attestation `WISEEFF_CATALOG_QUIESCED` is not P2 proof |
| Recovery point | `captureInventoryDump` is relation counts, not PG/object-store/Redis | Verified three-store recovery points (`ops/self-hosted/storage/recoveryPoint.ts`) bound to the run |
| Identities | Plan pins artifact SHA + release digest | Also pin database/image/schema/seed/scope/archive; reject drift or incomplete inventory |
| Publish | P11–P16 unavailable | Exclusive authorized temporary unfreeze, activation receipt, refreeze on success/failure — without making P11–P16 a silent default |
| Interrupt | P0–P10 crash/resume exists (`liveRun: false`) | Interrupt every durable phase; continuation or recovery-required; full restore; non-parameter preservation |
| Working directories | CLI lives under `scripts/wayfinder` | Sanitized diagnostics from repository root **and** `ops/self-hosted` |
| Export/import rehearsal | `export/import-parameter-catalog-rehearsal.sh` + `rehearse-parameter-catalog-replacement.sh` | Close remaining identity/drift/container gaps on owned helper PG, not compose `5432/wiseeff` |

## This turn

Close the P2 hardcoded-true gap: execute refuses to checkpoint P2 unless `ExecuteCutoverInput.quiescence` is an observed proof (digest-bound). Operator attestation `WISEEFF_CATALOG_QUIESCED` remains required on `upgrade.sh apply` and is still not P2 proof; apply also requires `WISEEFF_CATALOG_QUIESCENCE_JSON`.

Verification (helper PG **55438** / `wiseeff_t23b`):

| Command | Result |
| --- | --- |
| `npx vitest run --config vitest.server.config.ts` `catalog-cutover/quiescence.test.ts` `orchestrator.test.ts` `recovery.integration.test.ts` | **10 passed** |
| `npx vitest run --config vitest.scripts.config.ts` `execute-parameter-catalog-cutover.test.ts` | **3 passed** |
| `upgrade.sh.test.ts` `-t "quiesce\|QUIESCENCE\|P2"` | **4 passed**, 243 skipped |
| `upgrade.sh.test.ts` `-t "S11-APL catalog apply"` | **15 passed**, 232 skipped |

This turn (T3.3a close-out):

- Plan pins database/image/schema/seed/scope/archive identities; incomplete inventory and drifted observations fail closed.
- P3 requires digest-bound postgres/object-store/redis recovery-point observation; inventory dump stays for rollback equality and is not treated as a backup.
- Execute injects a crash before every P0–P10 phase on an isolated DB, then resumes to completion.
- Exclusive unfreeze requires freeze + matching token, always refreezes, and demands an activation receipt. P11–P16 stay unavailable on the cutover orchestrator.
- Inspect/plan/execute/recover JSON is sanitized; `ops/self-hosted/scripts/parameter-catalog-cutover.sh` is the second working-directory entry.
- Export/import rehearsal ran against helper container `wiseeff-g668-pg` (not compose `5432/wiseeff`).

Observed quiescence and recovery-point JSON are still operator-supplied proofs, not auto-scraped compose queue/proxy samples. Missing proof fails closed.

| Command | Result |
| --- | --- |
| catalog-cutover identities/recoveryPoint/exclusiveUnfreeze/quiescence/orchestrator/recovery.integration | **14 passed** |
| S11-APL catalog apply (`upgrade.sh.test.ts`) | **15 passed** (232 skipped in file) |
| `parameter-catalog-rehearsal.integration.test.ts` `WAYFINDER_POSTGRES_CONTAINER=wiseeff-g668-pg` | **81 passed** |
| cutoverDiagnostic + cutoverWorkingDirectory | **2 passed** |

## Environment

Helper PG **55438**. Not `wiseeff_lane_849`. Not compose `5432/wiseeff`. Docker on this host is `linux/aarch64`; T3.3a local rehearsal may use helper PG containers, but is not linux/x86_64 Hosted/minimal-upgrade evidence.

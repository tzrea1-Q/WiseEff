# T3.3b target plan — authorized local self-hosted instance

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t33b-target-plan.md)

Status: **authorized local-target plan.** Not production. Not Hosted. T3.4a is still **not SEALED**; this run binds HEAD `19b987e5ab5aeb0f51ad5f86a8a9c3d310ea2c5f` and must be re-bound if that SHA moves. Destructive T2.3 archive DROP is **not** in this plan.

## Authorization

The operator designated a **local self-hosted instance** as the T3.3b target and authorized target rehearsal on that instance. This is not remote-datacenter evidence and not production publication.

## Instance identity

| Pin | Value |
| --- | --- |
| Candidate SHA | `19b987e5ab5aeb0f51ad5f86a8a9c3d310ea2c5f` |
| Compose project | `wiseeff-t33b-target` |
| Public URL | `http://127.0.0.1:18080` |
| API (via proxy) | `http://127.0.0.1:18080/api/` |
| Postgres | `127.0.0.1:55442/wiseeff` (not `5432/wiseeff`) |
| Redis | `127.0.0.1:56380` |
| MinIO | `127.0.0.1:59010` bucket `wiseeff` |
| Image tag | `wiseeff-app:t33b-19b987e5a` |
| Overlay | `ops/self-hosted/compose.t33b-target.yaml` on `compose.yaml` |
| Postgres image | `pgvector/pgvector:pg16` (catalog extension; stock compose is `postgres:16-alpine`) |

Forbidden: root compose `127.0.0.1:5432/wiseeff`, `wiseeff_lane_849`, T3.3a stack `55441/56379/59000`.

## In plan

1. Stand up api, worker, web, proxy, postgres, redis, minio, publication-manager on the pins above.
2. Insert a non-parameter sentinel (`t33b_preservation.sentinel`).
3. Real fencing: `docker compose stop proxy api worker publication-manager`; observe writer containers down, proxy port 18080 closed, Redis queue drained, freeze key set.
4. Capture/verify/`restoreCheck` three-store recovery points. Prior point must refuse after Redis receipt mutation.
5. Exclusive unfreeze with activation receipt; refreeze on success and failure. P11–P16 stay unavailable on the cutover orchestrator.
6. Restart services; `/health/live` must pass; sentinel must still be present.

## Not in plan

- T2.3 destructive DROP of live successor tables or offline archive disposal.
- Production `publication_enabled=true`.
- Catalog apply / P11–P16 activation as a silent default.
- Hosted, merge, push, Issue close.

First-intro publication-manager LOGIN is intentionally unset; catalog freeze via dedicated manager DSN is not claimed. Operational freeze is the Redis freeze key plus stopped manager/api writers.

## Execution result

See [t33b-remaining-verification.md](t33b-remaining-verification.md). Local-target probes passed on this SHA. Destructive DROP not executed.

# T3.3b remaining verification — authorized local self-hosted target

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t33b-remaining-verification.md)

Status: **authorized local-target pass on HEAD `19b987e5ab5aeb0f51ad5f86a8a9c3d310ea2c5f`.** Not production. Not Hosted. T3.4a is still **not SEALED**. Destructive T2.3 DROP was not in the plan. Plan: [t33b-target-plan.md](t33b-target-plan.md).

The operator designated a local self-hosted instance as the T3.3b target (not the T3.3a t34a-stores rehearsal stack, not compose `5432/wiseeff`).

## Instance

| Pin | Value |
| --- | --- |
| Public URL | `http://127.0.0.1:18080` |
| Postgres | `127.0.0.1:55442/wiseeff` |
| Redis | `127.0.0.1:56380` |
| MinIO | `127.0.0.1:59010` / bucket `wiseeff` |
| Image | `wiseeff-app:t33b-19b987e5a` |
| Compose project | `wiseeff-t33b-target` |
| Migrations | **157 applied** through `0159_plane_disposal_definer_select.sql` inside the API container |

## This turn

- Real fencing: stopped `proxy`, `api`, `worker`, `publication-manager`; observed writer containers down, port 18080 closed, Redis queue drained, freeze key `1`.
- Exclusive unfreeze wrote an activation receipt and refroze on success and failure. P11–P16 stay unavailable.
- Three-store capture/verify/`restoreCheck`; prior recovery point refused after Redis receipt mutation.
- Non-parameter sentinel `t33b_preservation.sentinel` survived restart.
- `/health/live` and `/health/ready` both **200** after restore (`postRestart.ready: true`). `dtsToolchain` and `catalogPublication` remain `missing` on first-intro (no dedicated manager LOGIN; image dtc probe still reports missing). Not production publication.
- Destructive archive/rebuild: **not in plan**.

| Command | Result |
| --- | --- |
| `npm run test:scripts -- ops/self-hosted/storage/t33bTargetRehearsal.integration.test.ts` | **1 passed** |
| `npx tsx scripts/wayfinder/rehearse-s2-target.ts` (repo root) | **ok**, restore-authorized, sentinel preserved, postRestart live+ready |
| `parameter-catalog-cutover.sh rehearse-s2-target` (`ops/self-hosted`) | **ok**, secrets not printed |
| T3.3a `t33aDockerRehearsal` + `liveStorePorts` after Redis TYPE dump fix | **4 passed** |

## Still not this item

Remote/pre-production host with a T3.4a-sealed SHA, Hosted, merge, production publication, T2.3 destructive DROP.

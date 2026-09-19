# T3.2 remaining verification — later suitable environment

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t32-remaining-verification.md)

These items are **not pass**. They are blocked in this worktree session and must be rerun on a matching environment before T3.2 can be checked. Do not treat skip, historical CI SKIPPED, or this deferral as acceptance.

Local-non-HDC Gate0, smoke, quality, coverage, and operations already have current evidence on this Scratch (see [t32-local-acceptance.md](t32-local-acceptance.md)).

## Deferred items

| Item | Why it could not run here | Required environment | Command / entry | Pass means |
| --- | --- | --- | --- | --- |
| target-synthetic-acceptance | No target frontend/API URLs or auth secrets in this session. Env names `WISEEFF_ACCEPTANCE_FRONTEND_URL`, `WISEEFF_TARGET_FRONTEND_URL`, `TARGET_FRONTEND_URL` (and API counterparts) were unset. | Live target (or authorized synthetic target) with frontend + API URLs, auth secrets, optional target `DATABASE_URL`. CI job is `workflow_dispatch` `target-synthetic-acceptance`. | GitHub Actions `ci.yml` `acceptance_mode=target-non-hdc` or `full-pilot`: `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime --frontend-url <target>` | Job completes on the named candidate SHA with `--no-start-runtime`; artifacts archived. Skip/missing secrets is not pass. |
| minimal-upgrade | `scripts/run-minimal-upgrade-acceptance.ts` requires a **sealed** 40-char SHA, native Docker **`linux/x86_64`**, and the daemon id. This host is Docker `linux/aarch64` / arm64. T3.4a has not sealed this Scratch. No `workflow_dispatch` `acceptance_mode=minimal-upgrade` was authorized. | linux/x86_64 Docker host or GitHub hosted runner; sealed candidate SHA; docker daemon id. | `npx tsx scripts/run-minimal-upgrade-acceptance.ts <40-char-sha> "$(docker info --format '{{.ID}}')"` or `gh workflow run ci.yml -f acceptance_mode=minimal-upgrade` | Terminal evidence `complete:true` on the sealed SHA. `complete:false`, arm64 refusal, or unsigned SHA is not pass. |

## Pickup rules

1. Re-run on the **same candidate SHA** that T3.4a will seal, or reseal after the rerun.
2. Record exact SHA, environment, command, pass/fail/skip counts, and artifact paths in [t32-local-acceptance.md](t32-local-acceptance.md) (EN+ZH).
3. Do not start T3.3b/target execution from these local results.
4. T3.2 checklist stays unchecked until both rows have current pass evidence.

## Out of scope here

T3.3a Docker/S2 rehearsal, T3.3b target, T3.4a seal, T3.4b PR/Hosted/merge, T3.5 Issue close.

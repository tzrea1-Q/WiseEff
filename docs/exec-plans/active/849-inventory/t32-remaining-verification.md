# T3.2 remaining verification — later suitable environment

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t32-remaining-verification.md)

target-synthetic-acceptance **passed** on SHA `d520964e4` (see [t32-local-acceptance.md](t32-local-acceptance.md)). **minimal-upgrade is still not pass.** T3.2 stays unchecked until that row has current pass evidence. Do not treat skip, historical CI SKIPPED, or arm64 refusal as acceptance.

Local-non-HDC Gate0, smoke, quality, coverage, operations, and now target-non-hdc already have current evidence on this Scratch.

## Remaining deferred item

| Item | Why it could not run here | Required environment | Command / entry | Pass means |
| --- | --- | --- | --- | --- |
| minimal-upgrade | Ran on this host: `linux/aarch64` vs required `linux/x86_64`. Assert: `the existing self-hosted base-image contract requires native amd64`. T3.4a is not SEALED. No `workflow_dispatch` `acceptance_mode=minimal-upgrade`. | linux/x86_64 Docker host or GitHub hosted runner; sealed candidate SHA; docker daemon id. | `npx tsx scripts/run-minimal-upgrade-acceptance.ts <40-char-sha> "$(docker info --format '{{.ID}}')"` or `gh workflow run ci.yml -f acceptance_mode=minimal-upgrade` | Terminal evidence `complete:true` on the sealed SHA. `complete:false`, arm64 refusal, or unsigned SHA is not pass. |

## Pickup rules

1. Re-run on the **same candidate SHA** that T3.4a will seal, or reseal after the rerun.
2. Record exact SHA, environment, command, pass/fail/skip counts, and artifact paths in [t32-local-acceptance.md](t32-local-acceptance.md) (EN+ZH).
3. Do not start T3.3b/target execution from these local results.
4. T3.2 checklist stays unchecked until minimal-upgrade also has current pass evidence.

## Out of scope here

T3.3a Docker/S2 rehearsal, T3.3b target, T3.4a seal, T3.4b PR/Hosted/merge, T3.5 Issue close.

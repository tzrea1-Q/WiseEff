# T2.3b archive disposal — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t23b-archive-disposal-acceptance.md)

Status: **T2.3b local candidate.** Spec PASS with P2 `t23b-rereview-9b3e18c4-pass-p2`. No SEALED, commit, PR, target, or Issue update. Not target-host disposal.

## Behaviour

- `planProjectParameterPlaneDisposal` / `disposeProjectParameterPlaneResidue` in `seedInitialization/dispose.ts`. Not called from `materializeSeedSources`.
- Residue DELETE only via `parameter_catalog.dispose_plane_residue` + txid-scoped allow-list. Ordinary immutable DELETE stays fail-closed.
- Viewer / empty approval / non-Atlas-Aurora-Nebula refused. Other-project rows and post-cutover inserts retained. Truncated archive refuses before delete. Replay is no-op. Operator retrieve-by-id keeps the archive document.
- Reload rehome: `dts_reload_run_targets.binding_id` nullable + `disposed_binding_id`.
- Migrations **0154–0157**. 0148–0153 unchanged.

## Verification

Helper PG **55438** / `wiseeff_t23b` (not `wiseeff_lane_849`, not `5432/wiseeff`).

| Command | Result |
| --- | --- |
| `test:server -- dispose.integration.test.ts archive.integration.test.ts` | **18 passed** (4+14) |
| `git diff --check` on T2.3b paths | **passed** |

Independent Spec of these bytes is required before treating T2.3b as a reviewed candidate.

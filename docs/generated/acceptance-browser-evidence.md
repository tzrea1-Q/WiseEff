## Browser Acceptance Evidence

- Date: 2026-07-18T05:07:32.029Z
- Branch: `fix/parameter-topology-round6-review-blockers`
- Commit: `4fcc707a4c8a8a12860a2e4ad36051990e66385b`
- Dirty worktree: `false`
- Mode: `local-non-hdc`
- Status: `failed`

### Preflight Result

- Status: `skipped`
- Outcome: `unknown`
- HDC: `unknown`
- Evidence: test-results/acceptance/preflight-evidence.md
- Detail: --skip-preflight was provided.

### Playwright Result

- Status: `passed`
- Evidence: playwright-report/acceptance/index.html
- Detail: ok

### Workflow Table

| ID | Workflow | Status | Notes | Artifacts |
| --- | --- | --- | --- | --- |
| A | Shell navigation and access | passed | Core routes load without visible runtime crashes. | playwright-report/acceptance/index.html |
| B | Parameter management loop | passed | Parameter browser workflow coverage is reported by Playwright specs. | playwright-report/acceptance/index.html |
| C | Parameter admin governance | passed | Admin governance and audit drawer coverage is reported by Playwright specs. | playwright-report/acceptance/index.html |
| D | Log analysis loop | passed | Upload, analysis, evidence, feedback, archive, and unsupported-file coverage. | playwright-report/acceptance/index.html |
| E | Debugging simulator | passed | Simulator read, write, mismatch, rollback, and audit coverage. | playwright-report/acceptance/index.html |
| F | HDC device lab | skipped | Runs only when DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true. | playwright-report/acceptance/index.html |
| G | Agent collaboration | passed | Agent context, approval dialog, reject, approve, and evidence coverage. | playwright-report/acceptance/index.html |
| H | Permissions and user governance | passed | Route access and user-permissions governance coverage. | playwright-report/acceptance/index.html |
| I | Product feedback | passed | Sidebar feedback submission, admin triage, and admin-only access coverage. | playwright-report/acceptance/index.html |

### Requirement Coverage

- Coverage status: `passed`
- Covered required IDs: `59`
- Missing required IDs: _none_
- Unknown IDs: _none_

### Operation Evidence

- Evidence status: `passed`
- Covered operation IDs: `56`
- Missing operation IDs: _none_
- Invalid evidence records: _none_
- Validation errors: `0`
- Validation error detail: _none_
- Evidence records: `71`
- Evidence index: docs/generated/acceptance-operation-evidence.md

### Artifact Paths

- test-results/acceptance/preflight-evidence.md
- test-results/acceptance/results.json
- test-results/acceptance-evidence-runs/runs/4fcc707a4c8a8a12860a2e4ad36051990e66385b/full-20260718T045954503Z-4fcc707a4c8a
- test-results/acceptance
- playwright-report/acceptance
- docs/generated/acceptance-operation-evidence.md
- docs/generated/acceptance-operation-evidence/index.json

### Blockers

- Acceptance preflight did not pass.
- Local non-HDC mode requires pilot_ready or non_hdc_local preflight outcome.
- Local non-HDC mode requires HDC to be skipped or absent.

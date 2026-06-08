## Browser Acceptance Evidence

- Date: 2026-06-02T19:16:28.149Z
- Branch: `codex/m6-target-evidence-closure`
- Commit: `06cb6915b3030fafc371c7365fa32468deef7232`
- Dirty worktree: `true`
- Mode: `local-non-hdc`
- Status: `passed`

### Preflight Result

- Status: `passed`
- Outcome: `non_hdc_local`
- HDC: `skipped`
- Evidence: test-results/acceptance/preflight-evidence.md
- Detail: ok

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

### Requirement Coverage

- Coverage status: `passed`
- Covered required IDs: `21`
- Missing required IDs: _none_
- Unknown IDs: _none_

### Operation Evidence

- Evidence status: `passed`
- Covered operation IDs: `20`
- Missing operation IDs: _none_
- Invalid evidence records: _none_
- Validation errors: `0`
- Validation error detail: _none_
- Evidence records: `34`
- Evidence index: docs/generated/acceptance-operation-evidence.md

### Artifact Paths

- test-results/acceptance/preflight-evidence.md
- test-results/acceptance/results.json
- test-results/acceptance
- playwright-report/acceptance
- docs/generated/acceptance-operation-evidence.md
- docs/generated/acceptance-operation-evidence/index.json

### Blockers

- _none_

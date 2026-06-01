## Browser Acceptance Evidence

- Date: 2026-06-01T08:15:39.301Z
- Branch: `codex/m5-5-browser-acceptance-hardening`
- Commit: `44e0d0ead5a3c7a919397574203565ec0df72722`
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
- Covered required IDs: `15`
- Missing required IDs: _none_
- Unknown IDs: _none_

### Artifact Paths

- test-results/acceptance/preflight-evidence.md
- test-results/acceptance/results.json
- test-results/acceptance
- playwright-report/acceptance

### Blockers

- _none_

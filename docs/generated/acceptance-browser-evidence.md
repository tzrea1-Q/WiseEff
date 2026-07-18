## Browser Acceptance Evidence

- Date: 2026-07-18T03:18:36.450Z
- Branch: `fix/parameter-topology-round6-review-blockers`
- Commit: `1abb57f29ec6991eb37f6381f0ec0f87d60d0e09`
- Dirty worktree: `false`
- Mode: `local-non-hdc`
- Status: `failed`

### Preflight Result

- Status: `failed`
- Outcome: `blocked`
- HDC: `unknown`
- Evidence: test-results/acceptance/preflight-evidence.md
- Detail: > core-efficiency-prototype@0.1.0 acceptance:preflight
> tsx -- scripts/run-acceptance-preflight.ts --env-file .env --frontend-url http://127.0.0.1:5173 --evidence-out test-results/acceptance/preflight-evidence.md

## Acceptance Preflight Evidence

- Date: 2026-07-18T03:07:14.570Z
- Branch: `fix/parameter-topology-round6-review-blockers`
- Commit: `1abb57f29ec6991eb37f6381f0ec0f87d60d0e09`
- Dirty worktree: `false`
- Pilot outcome: `blocked`

### Environment

| Key | Value |
| --- | --- |
| WISEEFF_API_BASE_URL | http://127.0.0.1:8787 |
| VITE_WISEEFF_API_BASE_URL | http://127.0.0.1:8787 |
| M5_SMOKE_AUTHORIZATION | <set> |
| WISEEFF_SMOKE_AUTHORIZATION | <set> |

### Checks

| Check | Status | Detail |
| --- | --- | --- |
| api runtime | passed | already listening at http://127.0.0.1:8787/health/live |
| frontend runtime | passed | started in the background and ready at http://127.0.0.1:5173 |
| docs:check | passed | ok |
| contract:check | passed | ok |
| test:all | passed | ok |
| build | passed | ok |
| git diff --check | passed | ok |
| health live | passed | ok |
| health ready | passed | database, object store, worker, and agent are ready. |
| current user | passed | ok |
| pilot readiness | failed | Pilot-readiness is blocked by: deviceGateway, xiaozeLlm, backups. |
| frontend | passed | http://127.0.0.1:5173 returned 200. |

### Playwright Result

- Status: `failed`
- Evidence: playwright-report/acceptance/index.html
- Detail: (node:959) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:959) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:3071) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:3071) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:4073) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:4073) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:6954) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:6954) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:7006) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:7006) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:7545) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:7545) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:8344) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:8344) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:8537) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:8537) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9060) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9060) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9918) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9918) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:10510) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:10510) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11118) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11118) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


> core-efficiency-prototype@0.1.0 acceptance:e2e
> playwright test --config playwright.acceptance.config.ts


Running 84 tests using 1 worker

  ✓   1 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:154:3 › ADB device-lab preflight validation › discovers the only ready ADB target without requiring a target override (2ms)
  ✓   2 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:163:3 › ADB device-lab preflight validation › rejects multiple ready ADB targets before configuration (2ms)
  ✓   3 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:172:3 › ADB device-lab preflight validation › validates optional smoke overrides against discovered configuration (1ms)
  ✓   4 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:188:3 › ADB device-lab preflight validation › resolves write confirmation requirements after auto configuration (1ms)
  ✓   5 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:205:3 › ADB device-lab preflight validation › resolves one ADB inventory row and one shared default smoke binding from the database (1ms)
  ✓   6 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:227:3 › ADB device-lab preflight validation › rejects missing ADB inventory rows with redacted diagnostics (1ms)
  ✓   7 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:235:3 › ADB device-lab preflight validation › rejects non-readable default smoke bindings (0ms)
  ✓   8 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:254:3 › ADB device-lab preflight validation › rejects additional ready ADB devices before a hardware run (1ms)
  ✓   9 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:270:3 › ADB device-lab preflight validation › preserves debugging sessions that still own device leases during cleanup (4ms)
  ✓  10 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:292:3 › ADB device-lab preflight validation › requires explicit write and rollback confirmations when write mode is enabled (1ms)
  ✓  11 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:319:3 › ADB device-lab evidence redaction › shape-summarizes operation and audit identifiers (2ms)
  ✓  12 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:361:3 › ADB device-lab evidence redaction › shape-summarizes identifier-bearing API evidence paths (1ms)
  ✓  13 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:371:3 › ADB device-lab evidence redaction › shape-summarizes target identifiers in failure diagnostics (3ms)
  ✓  14 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:378:3 › ADB device-lab evidence redaction › shape-summarizes API error bodies and operation failure reasons (1ms)
  -  15 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:939:3 › ADB device-lab full-chain loop › detects and reads a real ADB target, with optional write/readback/rollback
  ✓  16 [Desktop Chrome] › e2e/acceptance/auth-runtime.acceptance.spec.ts:10:3 › M5.5 auth runtime parity › loads API-mode browser current user with the local dev auth contract (2.2s)
  ✓  17 [Desktop Chrome] › e2e/acceptance/debugging-admin.acceptance.spec.ts:198:3 › DEBUG-ADMIN-001 debugging admin catalog governance › debugging admin manages an API-backed HDC/ADB catalog node (3.0s)
  ✘  18 [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:508:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence (31.4s)
  ✘  19 [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:604:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls (31.4s)
  ✓  20 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:273:3 › DTS structured product browser acceptance › structure, typed editor contract, search, config-set/baseline, and structured diff (1.8s)
  ✓  21 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:540:3 › DTS structured product browser acceptance › structured edit submit preserves rawText through review merge and CST writeback (1.1s)
  ✓  22 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:705:3 › DTS structured product browser acceptance › structural impact kinds when DTS bindings exist (255ms)
  ✓  23 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:831:3 › DTS structured product browser acceptance › sensitive-node RBAC denies missing capability; agent critical deny is enforced (194ms)
  ✓  24 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:92:3 › HDC device-lab preflight validation › discovers the only connected HDC target without requiring target override (94ms)
  ✓  25 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:98:3 › HDC device-lab preflight validation › rejects multiple HDC targets before automatic configuration (82ms)
  ✓  26 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:102:3 › HDC device-lab preflight validation › auto-prepares a lab-only HDC inventory row and safe temporary smoke binding (79ms)
  ✓  27 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:127:3 › HDC device-lab preflight validation › disables non-lab HDC bindings before frontend auto-read can touch real hardware (92ms)
  ✓  28 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:147:3 › HDC device-lab preflight validation › requires explicit write and rollback confirmations before writing HDC hardware (100ms)
  -  29 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:773:3 › M5.4 manual flow F - HDC device-lab loop › drives /node-debugging through HDC read, write/readback, audit, and snapshot rollback
  ✓  30 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:202:3 › MOD-TREE hierarchical module acceptance › nested parameter modules support subtree filtering for assigned parameters (188ms)
  ✓  31 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:275:3 › MOD-TREE hierarchical module acceptance › admin can move parameter modules and cycle moves are rejected (178ms)
  ✓  32 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:344:3 › MOD-TREE hierarchical module acceptance › nested debug node modules support subtree filtering for assigned nodes (122ms)
  ✓  33 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:411:3 › MOD-TREE hierarchical module acceptance › module tree mutations require admin and non-empty modules cannot be deleted (149ms)
  -  34 [Desktop Chrome] › e2e/acceptance/local-device-bridge.acceptance.spec.ts:181:3 › local device bridge conditional acceptance › pairs bridge and runs bridge-backed detect/read/(optional) write
  -  35 [Desktop Chrome] › e2e/acceptance/local-device-bridge.acceptance.spec.ts:333:3 › local device bridge conditional acceptance › real bridge HDC path (device lab stub)
  ✓  36 [Desktop Chrome] › e2e/acceptance/log-analysis.acceptance.spec.ts:246:3 › M5.4 manual flow D - log analysis browser acceptance › uploads, completes, links evidence, audits feedback, archives, and records unsupported upload failure (5.8s)
  ✓  37 [Desktop Chrome] › e2e/acceptance/log-analysis.acceptance.spec.ts:355:3 › M5.4 manual flow D - log analysis browser acceptance › reruns a completed log and records run, job progress, audit, and operation evidence (5.3s)
  ✓  38 [Desktop Chrome] › e2e/acceptance/notifications.acceptance.spec.ts:11:3 › Notification center acceptance › loads inbox APIs and opens the TopBar notification panel (1.1s)
  ✓  39 [Desktop Chrome] › e2e/acceptance/notifications.acceptance.spec.ts:50:3 › Notification center acceptance › marks all notifications read through the API (947ms)
  ✓  40 [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:161:3 › project parameter files browser acceptance › uploads, lists, and syncs project parameter files (1.2s)
  ✓  41 [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:305:3 › project parameter files browser acceptance › resolves file/UI draft conflicts (186ms)
  ✓  42 [Desktop Chrome] › e2e/acceptance/parameter-home.acceptance.spec.ts:10:3 › parameter-home production dashboard › loads summary and hotspots APIs and renders in-page dashboard controls (1.4s)
  ✓  43 [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:35:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-DTS-FULL-001 parses full DTS with @address modules via parse-dts (1.4s)
  ✓  44 [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:106:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-REVIEW-META-001 stores skippedRows in import preview audit metadata (129ms)
  ✓  45 [Desktop Chrome] › e2e/acceptance/parameter-import-wizard.acceptance.spec.ts:163:3 › PARAM-ADMIN-002 parameter import wizard browser acceptance › runs the five-step import wizard through preview (1.9s)
  ✓  46 [Desktop Chrome] › e2e/acceptance/parameter-topology.acceptance.spec.ts:331:3 › Parameter topology / schema browser acceptance › governs specs, browses real topology, edits, maps identity, and gates publish (15.7s)
  ✓  47 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:189:3 › M5.5 parameter negative-path browser acceptance › blocks blank draft reasons before API submission (1.1s)
  ✓  48 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:249:3 › M5.5 parameter negative-path browser acceptance › edits a draft item and removes another item before final submission (952ms)
  ✓  49 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:336:3 › M5.5 parameter negative-path browser acceptance › rejects forced invalid workflow assignees at the API boundary (128ms)
  ✓  50 [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:277:3 › M5.4 manual flow B/C - parameter management browser acceptance › isolates the semantic API workspace and opens admin import preview (2.3s)
  ✓  51 [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:359:3 › M5.4 manual flow B/C - parameter management browser acceptance › rejects a submitted parameter request and persists rejection reason and audit evidence (1.7s)
  ✘  52 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest (10.7s)
  ✘  53 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User (11.0s)
  ✓  54 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software User (975ms)
  ✓  55 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware Committer (944ms)
  ✓  56 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software Committer (978ms)
  ✓  57 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Admin (964ms)
  ✓  58 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:112:3 › M5.5 permissions matrix browser acceptance › keeps API-backed workflow eligibility stricter than visible role inclusion (148ms)
  ✘  59 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:194:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin (11.6s)
  ✘  60 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:250:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access (11.8s)
  ✘  61 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:351:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication (958ms)
  ✓  62 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:237:3 › Product feedback browser acceptance › submits sidebar feedback with an optional image and persists it (1.4s)
  ✓  63 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:308:3 › Product feedback browser acceptance › lets Admin list, open, triage, close, and note feedback (1.6s)
  ✘  64 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access (10.8s)
  ✓  65 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads / without a runtime crash (999ms)
  ✓  66 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /parameter-home without a runtime crash (953ms)
  ✓  67 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /parameters without a runtime crash (897ms)
  ✓  68 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /parameter-review without a runtime crash (953ms)
  ✓  69 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /parameter-admin without a runtime crash (975ms)
  ✓  70 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /logs without a runtime crash (877ms)
  ✓  71 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /log-admin without a runtime crash (865ms)
  ✓  72 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /debugging without a runtime crash (842ms)
  ✓  73 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /node-debugging without a runtime crash (1.0s)
  ✓  74 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /debugging-admin without a runtime crash (931ms)
  ✓  75 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:45:5 › M5.4 manual flow A - shell navigation › loads /user-permissions without a runtime crash (871ms)
  ✓  76 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:238:3 › Xiaoze P1 action › approves a parameter change through the approval chain (139ms)
  ✓  77 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:336:3 › Xiaoze P1 action › resumes with AG-UI native resume entries after interrupt (113ms)
  ✓  78 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:451:3 › Xiaoze P1 action › rejects a parameter change without mutation (41ms)
  ✘  79 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:509:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message (55ms)
  ✓  80 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:173:3 › Xiaoze P0 perception › returns a grounded answer for an in-scope project question (42ms)
  ✘  81 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:204:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question (39ms)
  ✘  82 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:241:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests (45ms)
  ✓  83 [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:236:3 › Xiaoze P2 planning › completes a multi-step task through approval and observe loop (154ms)
  ✓  84 [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:314:3 › Xiaoze P2 planning › returns grounded proactive suggestions when enabled and nothing for unauthorized scope (43ms)


  1) [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:508:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

    Locator: locator('.topbar .device-pill').first()
    Expected substring: [32m"Aurora Simulator 1"[39m
    Received string:    [31m"未连接 HDC 设备重新检测"[39m
    Timeout: 30000ms

    Call log:
    [2m  - Expect "toContainText" with timeout 30000ms[22m
    [2m  - waiting for locator('.topbar .device-pill').first()[22m
    [2m    34 × locator resolved to <div class="device-pill">…</div>[22m
    [2m       - unexpected value "未连接 HDC 设备重新检测"[22m


      349 |   const devicePill = page.locator(".topbar .device-pill").first();
      350 |   await expect(devicePill).toBeVisible({ timeout: 30_000 });
    > 351 |   await expect(devicePill).toContainText("Aurora Simulator 1", { timeout: 30_000 });
          |                            ^
      352 |   await expect(devicePill.locator(".live-dot")).toHaveCount(1);
      353 | }
      354 |
        at expectSimulatorOnline (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:351:28)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:513:5

    Error: Browser diagnostics failed:
    - Unexpected API response 409 for /api/v1/debugging/targets/detect

       at helpers/browserDiagnostics.ts:91

      89 |     assertNoBrowserDiagnosticsFailures() {
      90 |       if (failures.length > 0) {
    > 91 |         throw new Error(`Browser diagnostics failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
         |               ^
      92 |       }
      93 |     }
      94 |   };
        at Object.assertNoBrowserDiagnosticsFailures (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/browserDiagnostics.ts:91:15)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/browserDiagnostics.ts:105:28

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/debugging-simulator.accept-5c827--and-records-audit-evidence-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/debugging-simulator.accept-5c827--and-records-audit-evidence-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/debugging-simulator.accept-5c827--and-records-audit-evidence-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/debugging-simulator.accept-5c827--and-records-audit-evidence-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/debugging-simulator.accept-5c827--and-records-audit-evidence-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  2) [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:604:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

    Locator: locator('.topbar .device-pill').first()
    Expected substring: [32m"Aurora Simulator 1"[39m
    Received string:    [31m"未连接 HDC 设备重新检测"[39m
    Timeout: 30000ms

    Call log:
    [2m  - Expect "toContainText" with timeout 30000ms[22m
    [2m  - waiting for locator('.topbar .device-pill').first()[22m
    [2m    34 × locator resolved to <div class="device-pill">…</div>[22m
    [2m       - unexpected value "未连接 HDC 设备重新检测"[22m


      349 |   const devicePill = page.locator(".topbar .device-pill").first();
      350 |   await expect(devicePill).toBeVisible({ timeout: 30_000 });
    > 351 |   await expect(devicePill).toContainText("Aurora Simulator 1", { timeout: 30_000 });
          |                            ^
      352 |   await expect(devicePill.locator(".live-dot")).toHaveCount(1);
      353 | }
      354 |
        at expectSimulatorOnline (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:351:28)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:609:5

    Error: Browser diagnostics failed:
    - Unexpected API response 409 for /api/v1/debugging/targets/detect

       at helpers/browserDiagnostics.ts:91

      89 |     assertNoBrowserDiagnosticsFailures() {
      90 |       if (failures.length > 0) {
    > 91 |         throw new Error(`Browser diagnostics failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
         |               ^
      92 |       }
      93 |     }
      94 |   };
        at Object.assertNoBrowserDiagnosticsFailures (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/browserDiagnostics.ts:91:15)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/browserDiagnostics.ts:105:28

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/debugging-simulator.accept-beb06--in-UI-and-forced-API-calls-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/debugging-simulator.accept-beb06--in-UI-and-forced-API-calls-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/debugging-simulator.accept-beb06--in-UI-and-forced-API-calls-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/debugging-simulator.accept-beb06--in-UI-and-forced-API-calls-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/debugging-simulator.accept-beb06--in-UI-and-forced-API-calls-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  3) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByRole('heading', { name: 'Permission denied' })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByRole('heading', { name: 'Permission denied' })[22m


      86 |         await expect(page.locator("main, .main-content").first()).toBeVisible();
      87 |       } else {
    > 88 |         await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
         |                                                                                ^
      89 |         await expect(page.getByText(`Current role: ${expectation.role}`)).toBeVisible();
      90 |       }
      91 |
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions-matrix.acceptance.spec.ts:88:80

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-d8815-route-permissions-for-Guest-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-d8815-route-permissions-for-Guest-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/permissions-matrix.accepta-d8815-route-permissions-for-Guest-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-d8815-route-permissions-for-Guest-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/permissions-matrix.accepta-d8815-route-permissions-for-Guest-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  4) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByRole('heading', { name: 'Permission denied' })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByRole('heading', { name: 'Permission denied' })[22m


       95 |         await expect(page.locator("main, .main-content").first()).toBeVisible();
       96 |       } else {
    >  97 |         await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
          |                                                                                ^
       98 |         await expect(page.getByText(`Current role: ${expectation.role}`)).toBeVisible();
       99 |       }
      100 |
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions-matrix.acceptance.spec.ts:97:80

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-96e17-rmissions-for-Hardware-User-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-96e17-rmissions-for-Hardware-User-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/permissions-matrix.accepta-96e17-rmissions-for-Hardware-User-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-96e17-rmissions-for-Hardware-User-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/permissions-matrix.accepta-96e17-rmissions-for-Hardware-User-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  5) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:194:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByRole('heading', { name: 'Permission denied' })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByRole('heading', { name: 'Permission denied' })[22m


      230 |
      231 |     await setPrototypeRole(page, "Hardware User");
    > 232 |     await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
          |                                                                            ^
      233 |     await expect(page.getByText("Current role: Hardware User")).toBeVisible();
      234 |     await expect(page.getByText("Required role: Admin")).toBeVisible();
      235 |     await expect(page.getByRole("region", { name: "用户权限" })).toHaveCount(0);
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions.acceptance.spec.ts:232:76

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--841bf-es-user-governance-to-Admin-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--841bf-es-user-governance-to-Admin-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/permissions.acceptance-M5--841bf-es-user-governance-to-Admin-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--841bf-es-user-governance-to-Admin-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/permissions.acceptance-M5--841bf-es-user-governance-to-Admin-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  6) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:250:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByRole('heading', { name: 'Permission denied' })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByRole('heading', { name: 'Permission denied' })[22m


      305 |
      306 |     await setPrototypeRole(page, "Software User");
    > 307 |     await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
          |                                                                            ^
      308 |     await expect(page.getByText("Current role: Software User")).toBeVisible();
      309 |     await expect(page.getByText("Required role: Admin")).toBeVisible();
      310 |     await expect(page.getByRole("table", { name: "平台用户" })).toHaveCount(0);
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions.acceptance.spec.ts:307:76

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--4e815-le-denying-non-Admin-access-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--4e815-le-denying-non-Admin-access-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/permissions.acceptance-M5--4e815-le-denying-non-Admin-access-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--4e815-le-denying-non-Admin-access-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/permissions.acceptance-M5--4e815-le-denying-non-Admin-access-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  7) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:351:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

    Expected: [32m401[39m
    Received: [31m200[39m

      357 |     const invalidBody = (await invalidResponse.json()) as { error?: { code?: string; message?: string } };
      358 |
    > 359 |     expect(invalidResponse.status()).toBe(401);
          |                                      ^
      360 |     expect(invalidBody.error).toMatchObject({
      361 |       code: "UNAUTHENTICATED"
      362 |     });
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions.acceptance.spec.ts:359:38

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--75653-ction-bearer-authentication-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--75653-ction-bearer-authentication-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/permissions.acceptance-M5--75653-ction-bearer-authentication-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/permissions.acceptance-M5--75653-ction-bearer-authentication-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/permissions.acceptance-M5--75653-ction-bearer-authentication-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  8) [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByRole('heading', { name: 'Permission denied' })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByRole('heading', { name: 'Permission denied' })[22m


      392 |
      393 |     await loadPageAsHardwareUser(page, "/feedback-admin");
    > 394 |     await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
          |                                                                            ^
      395 |     await expect(page.getByText("Current role: Hardware User")).toBeVisible();
      396 |     await expect(page.getByText("Required role: Admin")).toBeVisible();
      397 |
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/product-feedback.acceptance.spec.ts:394:76

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/product-feedback.acceptanc-b24bc--admin-APIs-and-page-access-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/product-feedback.acceptanc-b24bc--admin-APIs-and-page-access-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/product-feedback.acceptanc-b24bc--admin-APIs-and-page-access-Desktop-Chrome/error-context.md

    Error Context: test-results/acceptance/product-feedback.acceptanc-b24bc--admin-APIs-and-page-access-Desktop-Chrome/error-context.md

    attachment #6: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/product-feedback.acceptanc-b24bc--admin-APIs-and-page-access-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/product-feedback.acceptanc-b24bc--admin-APIs-and-page-access-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  9) [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:509:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoMatch[2m([22m[32mexpected[39m[2m)[22m

    Expected pattern: [32m/not permitted|forbidden|无权限/[39m
    Received string:  [31m"submitted parameter change request cb45f6ca-fcb8-4ba9-b1f3-0c737833bebb for review. [citation:parameter]"[39m

      542 |       .map((event) => String(event.delta ?? ""))
      543 |       .join("");
    > 544 |     expect(answer.toLowerCase()).toMatch(/not permitted|forbidden|无权限/);
          |                                  ^
      545 |     const openAfter = await countOpenChangeRequests();
      546 |     expect(openAfter).toBe(openBefore);
      547 |     const authzArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-action-authz-denied.json", {
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-action.acceptance.spec.ts:544:34

    Error Context: test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  10) [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:204:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoMatch[2m([22m[32mexpected[39m[2m)[22m

    Expected pattern: [32m/not permitted|cannot|无权限|forbidden/[39m
    Received string:  [31m"project secret-project: 0 parameters, 0 open change requests. [citation:parameter]"[39m

      213 |     expect(result.status).toBe(200);
      214 |     const answer = readSseText(result.body);
    > 215 |     expect(answer.toLowerCase()).toMatch(/not permitted|cannot|无权限|forbidden/);
          |                                  ^
      216 |     expect(answer.toLowerCase()).not.toMatch(/secret-project: \d+ parameters/);
      217 |     const authzArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-perception-authz.json", {
      218 |       status: result.status,
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-perception.acceptance.spec.ts:215:34

    Error Context: test-results/acceptance/xiaoze-perception.acceptan-c3a42-t-of-scope-project-question-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-perception.acceptan-c3a42-t-of-scope-project-question-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-perception.acceptan-c3a42-t-of-scope-project-question-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  11) [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:241:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

    Expected: [32m401[39m
    Received: [31m200[39m

      241 |   test("rejects unauthenticated xiaoze requests", async ({ request }) => {
      242 |     const result = await postXiaozeQuestion(request, { "Content-Type": "application/json", Accept: "text/event-stream" }, "hello");
    > 243 |     expect(result.status).toBe(401);
          |                           ^
      244 |   });
      245 | });
      246 |
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-perception.acceptance.spec.ts:243:27

    Error Context: test-results/acceptance/xiaoze-perception.acceptan-9fea8-thenticated-xiaoze-requests-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-perception.acceptan-9fea8-thenticated-xiaoze-requests-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-perception.acceptan-9fea8-thenticated-xiaoze-requests-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  11 failed
    [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:508:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence
    [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:604:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:194:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:250:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:351:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication
    [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access
    [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:509:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message
    [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:204:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question
    [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:241:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests
  4 skipped
  69 passed (11.4m)

### Workflow Table

| ID | Workflow | Status | Notes | Artifacts |
| --- | --- | --- | --- | --- |
| A | Shell navigation and access | passed | Core routes load without visible runtime crashes. | playwright-report/acceptance/index.html |
| B | Parameter management loop | passed | Parameter browser workflow coverage is reported by Playwright specs. | playwright-report/acceptance/index.html |
| C | Parameter admin governance | passed | Admin governance and audit drawer coverage is reported by Playwright specs. | playwright-report/acceptance/index.html |
| D | Log analysis loop | passed | Upload, analysis, evidence, feedback, archive, and unsupported-file coverage. | playwright-report/acceptance/index.html |
| E | Debugging simulator | failed | Simulator read, write, mismatch, rollback, and audit coverage. | playwright-report/acceptance/index.html |
| F | HDC device lab | skipped | Runs only when DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true. | playwright-report/acceptance/index.html |
| G | Agent collaboration | failed | Agent context, approval dialog, reject, approve, and evidence coverage. | playwright-report/acceptance/index.html |
| H | Permissions and user governance | failed | Route access and user-permissions governance coverage. | playwright-report/acceptance/index.html |
| I | Product feedback | failed | Sidebar feedback submission, admin triage, and admin-only access coverage. | playwright-report/acceptance/index.html |

### Requirement Coverage

- Coverage status: `passed`
- Covered required IDs: `59`
- Missing required IDs: _none_
- Unknown IDs: _none_

### Operation Evidence

- Evidence status: `failed`
- Covered operation IDs: `49`
- Missing operation IDs: `DEBUG-PERM-001`, `DEBUG-SIM-001`, `PERM-GOV-001`, `PERM-USER-MGMT-001`, `PFB-AUTHZ-001`, `XIAOZE-ACTION-AUTHZ-001`, `XIAOZE-PERCEPTION-AUTHZ-001`
- Invalid evidence records: _none_
- Validation errors: `0`
- Validation error detail: _none_
- Evidence records: `62`
- Evidence index: docs/generated/acceptance-operation-evidence.md

### Artifact Paths

- test-results/acceptance/preflight-evidence.md
- test-results/acceptance/results.json
- test-results/acceptance
- playwright-report/acceptance
- docs/generated/acceptance-operation-evidence.md
- docs/generated/acceptance-operation-evidence/index.json

### Blockers

- Playwright acceptance did not pass.
- Workflow E did not pass browser acceptance.
- Workflow G did not pass browser acceptance.
- Workflow H did not pass browser acceptance.
- Workflow I did not pass browser acceptance.
- Operation evidence is missing required IDs: DEBUG-PERM-001, DEBUG-SIM-001, PERM-GOV-001, PERM-USER-MGMT-001, PFB-AUTHZ-001, XIAOZE-ACTION-AUTHZ-001, XIAOZE-PERCEPTION-AUTHZ-001.
- Acceptance preflight did not pass.
- Local non-HDC mode requires pilot_ready or non_hdc_local preflight outcome.
- Local non-HDC mode requires HDC to be skipped or absent.

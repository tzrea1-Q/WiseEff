## Browser Acceptance Evidence

- Date: 2026-07-16T03:04:00.890Z
- Branch: `fix/parameter-topology-e2e-review-blockers`
- Commit: `7a7c6b91392a6e5d74b080626dd002ffe4a2df46`
- Dirty worktree: `true`
- Mode: `local-non-hdc`
- Status: `failed`

### Preflight Result

- Status: `failed`
- Outcome: `blocked`
- HDC: `unknown`
- Evidence: test-results/acceptance/preflight-evidence.md
- Detail: > core-efficiency-prototype@0.1.0 acceptance:preflight
> tsx -- scripts/run-acceptance-preflight.ts --env-file .env --frontend-url http://127.0.0.1:5173 --evidence-out test-results/acceptance/preflight-evidence.md --no-start-runtime

## Acceptance Preflight Evidence

- Date: 2026-07-16T02:42:59.508Z
- Branch: `fix/parameter-topology-e2e-review-blockers`
- Commit: `7a7c6b91392a6e5d74b080626dd002ffe4a2df46`
- Dirty worktree: `true`
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
| docs:check | passed | ok |
| contract:check | passed | ok |
| test:all | failed | (node:18483) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.<br>(Use `node --trace-deprecation ...` to show where the warning was created)<br>Not implemented: Window's confirm() method<br>Not implemented: navigation to another Document<br>Not implemented: navigation to another Document<br><br>⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯<br><br> FAIL  server/modules/parameter-topology/ingestService.test.ts > ingestConfigRevision > never mutates a previous revision when ingesting again<br>Error: Test timed out in 5000ms.<br>If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".<br> ❯ server/modules/parameter-topology/ingestService.test.ts:332:3<br>    330\|   });<br>    331\|<br>    332\|   it("never mutates a previous revision when ingesting again", async (…<br>       \|   ^<br>    333\|     const manifest = goldenManifest();<br>    334\|     for (const member of manifest.members) {<br><br>⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯<br><br><br><br>> core-efficiency-prototype@0.1.0 test:all<br>> npm test && npm run test:server<br><br><br>> core-efficiency-prototype@0.1.0 test<br>> NODE_OPTIONS='--max-old-space-size=768' tsx scripts/run-vitest.ts<br><br><br> RUN  v4.1.5 /Users/tzrea1/Develop/WiseEff<br><br> ❯ server/modules/parameter-topology/ingestService.test.ts (4 tests \| 1 failed) 14771ms<br>     × never mutates a previous revision when ingesting again 5034ms<br><br> Test Files  1 failed \| 506 passed (507)<br>      Tests  1 failed \| 3523 passed \| 1 skipped (3525)<br>   Start at  10:40:19<br>   Duration  132.70s (transform 22.94s, setup 103.58s, import 147.71s, tests 349.15s, environment 469.23s) |
| build | passed | ok |
| git diff --check | passed | ok |
| health live | passed | ok |
| health ready | passed | database, object store, worker, and agent are ready. |
| current user | passed | ok |
| pilot readiness | failed | Pilot-readiness is blocked by: deviceGateway, backups. |
| frontend | passed | http://127.0.0.1:5173 returned 200. |

### Playwright Result

- Status: `failed`
- Evidence: playwright-report/acceptance/index.html
- Detail: (node:20145) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:20145) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:21080) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:21080) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22238) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22238) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24980) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24980) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24997) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24997) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27488) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27488) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27494) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27494) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27519) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27519) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27525) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27525) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28681) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28681) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:29385) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:29385) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30084) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30084) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30747) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30747) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31817) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31817) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32779) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32779) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32834) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32834) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32869) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32869) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32921) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32921) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33267) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33267) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33858) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33858) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34332) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34332) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:35036) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:35036) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:35319) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:35319) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36440) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36440) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:37500) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:37500) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:38551) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:38551) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39505) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39505) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:40649) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:40649) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:41609) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:41609) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:42650) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:42650) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


> core-efficiency-prototype@0.1.0 acceptance:e2e
> playwright test --config playwright.acceptance.config.ts


Running 85 tests using 1 worker

  ✓   1 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:154:3 › ADB device-lab preflight validation › discovers the only ready ADB target without requiring a target override (3ms)
  ✓   2 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:163:3 › ADB device-lab preflight validation › rejects multiple ready ADB targets before configuration (2ms)
  ✓   3 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:172:3 › ADB device-lab preflight validation › validates optional smoke overrides against discovered configuration (1ms)
  ✓   4 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:188:3 › ADB device-lab preflight validation › resolves write confirmation requirements after auto configuration (1ms)
  ✓   5 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:205:3 › ADB device-lab preflight validation › resolves one ADB inventory row and one shared default smoke binding from the database (3ms)
  ✓   6 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:227:3 › ADB device-lab preflight validation › rejects missing ADB inventory rows with redacted diagnostics (1ms)
  ✓   7 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:235:3 › ADB device-lab preflight validation › rejects non-readable default smoke bindings (0ms)
  ✓   8 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:254:3 › ADB device-lab preflight validation › rejects additional ready ADB devices before a hardware run (1ms)
  ✓   9 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:270:3 › ADB device-lab preflight validation › preserves debugging sessions that still own device leases during cleanup (4ms)
  ✓  10 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:292:3 › ADB device-lab preflight validation › requires explicit write and rollback confirmations when write mode is enabled (1ms)
  ✓  11 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:319:3 › ADB device-lab evidence redaction › shape-summarizes operation and audit identifiers (2ms)
  ✓  12 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:361:3 › ADB device-lab evidence redaction › shape-summarizes identifier-bearing API evidence paths (1ms)
  ✓  13 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:371:3 › ADB device-lab evidence redaction › shape-summarizes target identifiers in failure diagnostics (2ms)
  ✓  14 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:378:3 › ADB device-lab evidence redaction › shape-summarizes API error bodies and operation failure reasons (1ms)
  -  15 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:939:3 › ADB device-lab full-chain loop › detects and reads a real ADB target, with optional write/readback/rollback
  ✓  16 [Desktop Chrome] › e2e/acceptance/auth-runtime.acceptance.spec.ts:10:3 › M5.5 auth runtime parity › loads API-mode browser current user with the local dev auth contract (4.4s)
  ✘  17 [Desktop Chrome] › e2e/acceptance/debugging-admin.acceptance.spec.ts:194:3 › DEBUG-ADMIN-001 debugging admin catalog governance › debugging admin manages an API-backed HDC/ADB catalog node (4.0s)
  ✘  18 [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:455:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence (31.4s)
  ✘  19 [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:547:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls (31.4s)
  ✘  20 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:325:3 › DTS structured product browser acceptance › structure, typed editor contract, search, config-set/baseline, and structured diff (3.5s)
  ✓  21 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:596:3 › DTS structured product browser acceptance › structured edit submit preserves rawText through review merge and CST writeback (3.3s)
  ✓  22 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:761:3 › DTS structured product browser acceptance › structural impact kinds when DTS bindings exist (199ms)
  ✓  23 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:887:3 › DTS structured product browser acceptance › sensitive-node RBAC denies missing capability; agent critical deny is enforced (145ms)
  ✓  24 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:92:3 › HDC device-lab preflight validation › discovers the only connected HDC target without requiring target override (117ms)
  ✓  25 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:98:3 › HDC device-lab preflight validation › rejects multiple HDC targets before automatic configuration (110ms)
  ✓  26 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:102:3 › HDC device-lab preflight validation › auto-prepares a lab-only HDC inventory row and safe temporary smoke binding (114ms)
  ✓  27 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:127:3 › HDC device-lab preflight validation › disables non-lab HDC bindings before frontend auto-read can touch real hardware (105ms)
  ✓  28 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:147:3 › HDC device-lab preflight validation › requires explicit write and rollback confirmations before writing HDC hardware (89ms)
  -  29 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:773:3 › M5.4 manual flow F - HDC device-lab loop › drives /node-debugging through HDC read, write/readback, audit, and snapshot rollback
  ✓  30 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:202:3 › MOD-TREE hierarchical module acceptance › nested parameter modules support subtree filtering for assigned parameters (171ms)
  ✓  31 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:275:3 › MOD-TREE hierarchical module acceptance › admin can move parameter modules and cycle moves are rejected (161ms)
  ✓  32 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:344:3 › MOD-TREE hierarchical module acceptance › nested debug node modules support subtree filtering for assigned nodes (127ms)
  ✓  33 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:411:3 › MOD-TREE hierarchical module acceptance › module tree mutations require admin and non-empty modules cannot be deleted (147ms)
  -  34 [Desktop Chrome] › e2e/acceptance/local-device-bridge.acceptance.spec.ts:181:3 › local device bridge conditional acceptance › pairs bridge and runs bridge-backed detect/read/(optional) write
  -  35 [Desktop Chrome] › e2e/acceptance/local-device-bridge.acceptance.spec.ts:333:3 › local device bridge conditional acceptance › real bridge HDC path (device lab stub)
  ✓  36 [Desktop Chrome] › e2e/acceptance/log-analysis.acceptance.spec.ts:246:3 › M5.4 manual flow D - log analysis browser acceptance › uploads, completes, links evidence, audits feedback, archives, and records unsupported upload failure (6.9s)
  ✓  37 [Desktop Chrome] › e2e/acceptance/log-analysis.acceptance.spec.ts:355:3 › M5.4 manual flow D - log analysis browser acceptance › reruns a completed log and records run, job progress, audit, and operation evidence (3.8s)
  ✓  38 [Desktop Chrome] › e2e/acceptance/notifications.acceptance.spec.ts:11:3 › Notification center acceptance › loads inbox APIs and opens the TopBar notification panel (2.8s)
  ✓  39 [Desktop Chrome] › e2e/acceptance/notifications.acceptance.spec.ts:50:3 › Notification center acceptance › marks all notifications read through the API (3.0s)
  ✘  40 [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:232:3 › project parameter files browser acceptance › uploads, lists, and syncs project parameter files (108ms)
  ✘  41 [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:331:3 › project parameter files browser acceptance › resolves file/UI draft conflicts (124ms)
  ✘  42 [Desktop Chrome] › e2e/acceptance/parameter-home.acceptance.spec.ts:10:3 › parameter-home production dashboard › loads summary and hotspots APIs and renders in-page dashboard controls (3.5s)
  ✘  43 [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:31:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-DTS-FULL-001 parses full DTS with @address modules via parse-dts (127ms)
  ✓  44 [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:88:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-REVIEW-META-001 stores skippedRows in import preview audit metadata (126ms)
  ✓  45 [Desktop Chrome] › e2e/acceptance/parameter-import-wizard.acceptance.spec.ts:31:3 › PARAM-ADMIN-002 parameter import wizard browser acceptance › runs the five-step import wizard through preview (3.9s)
  ✓  46 [Desktop Chrome] › e2e/acceptance/parameter-topology.acceptance.spec.ts:112:3 › Parameter topology / schema browser acceptance › governs specs, browses real topology, edits, maps identity, and gates publish (6.9s)
  ✘  47 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:172:3 › M5.5 parameter negative-path browser acceptance › blocks blank draft reasons before API submission (11.7s)
  ✘  48 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:190:3 › M5.5 parameter negative-path browser acceptance › edits a draft item and removes another item before final submission (11.6s)
  ✘  49 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:277:3 › M5.5 parameter negative-path browser acceptance › defaults every workflow assignee slot to an eligible active non-admin user and hides ineligible users (16.6s)
  ✘  50 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:320:3 › M5.5 parameter negative-path browser acceptance › rejects forced invalid workflow assignees at the API boundary (142ms)
  ✘  51 [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:268:3 › M5.4 manual flow B/C - parameter management browser acceptance › searches, drafts, submits, reviews, persists, audits, and opens admin import preview (1.6m)
  ✘  52 [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:438:3 › M5.4 manual flow B/C - parameter management browser acceptance › rejects a submitted parameter request and persists rejection reason and audit evidence (14.4s)
  ✘  53 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest (10.6s)
  ✘  54 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User (10.8s)
  ✘  55 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software User (10.8s)
  ✓  56 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware Committer (857ms)
  ✓  57 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software Committer (794ms)
  ✓  58 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Admin (787ms)
  ✓  59 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:112:3 › M5.5 permissions matrix browser acceptance › keeps API-backed workflow eligibility stricter than visible role inclusion (125ms)
  ✘  60 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:190:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin (14.2s)
  ✘  61 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:246:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access (14.3s)
  ✘  62 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:347:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication (3.1s)
  ✓  63 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:237:3 › Product feedback browser acceptance › submits sidebar feedback with an optional image and persists it (3.9s)
  ✓  64 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:308:3 › Product feedback browser acceptance › lets Admin list, open, triage, close, and note feedback (3.5s)
  ✘  65 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access (10.6s)
  ✓  66 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads / without a runtime crash (4.4s)
  ✓  67 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameter-home without a runtime crash (2.9s)
  ✓  68 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameters without a runtime crash (3.0s)
  ✓  69 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameter-review without a runtime crash (816ms)
  ✓  70 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameter-admin without a runtime crash (2.8s)
  ✓  71 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /logs without a runtime crash (2.9s)
  ✓  72 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /log-admin without a runtime crash (2.9s)
  ✓  73 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /debugging without a runtime crash (3.0s)
  ✘  74 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /node-debugging without a runtime crash (3.1s)
  ✓  75 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /debugging-admin without a runtime crash (2.7s)
  ✓  76 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /user-permissions without a runtime crash (2.9s)
  ✘  77 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:227:3 › Xiaoze P1 action › approves a parameter change through the approval chain (20.4s)
  ✘  78 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:303:3 › Xiaoze P1 action › resumes with AG-UI native resume entries after interrupt (21.4s)
  ✘  79 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:405:3 › Xiaoze P1 action › rejects a parameter change without mutation (18.2s)
  ✘  80 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:455:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message (17.6s)
  ✓  81 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:169:3 › Xiaoze P0 perception › returns a grounded answer for an in-scope project question (13.0s)
  ✘  82 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:194:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question (12.1s)
  ✘  83 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:225:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests (10.9s)
  ✘  84 [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:219:3 › Xiaoze P2 planning › completes a multi-step task through approval and observe loop (18.1s)
  ✘  85 [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:287:3 › Xiaoze P2 planning › returns grounded proactive suggestions when enabled and nothing for unauthorized scope (59ms)


  1) [Desktop Chrome] › e2e/acceptance/debugging-admin.acceptance.spec.ts:194:3 › DEBUG-ADMIN-001 debugging admin catalog governance › debugging admin manages an API-backed HDC/ADB catalog node

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByText('已保存')
    Expected: visible
    Error: strict mode violation: getByText('已保存') resolved to 2 elements:
        1) <span class="debug-admin-save-indicator visible">已保存</span> aka getByLabel('调试管理后台页面操作').getByText('已保存')
        2) <span class="kpi-value">已保存</span> aka getByLabel('参数管理后台指标').getByText('已保存')

    Call log:
    [2m  - Expect "toBeVisible" with timeout 30000ms[22m
    [2m  - waiting for getByText('已保存')[22m


      208 |     await createDialog.getByLabel("简述").fill("Acceptance debug node");
      209 |     await createDialog.getByRole("button", { name: "保存" }).click();
    > 210 |     await expect(page.getByText("已保存")).toBeVisible({ timeout: 30_000 });
          |                                         ^
      211 |
      212 |     await configureProtocolBindings(page, nodeName, suffix);
      213 |     await expect(nodeRow(page, nodeName)).toBeVisible();
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-admin.acceptance.spec.ts:210:41

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/debugging-admin.acceptance-62f10-backed-HDC-ADB-catalog-node-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/debugging-admin.acceptance-62f10-backed-HDC-ADB-catalog-node-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/debugging-admin.acceptance-62f10-backed-HDC-ADB-catalog-node-Desktop-Chrome/error-context.md

    Error Context: test-results/acceptance/debugging-admin.acceptance-62f10-backed-HDC-ADB-catalog-node-Desktop-Chrome/error-context.md

    attachment #6: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/debugging-admin.acceptance-62f10-backed-HDC-ADB-catalog-node-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/debugging-admin.acceptance-62f10-backed-HDC-ADB-catalog-node-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  2) [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:455:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence

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


      296 |   const devicePill = page.locator(".topbar .device-pill").first();
      297 |   await expect(devicePill).toBeVisible({ timeout: 30_000 });
    > 298 |   await expect(devicePill).toContainText("Aurora Simulator 1", { timeout: 30_000 });
          |                            ^
      299 |   await expect(devicePill.locator(".live-dot")).toHaveCount(1);
      300 | }
      301 |
        at expectSimulatorOnline (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:298:28)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:460:5

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

  3) [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:547:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls

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


      296 |   const devicePill = page.locator(".topbar .device-pill").first();
      297 |   await expect(devicePill).toBeVisible({ timeout: 30_000 });
    > 298 |   await expect(devicePill).toContainText("Aurora Simulator 1", { timeout: 30_000 });
          |                            ^
      299 |   await expect(devicePill.locator(".live-dot")).toHaveCount(1);
      300 | }
      301 |
        at expectSimulatorOnline (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:298:28)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/debugging-simulator.acceptance.spec.ts:552:5

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

  4) [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:325:3 › DTS structured product browser acceptance › structure, typed editor contract, search, config-set/baseline, and structured diff

    error: update or delete on table "project_parameter_file_versions" violates foreign key constraint "dts_config_revision_members_file_version_id_fkey" on table "dts_config_revision_members"

      271 |           );
      272 |         }
    > 273 |         await client.query(`delete from project_parameter_file_versions where file_id = any($1::text[])`, [fileIds]);
          |         ^
      274 |         await client.query(`delete from project_parameter_files where id = any($1::text[])`, [fileIds]);
      275 |       }
      276 |     }
        at /Users/tzrea1/Develop/WiseEff/node_modules/pg/lib/client.js:646:17
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/dts-structured.acceptance.spec.ts:273:9
        at withPgClient (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/database.ts:38:12)
        at cleanupDtsAcceptanceArtifacts (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/dts-structured.acceptance.spec.ts:197:3)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/dts-structured.acceptance.spec.ts:581:7

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/attachments/operation-evidence-6c75b2ddb657a39422cd681e41a37f8e368bfce7.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/attachments/operation-evidence-eedab2a22a1a7cef21cb0f8256c6e5eba787bca3.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #4: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/attachments/operation-evidence-653e0cb41c38230ff8b1b27eab087db5efeb5cad.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #5: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/attachments/operation-evidence-a470bb64d42c280f8f0952ad9821c5afc72d8fb8.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #6: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/attachments/operation-evidence-7c796846c9b8678b8473a15cb1c77de8efde89ae.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #7: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #8: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/error-context.md

    attachment #10: trace (application/zip) ────────────────────────────────────────────────────────
    test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/dts-structured.acceptance--48cbe-aseline-and-structured-diff-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  5) [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:232:3 › project parameter files browser acceptance › uploads, lists, and syncs project parameter files

    error: update or delete on table "project_parameter_file_versions" violates foreign key constraint "dts_config_revision_members_file_version_id_fkey" on table "dts_config_revision_members"

      170 |         [fileIds]
      171 |       );
    > 172 |       await client.query(
          |       ^
      173 |         `
      174 |         delete from project_parameter_file_versions
      175 |         where file_id = any($1::text[])
        at /Users/tzrea1/Develop/WiseEff/node_modules/pg/lib/client.js:646:17
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:172:7
        at withPgClient (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/database.ts:38:12)
        at cleanupParameterFileAcceptanceArtifacts (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:115:3)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:221:7
        at withPgClient (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/database.ts:38:12)
        at cleanupAllParameterFileAcceptanceArtifacts (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:208:3)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:228:5

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameter-files.acceptance-5de3c-ncs-project-parameter-files-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameter-files.acceptance-5de3c-ncs-project-parameter-files-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameter-files.acceptance-5de3c-ncs-project-parameter-files-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameter-files.acceptance-5de3c-ncs-project-parameter-files-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameter-files.acceptance-5de3c-ncs-project-parameter-files-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  6) [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:331:3 › project parameter files browser acceptance › resolves file/UI draft conflicts

    error: update or delete on table "project_parameter_file_versions" violates foreign key constraint "dts_config_revision_members_file_version_id_fkey" on table "dts_config_revision_members"

      170 |         [fileIds]
      171 |       );
    > 172 |       await client.query(
          |       ^
      173 |         `
      174 |         delete from project_parameter_file_versions
      175 |         where file_id = any($1::text[])
        at /Users/tzrea1/Develop/WiseEff/node_modules/pg/lib/client.js:646:17
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:172:7
        at withPgClient (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/database.ts:38:12)
        at cleanupParameterFileAcceptanceArtifacts (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:115:3)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:221:7
        at withPgClient (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/database.ts:38:12)
        at cleanupAllParameterFileAcceptanceArtifacts (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:208:3)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-files.acceptance.spec.ts:228:5

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameter-files.acceptance-fa70a-ves-file-UI-draft-conflicts-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameter-files.acceptance-fa70a-ves-file-UI-draft-conflicts-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameter-files.acceptance-fa70a-ves-file-UI-draft-conflicts-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameter-files.acceptance-fa70a-ves-file-UI-draft-conflicts-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameter-files.acceptance-fa70a-ves-file-UI-draft-conflicts-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  7) [Desktop Chrome] › e2e/acceptance/parameter-home.acceptance.spec.ts:10:3 › parameter-home production dashboard › loads summary and hotspots APIs and renders in-page dashboard controls

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByText(/近 7 天/)
    Expected: visible
    Error: strict mode violation: getByText(/近 7 天/) resolved to 2 elements:
        1) <button role="radio" tabindex="0" type="button" data-state="on" data-spacing="0" aria-checked="true" data-size="default" data-variant="default" data-slot="toggle-group-item" data-radix-collection-item="" class="shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/to…>近 7 天</button> aka getByRole('radio', { name: '近 7 天' })
        2) <span class="parameter-home__panel-subtitle">近 7 天 · 3 个热区</span> aka getByText('近 7 天 · 3 个热区')

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByText(/近 7 天/)[22m


      35 |
      36 |     await page.getByRole("radio", { name: "近 7 天" }).first().click();
    > 37 |     await expect(page.getByText(/近 7 天/)).toBeVisible();
         |                                           ^
      38 |
      39 |     await page.getByRole("radio", { name: "模块榜" }).first().click();
      40 |     await expect(page.getByRole("radio", { name: "模块榜" }).first()).toHaveAttribute("aria-checked", "true");
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-home.acceptance.spec.ts:37:43

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameter-home.acceptance--9a112--in-page-dashboard-controls-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameter-home.acceptance--9a112--in-page-dashboard-controls-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameter-home.acceptance--9a112--in-page-dashboard-controls-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameter-home.acceptance--9a112--in-page-dashboard-controls-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameter-home.acceptance--9a112--in-page-dashboard-controls-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  8) [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:31:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-DTS-FULL-001 parses full DTS with @address modules via parse-dts

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

    Expected: [32m400[39m
    Received: [31m200[39m

      55 |       }
      56 |     });
    > 57 |     expect(includeResponse.status()).toBe(400);
         |                                      ^
      58 |     const includeBody = (await includeResponse.json()) as { error: { details?: { code?: string } } };
      59 |     expect(includeBody.error.details?.code).toBe("dts-include-unsupported");
      60 |
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:57:38

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameter-import-dts-td035-b4105-dress-modules-via-parse-dts-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameter-import-dts-td035-b4105-dress-modules-via-parse-dts-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameter-import-dts-td035-b4105-dress-modules-via-parse-dts-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameter-import-dts-td035-b4105-dress-modules-via-parse-dts-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameter-import-dts-td035-b4105-dress-modules-via-parse-dts-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  9) [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:172:3 › M5.5 parameter negative-path browser acceptance › blocks blank draft reasons before API submission

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

    Locator: locator('.parameters-table').filter({ hasText: 'fast_charge_current_limit_ma' }).first()
    Expected substring: [32m"fast_charge_current_limit_ma"[39m
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for locator('.parameters-table').filter({ hasText: 'fast_charge_current_limit_ma' }).first()[22m


      102 | async function openParameterDraftDialog(page: Page, targetValue: string) {
      103 |   await page.goto(`/parameters?project=${projectId}`);
    > 104 |   await expect(searchTable(page)).toContainText(parameterName);
          |                                   ^
      105 |   await searchTable(page).locator(".view-row-button").first().click();
      106 |   await page.locator(".parameter-detail-dialog__actions .button.primary").click();
      107 |
        at openParameterDraftDialog (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters-negative.acceptance.spec.ts:104:35)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters-negative.acceptance.spec.ts:175:25

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-a909d-asons-before-API-submission-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-a909d-asons-before-API-submission-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameters-negative.accept-a909d-asons-before-API-submission-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-a909d-asons-before-API-submission-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameters-negative.accept-a909d-asons-before-API-submission-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  10) [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:190:3 › M5.5 parameter negative-path browser acceptance › edits a draft item and removes another item before final submission

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

    Locator: locator('.parameters-table').filter({ hasText: 'fast_charge_current_limit_ma' }).first()
    Expected substring: [32m"fast_charge_current_limit_ma"[39m
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for locator('.parameters-table').filter({ hasText: 'fast_charge_current_limit_ma' }).first()[22m


      192 |     // @operation PARAM-DRAFT-EDIT-001
      193 |     await page.goto(`/parameters?project=${projectId}`);
    > 194 |     await expect(searchTable(page)).toContainText(parameterName);
          |                                     ^
      195 |
      196 |     await parameterRow(page, parameterName).locator(".edit-row-button").click();
      197 |     const draftDialog = page.locator(".parameter-draft-dialog");
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters-negative.acceptance.spec.ts:194:37

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-6cb0e-tem-before-final-submission-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-6cb0e-tem-before-final-submission-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameters-negative.accept-6cb0e-tem-before-final-submission-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-6cb0e-tem-before-final-submission-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameters-negative.accept-6cb0e-tem-before-final-submission-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  11) [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:277:3 › M5.5 parameter negative-path browser acceptance › defaults every workflow assignee slot to an eligible active non-admin user and hides ineligible users

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

    Locator: locator('.parameters-table').filter({ hasText: 'fast_charge_current_limit_ma' }).first()
    Expected substring: [32m"fast_charge_current_limit_ma"[39m
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for locator('.parameters-table').filter({ hasText: 'fast_charge_current_limit_ma' }).first()[22m


      102 | async function openParameterDraftDialog(page: Page, targetValue: string) {
      103 |   await page.goto(`/parameters?project=${projectId}`);
    > 104 |   await expect(searchTable(page)).toContainText(parameterName);
          |                                   ^
      105 |   await searchTable(page).locator(".view-row-button").first().click();
      106 |   await page.locator(".parameter-detail-dialog__actions .button.primary").click();
      107 |
        at openParameterDraftDialog (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters-negative.acceptance.spec.ts:104:35)
        at createOneValidDraft (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters-negative.acceptance.spec.ts:116:23)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters-negative.acceptance.spec.ts:282:5

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-ef68d--and-hides-ineligible-users-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-ef68d--and-hides-ineligible-users-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameters-negative.accept-ef68d--and-hides-ineligible-users-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-ef68d--and-hides-ineligible-users-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameters-negative.accept-ef68d--and-hides-ineligible-users-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  12) [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:320:3 › M5.5 parameter negative-path browser acceptance › rejects forced invalid workflow assignees at the API boundary

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

    Expected: [32m400[39m
    Received: [31m409[39m

      341 |     });
      342 |
    > 343 |     expect(response.status()).toBe(400);
          |                               ^
      344 |     await expect(response.json()).resolves.toMatchObject({
      345 |       error: { code: "VALIDATION_FAILED" }
      346 |     });
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters-negative.acceptance.spec.ts:343:31

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-4ad38-signees-at-the-API-boundary-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-4ad38-signees-at-the-API-boundary-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameters-negative.accept-4ad38-signees-at-the-API-boundary-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameters-negative.accept-4ad38-signees-at-the-API-boundary-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameters-negative.accept-4ad38-signees-at-the-API-boundary-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  13) [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:268:3 › M5.4 manual flow B/C - parameter management browser acceptance › searches, drafts, submits, reviews, persists, audits, and opens admin import preview

    [31mTest timeout of 90000ms exceeded.[39m

    Error: locator.click: Test timeout of 90000ms exceeded.
    Call log:
    [2m  - waiting for getByRole('complementary', { name: '审阅详情' }).getByRole('button', { name: '推进流程' })[22m
    [2m    - locator resolved to <button type="button" data-slot="button" data-size="default" data-variant="default" class="group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-…>…</button>[22m
    [2m  - attempting click action[22m
    [2m    - waiting for element to be visible, enabled and stable[22m
    [2m    - element is visible, enabled and stable[22m
    [2m    - scrolling into view if needed[22m
    [2m    - done scrolling[22m
    [2m    - <div class="submission-dialog submission-detail-dialog">…</div> from <div role="dialog" aria-modal="true" class="modal-backdrop" aria-labelledby="submission-detail-title">…</div> subtree intercepts pointer events[22m
    [2m  - retrying click action[22m
    [2m    - waiting for element to be visible, enabled and stable[22m
    [2m    - element is visible, enabled and stable[22m
    [2m    - scrolling into view if needed[22m
    [2m    - done scrolling[22m
    [2m    - <div role="dialog" aria-modal="true" class="modal-backdrop" aria-labelledby="submission-detail-title">…</div> intercepts pointer events[22m
    [2m  - retrying click action[22m
    [2m    - waiting 20ms[22m
    [2m    2 × waiting for element to be visible, enabled and stable[22m
    [2m      - element is visible, enabled and stable[22m
    [2m      - scrolling into view if needed[22m
    [2m      - done scrolling[22m
    [2m      - <div class="submission-dialog submission-detail-dialog">…</div> from <div role="dialog" aria-modal="true" class="modal-backdrop" aria-labelledby="submission-detail-title">…</div> subtree intercepts pointer events[22m
    [2m    - retrying click action[22m
    [2m      - waiting 100ms[22m
    [2m    42 × waiting for element to be visible, enabled and stable[22m
    [2m       - element is visible, enabled and stable[22m
    [2m       - scrolling into view if needed[22m
    [2m       - done scrolling[22m
    [2m       - <div class="submission-dialog submission-detail-dialog">…</div> from <div role="dialog" aria-modal="true" class="modal-backdrop" aria-labelledby="submission-detail-title">…</div> subtree intercepts pointer events[22m
    [2m     - retrying click action[22m
    [2m       - waiting 500ms[22m
    [2m       - waiting for element to be visible, enabled and stable[22m
    [2m       - element is visible, enabled and stable[22m
    [2m       - scrolling into view if needed[22m
    [2m       - done scrolling[22m
    [2m       - <div role="dialog" aria-modal="true" class="modal-backdrop" aria-labelledby="submission-detail-title">…</div> intercepts pointer events[22m
    [2m     - retrying click action[22m
    [2m       - waiting 500ms[22m
    [2m       - waiting for element to be visible, enabled and stable[22m
    [2m       - element is visible, enabled and stable[22m
    [2m       - scrolling into view if needed[22m
    [2m       - done scrolling[22m
    [2m       - <div class="submission-dialog submission-detail-dialog">…</div> from <div role="dialog" aria-modal="true" class="modal-backdrop" aria-labelledby="submission-detail-title">…</div> subtree intercepts pointer events[22m
    [2m     - retrying click action[22m
    [2m       - waiting 500ms[22m
    [2m       - waiting for element to be visible, enabled and stable[22m
    [2m       - element is visible, enabled and stable[22m
    [2m       - scrolling into view if needed[22m
    [2m       - done scrolling[22m
    [2m       - <div class="submission-dialog submission-detail-dialog">…</div> from <div role="dialog" aria-modal="true" class="modal-backdrop" aria-labelledby="submission-detail-title">…</div> subtree intercepts pointer events[22m
    [2m     - retrying click action[22m
    [2m       - waiting 500ms[22m


      319 |     const reviewDetail = page.getByRole("complementary", { name: "审阅详情" });
      320 |     await expect(reviewDetail.locator(".vertical-timeline-item--current")).toContainText(/硬件(?:Committer|MDE)检视/);
    > 321 |     await reviewDetail.getByRole("button", { name: "推进流程" }).click();
          |                                                              ^
      322 |     await expect(reviewDetail.locator(".vertical-timeline-item--current")).toContainText(/软件(?:Committer|MDE)检视/);
      323 |     await reviewDetail.getByRole("button", { name: "推进流程" }).click();
      324 |     await expect(reviewDetail.locator(".vertical-timeline-item--current")).toContainText(/软件(?:User|开发人员?)合入/);
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters.acceptance.spec.ts:321:62

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameters.acceptance-M5-4-66394--opens-admin-import-preview-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameters.acceptance-M5-4-66394--opens-admin-import-preview-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameters.acceptance-M5-4-66394--opens-admin-import-preview-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameters.acceptance-M5-4-66394--opens-admin-import-preview-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameters.acceptance-M5-4-66394--opens-admin-import-preview-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  14) [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:438:3 › M5.4 manual flow B/C - parameter management browser acceptance › rejects a submitted parameter request and persists rejection reason and audit evidence

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

    Locator: locator('.review-detail')
    Expected substring: [32m"6c5905a4-a334-46fb-9ae0-1b625ccc3d06"[39m
    Received string:    [31m"Aurora 量产平台charge_voltage_limit_mv目标模块为 Charging Policy，由 Xu Yun 提交。查看提交详情（1 项变更）审阅摘要charge_voltage_limit_mv 从 4350 调整为 4333。影响面parametercharge_voltage_limit_mvChanges Charging Policy parameter from 4350 to 4333.HighmoduleCharging PolicyHigh risk module review recommended.High变更历史流程 1当前流程硬件MDE检视当前处理人：Wang Jie。流程 2软件MDE检视软件 MDE：Sun Mei。流程 3软件开发人员合入软件开发人员：Liu Min。推进流程打回修改"[39m
    Timeout: 10000ms

    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for locator('.review-detail')[22m
    [2m    14 × locator resolved to <aside aria-label="审阅详情" class="review-detail">…</aside>[22m
    [2m       - unexpected value "Aurora 量产平台charge_voltage_limit_mv目标模块为 Charging Policy，由 Xu Yun 提交。查看提交详情（1 项变更）审阅摘要charge_voltage_limit_mv 从 4350 调整为 4333。影响面parametercharge_voltage_limit_mvChanges Charging Policy parameter from 4350 to 4333.HighmoduleCharging PolicyHigh risk module review recommended.High变更历史流程 1当前流程硬件MDE检视当前处理人：Wang Jie。流程 2软件MDE检视软件 MDE：Sun Mei。流程 3软件开发人员合入软件开发人员：Liu Min。推进流程打回修改"[22m


      448 |
      449 |     const reviewDetail = page.locator(".review-detail");
    > 450 |     await expect(reviewDetail).toContainText(requestId);
          |                                ^
      451 |     await reviewDetail.locator(".action-panel button").last().click();
      452 |
      453 |     const rejectDialog = page.locator(".rejection-dialog");
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameters.acceptance.spec.ts:450:32

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameters.acceptance-M5-4-20c26-n-reason-and-audit-evidence-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameters.acceptance-M5-4-20c26-n-reason-and-audit-evidence-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameters.acceptance-M5-4-20c26-n-reason-and-audit-evidence-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameters.acceptance-M5-4-20c26-n-reason-and-audit-evidence-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameters.acceptance-M5-4-20c26-n-reason-and-audit-evidence-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  15) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest

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

  16) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User

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

  17) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software User

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
    test-results/acceptance/permissions-matrix.accepta-82a0c-rmissions-for-Software-User-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-82a0c-rmissions-for-Software-User-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/permissions-matrix.accepta-82a0c-rmissions-for-Software-User-Desktop-Chrome/error-context.md

    attachment #5: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/permissions-matrix.accepta-82a0c-rmissions-for-Software-User-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/permissions-matrix.accepta-82a0c-rmissions-for-Software-User-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  18) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:190:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByRole('heading', { name: 'Permission denied' })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByRole('heading', { name: 'Permission denied' })[22m


      226 |
      227 |     await setPrototypeRole(page, "Hardware User");
    > 228 |     await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
          |                                                                            ^
      229 |     await expect(page.getByText("Current role: Hardware User")).toBeVisible();
      230 |     await expect(page.getByText("Required role: Admin")).toBeVisible();
      231 |     await expect(page.getByRole("region", { name: "用户权限" })).toHaveCount(0);
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions.acceptance.spec.ts:228:76

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

  19) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:246:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access

    Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

    Locator: getByRole('heading', { name: 'Permission denied' })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByRole('heading', { name: 'Permission denied' })[22m


      301 |
      302 |     await setPrototypeRole(page, "Software User");
    > 303 |     await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
          |                                                                            ^
      304 |     await expect(page.getByText("Current role: Software User")).toBeVisible();
      305 |     await expect(page.getByText("Required role: Admin")).toBeVisible();
      306 |     await expect(page.getByRole("table", { name: "平台用户" })).toHaveCount(0);
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions.acceptance.spec.ts:303:76

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

  20) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:347:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

    Expected: [32m401[39m
    Received: [31m200[39m

      353 |     const invalidBody = (await invalidResponse.json()) as { error?: { code?: string; message?: string } };
      354 |
    > 355 |     expect(invalidResponse.status()).toBe(401);
          |                                      ^
      356 |     expect(invalidBody.error).toMatchObject({
      357 |       code: "UNAUTHENTICATED"
      358 |     });
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/permissions.acceptance.spec.ts:355:38

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

  21) [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access

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

  22) [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /node-debugging without a runtime crash

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

    attachment #2: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/shell-navigation.acceptanc-989b2-ing-without-a-runtime-crash-Desktop-Chrome/attachments/operation-evidence-9a2228447c4bcff06cb98d79ab5c99eff7e246db.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/shell-navigation.acceptanc-989b2-ing-without-a-runtime-crash-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #4: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/shell-navigation.acceptanc-989b2-ing-without-a-runtime-crash-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/shell-navigation.acceptanc-989b2-ing-without-a-runtime-crash-Desktop-Chrome/error-context.md

    attachment #6: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/shell-navigation.acceptanc-989b2-ing-without-a-runtime-crash-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/shell-navigation.acceptanc-989b2-ing-without-a-runtime-crash-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  23) [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:227:3 › Xiaoze P1 action › approves a parameter change through the approval chain

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeTruthy[2m()[22m

    Received: [31mundefined[39m

      244 |     expect(started.status).toBe(200);
      245 |     const interruptValue = readInterruptValue(started.events);
    > 246 |     expect(interruptValue?.approvalId).toBeTruthy();
          |                                        ^
      247 |
      248 |     const resumed = await postXiaoze(request, adminHeaders(), {
      249 |       threadId,
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-action.acceptance.spec.ts:246:40

    Error Context: test-results/acceptance/xiaoze-action.acceptance-X-d1ba6--through-the-approval-chain-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-action.acceptance-X-d1ba6--through-the-approval-chain-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-action.acceptance-X-d1ba6--through-the-approval-chain-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  24) [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:303:3 › Xiaoze P1 action › resumes with AG-UI native resume entries after interrupt

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeTruthy[2m()[22m

    Received: [31m""[39m

      321 |     const interruptValue = readInterruptValue(started.events);
      322 |     const approvalId = String(interruptValue?.approvalId ?? "");
    > 323 |     expect(approvalId).toBeTruthy();
          |                        ^
      324 |
      325 |     const finished = started.events.find((event) => event.type === "RUN_FINISHED");
      326 |     const outcome = finished?.outcome as { interrupts?: Array<{ id?: string }> } | undefined;
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-action.acceptance.spec.ts:323:24

    Error Context: test-results/acceptance/xiaoze-action.acceptance-X-25f48-ume-entries-after-interrupt-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-action.acceptance-X-25f48-ume-entries-after-interrupt-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-action.acceptance-X-25f48-ume-entries-after-interrupt-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  25) [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:405:3 › Xiaoze P1 action › rejects a parameter change without mutation

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeTruthy[2m()[22m

    Received: [31mundefined[39m

      419 |     });
      420 |     const interruptValue = readInterruptValue(started.events);
    > 421 |     expect(interruptValue?.approvalId).toBeTruthy();
          |                                        ^
      422 |
      423 |     const resumed = await postXiaoze(request, adminHeaders(), {
      424 |       threadId: `${threadId}-reject`,
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-action.acceptance.spec.ts:421:40

    Error Context: test-results/acceptance/xiaoze-action.acceptance-X-28780-ter-change-without-mutation-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-action.acceptance-X-28780-ter-change-without-mutation-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-action.acceptance-X-28780-ter-change-without-mutation-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  26) [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:455:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeTruthy[2m()[22m

    Received: [31mundefined[39m

      469 |     });
      470 |     const interruptValue = readInterruptValue(started.events);
    > 471 |     expect(interruptValue?.approvalId).toBeTruthy();
          |                                        ^
      472 |
      473 |     const resumed = await postXiaoze(request, readOnlyHeaders(), {
      474 |       threadId: `${threadId}-authz`,
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-action.acceptance.spec.ts:471:40

    Error Context: test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  27) [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:194:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoMatch[2m([22m[32mexpected[39m[2m)[22m

    Expected pattern: [32m/not permitted|cannot|无权限|forbidden/[39m
    Received string:  [31m"i'm not able to share details for the **secret-project**. access to this project's parameters and configurations is restricted, and i won't retrieve or summarize them.·[39m
    [31mif you have a specific task related to this project that you're authorized to work on, please:[39m
    [31m- confirm that you have explicit permission to view its details, and[39m
    [31m- specify a concrete question (e.g., a particular parameter name, module, or node) so i can attempt the lookup with the appropriate context.·[39m
    [31motherwise, i'm happy to help with other projects you have access to. let me know how you'd like to proceed."[39m

      203 |     expect(result.status).toBe(200);
      204 |     const answer = readSseText(result.body);
    > 205 |     expect(answer.toLowerCase()).toMatch(/not permitted|cannot|无权限|forbidden/);
          |                                  ^
      206 |     expect(answer.toLowerCase()).not.toMatch(/secret-project: \d+ parameters/);
      207 |
      208 |     await recordOperationEvidence({
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-perception.acceptance.spec.ts:205:34

    Error Context: test-results/acceptance/xiaoze-perception.acceptan-c3a42-t-of-scope-project-question-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-perception.acceptan-c3a42-t-of-scope-project-question-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-perception.acceptan-c3a42-t-of-scope-project-question-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  28) [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:225:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

    Expected: [32m401[39m
    Received: [31m200[39m

      225 |   test("rejects unauthenticated xiaoze requests", async ({ request }) => {
      226 |     const result = await postXiaozeQuestion(request, { "Content-Type": "application/json", Accept: "text/event-stream" }, "hello");
    > 227 |     expect(result.status).toBe(401);
          |                           ^
      228 |   });
      229 | });
      230 |
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-perception.acceptance.spec.ts:227:27

    Error Context: test-results/acceptance/xiaoze-perception.acceptan-9fea8-thenticated-xiaoze-requests-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-perception.acceptan-9fea8-thenticated-xiaoze-requests-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-perception.acceptan-9fea8-thenticated-xiaoze-requests-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  29) [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:219:3 › Xiaoze P2 planning › completes a multi-step task through approval and observe loop

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeTruthy[2m()[22m

    Received: [31mundefined[39m

      237 |     expect(started.status).toBe(200);
      238 |     const interruptValue = readInterruptValue(started.events);
    > 239 |     expect(interruptValue?.approvalId).toBeTruthy();
          |                                        ^
      240 |
      241 |     const resumed = await postXiaoze(request, adminHeaders(), {
      242 |       threadId: thread,
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-planning.acceptance.spec.ts:239:40

    Error Context: test-results/acceptance/xiaoze-planning.acceptance-85c52-h-approval-and-observe-loop-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-planning.acceptance-85c52-h-approval-and-observe-loop-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-planning.acceptance-85c52-h-approval-and-observe-loop-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  30) [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:287:3 › Xiaoze P2 planning › returns grounded proactive suggestions when enabled and nothing for unauthorized scope

    error: insert or update on table "parameter_change_requests" violates foreign key constraint "parameter_change_requests_parameter_definition_id_fkey"

      199 |     }
      200 |
    > 201 |     await client.query(
          |     ^
      202 |       `
      203 |       insert into parameter_change_requests (
      204 |         id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
        at /Users/tzrea1/Develop/WiseEff/node_modules/pg/lib/client.js:646:17
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-planning.acceptance.spec.ts:201:5
        at withPgClient (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/helpers/database.ts:38:12)
        at ensureOpenChangeRequestForSuggest (/Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-planning.acceptance.spec.ts:185:3)
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-planning.acceptance.spec.ts:289:5

    Error Context: test-results/acceptance/xiaoze-planning.acceptance-5b9b4-hing-for-unauthorized-scope-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-planning.acceptance-5b9b4-hing-for-unauthorized-scope-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-planning.acceptance-5b9b4-hing-for-unauthorized-scope-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  30 failed
    [Desktop Chrome] › e2e/acceptance/debugging-admin.acceptance.spec.ts:194:3 › DEBUG-ADMIN-001 debugging admin catalog governance › debugging admin manages an API-backed HDC/ADB catalog node
    [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:455:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence
    [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:547:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls
    [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:325:3 › DTS structured product browser acceptance › structure, typed editor contract, search, config-set/baseline, and structured diff
    [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:232:3 › project parameter files browser acceptance › uploads, lists, and syncs project parameter files
    [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:331:3 › project parameter files browser acceptance › resolves file/UI draft conflicts
    [Desktop Chrome] › e2e/acceptance/parameter-home.acceptance.spec.ts:10:3 › parameter-home production dashboard › loads summary and hotspots APIs and renders in-page dashboard controls
    [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:31:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-DTS-FULL-001 parses full DTS with @address modules via parse-dts
    [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:172:3 › M5.5 parameter negative-path browser acceptance › blocks blank draft reasons before API submission
    [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:190:3 › M5.5 parameter negative-path browser acceptance › edits a draft item and removes another item before final submission
    [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:277:3 › M5.5 parameter negative-path browser acceptance › defaults every workflow assignee slot to an eligible active non-admin user and hides ineligible users
    [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:320:3 › M5.5 parameter negative-path browser acceptance › rejects forced invalid workflow assignees at the API boundary
    [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:268:3 › M5.4 manual flow B/C - parameter management browser acceptance › searches, drafts, submits, reviews, persists, audits, and opens admin import preview
    [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:438:3 › M5.4 manual flow B/C - parameter management browser acceptance › rejects a submitted parameter request and persists rejection reason and audit evidence
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software User
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:190:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:246:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:347:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication
    [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access
    [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /node-debugging without a runtime crash
    [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:227:3 › Xiaoze P1 action › approves a parameter change through the approval chain
    [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:303:3 › Xiaoze P1 action › resumes with AG-UI native resume entries after interrupt
    [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:405:3 › Xiaoze P1 action › rejects a parameter change without mutation
    [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:455:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message
    [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:194:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question
    [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:225:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests
    [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:219:3 › Xiaoze P2 planning › completes a multi-step task through approval and observe loop
    [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:287:3 › Xiaoze P2 planning › returns grounded proactive suggestions when enabled and nothing for unauthorized scope
  4 skipped
  51 passed (21.0m)

### Workflow Table

| ID | Workflow | Status | Notes | Artifacts |
| --- | --- | --- | --- | --- |
| A | Shell navigation and access | failed | Core routes load without visible runtime crashes. | playwright-report/acceptance/index.html |
| B | Parameter management loop | failed | Parameter browser workflow coverage is reported by Playwright specs. | playwright-report/acceptance/index.html |
| C | Parameter admin governance | failed | Admin governance and audit drawer coverage is reported by Playwright specs. | playwright-report/acceptance/index.html |
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
- Covered operation IDs: `30`
- Missing operation IDs: `DEBUG-ADMIN-001`, `DEBUG-PERM-001`, `DEBUG-SIM-001`, `PARAM-ADMIN-001`, `PARAM-ASSIGNEE-001`, `PARAM-ASSIGNEE-002`, `PARAM-ASSIGNEE-003`, `PARAM-DRAFT-EDIT-001`, `PARAM-FILE-RESOLVE-001`, `PARAM-FILE-SYNC-001`, `PARAM-FILE-UPLOAD-001`, `PARAM-HAPPY-001`, `PARAM-HOME-001`, `PARAM-IMPORT-DTS-FULL-001`, `PARAM-REASON-001`, `PARAM-REJECT-001`, `PERM-GOV-001`, `PERM-USER-MGMT-001`, `PFB-AUTHZ-001`, `XIAOZE-ACTION-APPROVE-001`, `XIAOZE-ACTION-AUTHZ-001`, `XIAOZE-ACTION-REJECT-001`, `XIAOZE-ACTION-RESUME-001`, `XIAOZE-PERCEPTION-AUTHZ-001`
- Invalid evidence records: `PARAM-ADMIN-002`, `PARAM-DTS-IMPACT-001`, `PARAM-DTS-RBAC-001`, `PARAM-IMPORT-REVIEW-META-001`, `XIAOZE-PERCEPTION-001`
- Validation errors: `9`
- PARAM-ADMIN-002 assertions: Evidence is missing required operation assertions: audit.
- PARAM-ADMIN-002 audit: Audit assertions require at least one audit event summary.
- PARAM-DTS-IMPACT-001 artifacts: Evidence requires at least one artifact.
- PARAM-DTS-RBAC-001 artifacts: Evidence requires at least one artifact.
- PARAM-IMPORT-REVIEW-META-001 artifacts: Evidence requires at least one artifact.
- PARAM-IMPORT-REVIEW-META-001 api: API assertions require at least one API request/response summary.
- PARAM-IMPORT-REVIEW-META-001 db: DB assertions require at least one database assertion summary.
- PARAM-IMPORT-REVIEW-META-001 audit: Audit assertions require at least one audit event summary.
- XIAOZE-PERCEPTION-001 artifacts: Evidence requires at least one artifact.
- Evidence records: `42`
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
- Workflow A did not pass browser acceptance.
- Workflow B did not pass browser acceptance.
- Workflow C did not pass browser acceptance.
- Workflow E did not pass browser acceptance.
- Workflow G did not pass browser acceptance.
- Workflow H did not pass browser acceptance.
- Workflow I did not pass browser acceptance.
- Operation evidence is missing required IDs: DEBUG-ADMIN-001, DEBUG-PERM-001, DEBUG-SIM-001, PARAM-ADMIN-001, PARAM-ASSIGNEE-001, PARAM-ASSIGNEE-002, PARAM-ASSIGNEE-003, PARAM-DRAFT-EDIT-001, PARAM-FILE-RESOLVE-001, PARAM-FILE-SYNC-001, PARAM-FILE-UPLOAD-001, PARAM-HAPPY-001, PARAM-HOME-001, PARAM-IMPORT-DTS-FULL-001, PARAM-REASON-001, PARAM-REJECT-001, PERM-GOV-001, PERM-USER-MGMT-001, PFB-AUTHZ-001, XIAOZE-ACTION-APPROVE-001, XIAOZE-ACTION-AUTHZ-001, XIAOZE-ACTION-REJECT-001, XIAOZE-ACTION-RESUME-001, XIAOZE-PERCEPTION-AUTHZ-001.
- Operation evidence records are missing review or forensic metadata: PARAM-ADMIN-002, PARAM-DTS-IMPACT-001, PARAM-DTS-RBAC-001, PARAM-IMPORT-REVIEW-META-001, XIAOZE-PERCEPTION-001.
- Acceptance preflight did not pass.
- Local non-HDC mode requires pilot_ready or non_hdc_local preflight outcome.
- Local non-HDC mode requires HDC to be skipped or absent.

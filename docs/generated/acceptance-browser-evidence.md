## Browser Acceptance Evidence

- Date: 2026-07-17T05:43:08.255Z
- Branch: `fix/parameter-topology-round6-review-blockers`
- Commit: `03029314ceb2796661f74452b5af135d3512e003`
- Dirty worktree: `true`
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

- Date: 2026-07-17T05:31:05.790Z
- Branch: `fix/parameter-topology-round6-review-blockers`
- Commit: `03029314ceb2796661f74452b5af135d3512e003`
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
| api runtime | passed | already listening at http://127.0.0.1:8787/health/live |
| frontend runtime | passed | already listening at http://127.0.0.1:5173 |
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
- Detail: (node:8743) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:8743) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9190) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9190) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9682) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9682) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:10175) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:10175) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11184) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11184) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11928) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11928) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11970) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11970) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12006) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12006) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12226) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12226) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12413) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12413) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12575) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12575) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12776) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12776) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12854) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12854) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13199) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13199) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13560) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13560) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13901) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13901) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


> core-efficiency-prototype@0.1.0 acceptance:e2e
> playwright test --config playwright.acceptance.config.ts


Running 85 tests using 1 worker

  ✓   1 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:154:3 › ADB device-lab preflight validation › discovers the only ready ADB target without requiring a target override (2ms)
  ✓   2 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:163:3 › ADB device-lab preflight validation › rejects multiple ready ADB targets before configuration (1ms)
  ✓   3 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:172:3 › ADB device-lab preflight validation › validates optional smoke overrides against discovered configuration (1ms)
  ✓   4 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:188:3 › ADB device-lab preflight validation › resolves write confirmation requirements after auto configuration (0ms)
  ✓   5 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:205:3 › ADB device-lab preflight validation › resolves one ADB inventory row and one shared default smoke binding from the database (1ms)
  ✓   6 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:227:3 › ADB device-lab preflight validation › rejects missing ADB inventory rows with redacted diagnostics (0ms)
  ✓   7 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:235:3 › ADB device-lab preflight validation › rejects non-readable default smoke bindings (0ms)
  ✓   8 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:254:3 › ADB device-lab preflight validation › rejects additional ready ADB devices before a hardware run (1ms)
  ✓   9 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:270:3 › ADB device-lab preflight validation › preserves debugging sessions that still own device leases during cleanup (3ms)
  ✓  10 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:292:3 › ADB device-lab preflight validation › requires explicit write and rollback confirmations when write mode is enabled (0ms)
  ✓  11 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:319:3 › ADB device-lab evidence redaction › shape-summarizes operation and audit identifiers (2ms)
  ✓  12 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:361:3 › ADB device-lab evidence redaction › shape-summarizes identifier-bearing API evidence paths (1ms)
  ✓  13 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:371:3 › ADB device-lab evidence redaction › shape-summarizes target identifiers in failure diagnostics (2ms)
  ✓  14 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:378:3 › ADB device-lab evidence redaction › shape-summarizes API error bodies and operation failure reasons (1ms)
  -  15 [Desktop Chrome] › e2e/acceptance/adb-device-lab.acceptance.spec.ts:939:3 › ADB device-lab full-chain loop › detects and reads a real ADB target, with optional write/readback/rollback
  ✓  16 [Desktop Chrome] › e2e/acceptance/auth-runtime.acceptance.spec.ts:10:3 › M5.5 auth runtime parity › loads API-mode browser current user with the local dev auth contract (3.0s)
  ✘  17 [Desktop Chrome] › e2e/acceptance/debugging-admin.acceptance.spec.ts:194:3 › DEBUG-ADMIN-001 debugging admin catalog governance › debugging admin manages an API-backed HDC/ADB catalog node (2.5s)
  ✘  18 [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:455:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence (31.4s)
  ✘  19 [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:547:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls (31.4s)
  ✓  20 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:269:3 › DTS structured product browser acceptance › structure, typed editor contract, search, config-set/baseline, and structured diff (2.7s)
  ✓  21 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:536:3 › DTS structured product browser acceptance › structured edit submit preserves rawText through review merge and CST writeback (2.2s)
  ✓  22 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:701:3 › DTS structured product browser acceptance › structural impact kinds when DTS bindings exist (232ms)
  ✓  23 [Desktop Chrome] › e2e/acceptance/dts-structured.acceptance.spec.ts:825:3 › DTS structured product browser acceptance › sensitive-node RBAC denies missing capability; agent critical deny is enforced (159ms)
  ✓  24 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:92:3 › HDC device-lab preflight validation › discovers the only connected HDC target without requiring target override (86ms)
  ✓  25 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:98:3 › HDC device-lab preflight validation › rejects multiple HDC targets before automatic configuration (96ms)
  ✓  26 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:102:3 › HDC device-lab preflight validation › auto-prepares a lab-only HDC inventory row and safe temporary smoke binding (92ms)
  ✓  27 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:127:3 › HDC device-lab preflight validation › disables non-lab HDC bindings before frontend auto-read can touch real hardware (101ms)
  ✓  28 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:147:3 › HDC device-lab preflight validation › requires explicit write and rollback confirmations before writing HDC hardware (89ms)
  -  29 [Desktop Chrome] › e2e/acceptance/hdc-device-lab.acceptance.spec.ts:773:3 › M5.4 manual flow F - HDC device-lab loop › drives /node-debugging through HDC read, write/readback, audit, and snapshot rollback
  ✓  30 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:202:3 › MOD-TREE hierarchical module acceptance › nested parameter modules support subtree filtering for assigned parameters (167ms)
  ✓  31 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:275:3 › MOD-TREE hierarchical module acceptance › admin can move parameter modules and cycle moves are rejected (175ms)
  ✓  32 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:344:3 › MOD-TREE hierarchical module acceptance › nested debug node modules support subtree filtering for assigned nodes (125ms)
  ✓  33 [Desktop Chrome] › e2e/acceptance/hierarchical-modules.acceptance.spec.ts:411:3 › MOD-TREE hierarchical module acceptance › module tree mutations require admin and non-empty modules cannot be deleted (149ms)
  -  34 [Desktop Chrome] › e2e/acceptance/local-device-bridge.acceptance.spec.ts:181:3 › local device bridge conditional acceptance › pairs bridge and runs bridge-backed detect/read/(optional) write
  -  35 [Desktop Chrome] › e2e/acceptance/local-device-bridge.acceptance.spec.ts:333:3 › local device bridge conditional acceptance › real bridge HDC path (device lab stub)
  ✓  36 [Desktop Chrome] › e2e/acceptance/log-analysis.acceptance.spec.ts:246:3 › M5.4 manual flow D - log analysis browser acceptance › uploads, completes, links evidence, audits feedback, archives, and records unsupported upload failure (7.0s)
  ✓  37 [Desktop Chrome] › e2e/acceptance/log-analysis.acceptance.spec.ts:355:3 › M5.4 manual flow D - log analysis browser acceptance › reruns a completed log and records run, job progress, audit, and operation evidence (4.8s)
  ✓  38 [Desktop Chrome] › e2e/acceptance/notifications.acceptance.spec.ts:11:3 › Notification center acceptance › loads inbox APIs and opens the TopBar notification panel (2.2s)
  ✓  39 [Desktop Chrome] › e2e/acceptance/notifications.acceptance.spec.ts:50:3 › Notification center acceptance › marks all notifications read through the API (2.2s)
  ✓  40 [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:161:3 › project parameter files browser acceptance › uploads, lists, and syncs project parameter files (2.5s)
  ✓  41 [Desktop Chrome] › e2e/acceptance/parameter-files.acceptance.spec.ts:272:3 › project parameter files browser acceptance › resolves file/UI draft conflicts (206ms)
  ✓  42 [Desktop Chrome] › e2e/acceptance/parameter-home.acceptance.spec.ts:10:3 › parameter-home production dashboard › loads summary and hotspots APIs and renders in-page dashboard controls (2.2s)
  ✓  43 [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:31:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-DTS-FULL-001 parses full DTS with @address modules via parse-dts (3.0s)
  ✓  44 [Desktop Chrome] › e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts:90:3 › PARAM-IMPORT-DTS-FULL / REVIEW-META parameter import DTS alignment › PARAM-IMPORT-REVIEW-META-001 stores skippedRows in import preview audit metadata (94ms)
  ✓  45 [Desktop Chrome] › e2e/acceptance/parameter-import-wizard.acceptance.spec.ts:31:3 › PARAM-ADMIN-002 parameter import wizard browser acceptance › runs the five-step import wizard through preview (3.5s)
  ✘  46 [Desktop Chrome] › e2e/acceptance/parameter-topology.acceptance.spec.ts:232:3 › Parameter topology / schema browser acceptance › governs specs, browses real topology, edits, maps identity, and gates publish (6.8s)
  ✓  47 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:180:3 › M5.5 parameter negative-path browser acceptance › blocks blank draft reasons before API submission (2.4s)
  ✓  48 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:240:3 › M5.5 parameter negative-path browser acceptance › edits a draft item and removes another item before final submission (2.6s)
  ✓  49 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:327:3 › M5.5 parameter negative-path browser acceptance › defaults every workflow assignee slot to an eligible active non-admin user and hides ineligible users (2.5s)
  ✓  50 [Desktop Chrome] › e2e/acceptance/parameters-negative.acceptance.spec.ts:376:3 › M5.5 parameter negative-path browser acceptance › rejects forced invalid workflow assignees at the API boundary (158ms)
  ✓  51 [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:268:3 › M5.4 manual flow B/C - parameter management browser acceptance › searches, drafts, submits, reviews, persists, audits, and opens admin import preview (8.1s)
  ✓  52 [Desktop Chrome] › e2e/acceptance/parameters.acceptance.spec.ts:439:3 › M5.4 manual flow B/C - parameter management browser acceptance › rejects a submitted parameter request and persists rejection reason and audit evidence (2.3s)
  ✘  53 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest (10.5s)
  ✘  54 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User (10.9s)
  ✘  55 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software User (10.9s)
  ✓  56 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware Committer (890ms)
  ✓  57 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software Committer (815ms)
  ✓  58 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Admin (877ms)
  ✓  59 [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:112:3 › M5.5 permissions matrix browser acceptance › keeps API-backed workflow eligibility stricter than visible role inclusion (129ms)
  ✘  60 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:190:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin (12.0s)
  ✘  61 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:246:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access (13.2s)
  ✘  62 [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:347:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication (2.8s)
  ✓  63 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:237:3 › Product feedback browser acceptance › submits sidebar feedback with an optional image and persists it (2.6s)
  ✓  64 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:308:3 › Product feedback browser acceptance › lets Admin list, open, triage, close, and note feedback (2.4s)
  ✘  65 [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access (10.6s)
  ✓  66 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads / without a runtime crash (2.4s)
  ✓  67 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameter-home without a runtime crash (2.4s)
  ✓  68 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameters without a runtime crash (2.6s)
  ✓  69 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameter-review without a runtime crash (789ms)
  ✓  70 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /parameter-admin without a runtime crash (2.3s)
  ✓  71 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /logs without a runtime crash (2.2s)
  ✓  72 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /log-admin without a runtime crash (2.2s)
  ✓  73 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /debugging without a runtime crash (2.2s)
  ✘  74 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /node-debugging without a runtime crash (2.3s)
  ✓  75 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /debugging-admin without a runtime crash (2.3s)
  ✓  76 [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /user-permissions without a runtime crash (2.3s)
  ✓  77 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:227:3 › Xiaoze P1 action › approves a parameter change through the approval chain (157ms)
  ✓  78 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:303:3 › Xiaoze P1 action › resumes with AG-UI native resume entries after interrupt (111ms)
  ✓  79 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:405:3 › Xiaoze P1 action › rejects a parameter change without mutation (48ms)
  ✘  80 [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:455:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message (52ms)
  ✓  81 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:169:3 › Xiaoze P0 perception › returns a grounded answer for an in-scope project question (39ms)
  ✘  82 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:194:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question (31ms)
  ✘  83 [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:225:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests (41ms)
  ✓  84 [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:232:3 › Xiaoze P2 planning › completes a multi-step task through approval and observe loop (136ms)
  ✓  85 [Desktop Chrome] › e2e/acceptance/xiaoze-planning.acceptance.spec.ts:300:3 › Xiaoze P2 planning › returns grounded proactive suggestions when enabled and nothing for unauthorized scope (36ms)


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

  4) [Desktop Chrome] › e2e/acceptance/parameter-topology.acceptance.spec.ts:232:3 › Parameter topology / schema browser acceptance › governs specs, browses real topology, edits, maps identity, and gates publish

    Error: PARAM-TOPOLOGY-EDIT-001 requires a dedicated post-cutover acceptance database; legacy writeback cannot prove semantic merge

    [2mexpect([22m[31mreceived[39m[2m).[22mtoBeTruthy[2m()[22m

    Received: [31mnull[39m

      669 |       semanticCutover,
      670 |       "PARAM-TOPOLOGY-EDIT-001 requires a dedicated post-cutover acceptance database; legacy writeback cannot prove semantic merge"
    > 671 |     ).toBeTruthy();
          |       ^
      672 |
      673 |     await resolveReviewsForCurrentRevision(request, revisionId, projectId);
      674 |     const editedRaw = "<&gpio13 30 0>";
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/parameter-topology.acceptance.spec.ts:671:7

    attachment #1: browser-diagnostics-enabled (text/plain) ────────────────────────────────────────
    Browser diagnostics are installed for unexpected console, page, request, and API failures.
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/parameter-topology.accepta-7f09b--identity-and-gates-publish-Desktop-Chrome/attachments/operation-evidence-208069834b2900179631a9adfa32e2392017d223.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #3: operation-evidence (application/json) ───────────────────────────────────────────
    test-results/acceptance/parameter-topology.accepta-7f09b--identity-and-gates-publish-Desktop-Chrome/attachments/operation-evidence-ce4a991c218d2fd25c7b0852de3c6334914769d7.json
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #4: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/acceptance/parameter-topology.accepta-7f09b--identity-and-gates-publish-Desktop-Chrome/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #5: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results/acceptance/parameter-topology.accepta-7f09b--identity-and-gates-publish-Desktop-Chrome/video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/acceptance/parameter-topology.accepta-7f09b--identity-and-gates-publish-Desktop-Chrome/error-context.md

    attachment #7: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/parameter-topology.accepta-7f09b--identity-and-gates-publish-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/parameter-topology.accepta-7f09b--identity-and-gates-publish-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  5) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest

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

  6) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User

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

  7) [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software User

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

  8) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:190:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin

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

  9) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:246:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access

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

  10) [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:347:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication

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

  11) [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access

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

  12) [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /node-debugging without a runtime crash

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
    test-results/acceptance/shell-navigation.acceptanc-989b2-ing-without-a-runtime-crash-Desktop-Chrome/attachments/operation-evidence-3d999f1626f98d9db6d636143997e07552841268.json
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

  13) [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:455:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoMatch[2m([22m[32mexpected[39m[2m)[22m

    Expected pattern: [32m/not permitted|forbidden|无权限/[39m
    Received string:  [31m"submitted parameter change request 1b7478e4-cfd7-4393-a24e-ba06dea30914 for review. [citation:parameter]"[39m

      488 |       .map((event) => String(event.delta ?? ""))
      489 |       .join("");
    > 490 |     expect(answer.toLowerCase()).toMatch(/not permitted|forbidden|无权限/);
          |                                  ^
      491 |     expect(await countOpenChangeRequests()).toBe(openBefore);
      492 |
      493 |     await recordOperationEvidence({
        at /Users/tzrea1/Develop/WiseEff/e2e/acceptance/xiaoze-action.acceptance.spec.ts:490:34

    Error Context: test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/trace.zip
    Usage:

        npx playwright show-trace test-results/acceptance/xiaoze-action.acceptance-X-896f1-ecution-with-a-safe-message-Desktop-Chrome/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────

  14) [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:194:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question

    Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoMatch[2m([22m[32mexpected[39m[2m)[22m

    Expected pattern: [32m/not permitted|cannot|无权限|forbidden/[39m
    Received string:  [31m"project secret-project: 0 parameters, 0 open change requests. [citation:parameter]"[39m

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

  15) [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:225:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests

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

  15 failed
    [Desktop Chrome] › e2e/acceptance/debugging-admin.acceptance.spec.ts:194:3 › DEBUG-ADMIN-001 debugging admin catalog governance › debugging admin manages an API-backed HDC/ADB catalog node
    [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:455:3 › M5.4 manual flow E - debugging simulator loop › reads, writes, detects mismatch, rolls back, and records audit evidence
    [Desktop Chrome] › e2e/acceptance/debugging-simulator.acceptance.spec.ts:547:3 › M5.4 manual flow E - debugging simulator loop › blocks node writes for non-writer roles in UI and forced API calls
    [Desktop Chrome] › e2e/acceptance/parameter-topology.acceptance.spec.ts:232:3 › Parameter topology / schema browser acceptance › governs specs, browses real topology, edits, maps identity, and gates publish
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Guest
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Hardware User
    [Desktop Chrome] › e2e/acceptance/permissions-matrix.acceptance.spec.ts:78:5 › M5.5 permissions matrix browser acceptance › enforces visible route permissions for Software User
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:190:3 › M5.4 manual flow H - permissions and user governance › loads users, shows role/status, and gates user governance to Admin
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:246:3 › M5.4 manual flow H - permissions and user governance › lets Admin manage a non-self user in UI while denying non-Admin access
    [Desktop Chrome] › e2e/acceptance/permissions.acceptance.spec.ts:347:3 › M5.4 manual flow H - permissions and user governance › protects API-mode user context with production bearer authentication
    [Desktop Chrome] › e2e/acceptance/product-feedback.acceptance.spec.ts:372:3 › Product feedback browser acceptance › blocks non-Admin feedback admin APIs and page access
    [Desktop Chrome] › e2e/acceptance/shell-navigation.acceptance.spec.ts:41:5 › M5.4 manual flow A - shell navigation › loads /node-debugging without a runtime crash
    [Desktop Chrome] › e2e/acceptance/xiaoze-action.acceptance.spec.ts:455:3 › Xiaoze P1 action › denies out-of-permission approval execution with a safe message
    [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:194:3 › Xiaoze P0 perception › does not leak data for an out-of-scope project question
    [Desktop Chrome] › e2e/acceptance/xiaoze-perception.acceptance.spec.ts:225:3 › Xiaoze P0 perception › rejects unauthenticated xiaoze requests
  4 skipped
  66 passed (12.0m)

### Workflow Table

| ID | Workflow | Status | Notes | Artifacts |
| --- | --- | --- | --- | --- |
| A | Shell navigation and access | failed | Core routes load without visible runtime crashes. | playwright-report/acceptance/index.html |
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
- Covered operation IDs: `45`
- Missing operation IDs: `DEBUG-ADMIN-001`, `DEBUG-PERM-001`, `DEBUG-SIM-001`, `PARAM-CONFIG-PUBLISH-GATE-001`, `PARAM-IDENTITY-MAP-001`, `PARAM-TOPOLOGY-EDIT-001`, `PERM-GOV-001`, `PERM-USER-MGMT-001`, `PFB-AUTHZ-001`, `XIAOZE-ACTION-AUTHZ-001`, `XIAOZE-PERCEPTION-AUTHZ-001`
- Invalid evidence records: `PARAM-ADMIN-002`, `PARAM-DTS-IMPACT-001`, `PARAM-DTS-RBAC-001`, `PARAM-FILE-RESOLVE-001`, `PARAM-FILE-SYNC-001`, `PARAM-FILE-UPLOAD-001`, `PARAM-IMPORT-DTS-FULL-001`, `PARAM-IMPORT-REVIEW-META-001`, `XIAOZE-ACTION-APPROVE-001`, `XIAOZE-ACTION-REJECT-001`, `XIAOZE-ACTION-RESUME-001`, `XIAOZE-PERCEPTION-001`, `XIAOZE-PLAN-MULTISTEP-001`, `XIAOZE-PROACTIVE-001`
- Validation errors: `20`
- PARAM-ADMIN-002 assertions: Evidence is missing required operation assertions: audit.
- PARAM-ADMIN-002 audit: Audit assertions require at least one audit event summary.
- PARAM-DTS-IMPACT-001 artifacts: Evidence requires at least one artifact.
- PARAM-DTS-RBAC-001 artifacts: Evidence requires at least one artifact.
- PARAM-FILE-RESOLVE-001 artifacts: Evidence requires at least one artifact.
- PARAM-FILE-RESOLVE-001 db: DB assertions require at least one database assertion summary.
- PARAM-FILE-SYNC-001 db: DB assertions require at least one database assertion summary.
- PARAM-FILE-UPLOAD-001 db: DB assertions require at least one database assertion summary.
- PARAM-IMPORT-DTS-FULL-001 api: API assertions require at least one API request/response summary.
- PARAM-IMPORT-REVIEW-META-001 artifacts: Evidence requires at least one artifact.
- PARAM-IMPORT-REVIEW-META-001 api: API assertions require at least one API request/response summary.
- PARAM-IMPORT-REVIEW-META-001 db: DB assertions require at least one database assertion summary.
- PARAM-IMPORT-REVIEW-META-001 audit: Audit assertions require at least one audit event summary.
- XIAOZE-ACTION-APPROVE-001 artifacts: Evidence requires at least one artifact.
- XIAOZE-ACTION-APPROVE-001 audit: Audit assertions require at least one audit event summary.
- XIAOZE-ACTION-REJECT-001 artifacts: Evidence requires at least one artifact.
- XIAOZE-ACTION-RESUME-001 artifacts: Evidence requires at least one artifact.
- XIAOZE-PERCEPTION-001 artifacts: Evidence requires at least one artifact.
- XIAOZE-PLAN-MULTISTEP-001 artifacts: Evidence requires at least one artifact.
- XIAOZE-PROACTIVE-001 artifacts: Evidence requires at least one artifact.
- Evidence records: `57`
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
- Workflow E did not pass browser acceptance.
- Workflow G did not pass browser acceptance.
- Workflow H did not pass browser acceptance.
- Workflow I did not pass browser acceptance.
- Operation evidence is missing required IDs: DEBUG-ADMIN-001, DEBUG-PERM-001, DEBUG-SIM-001, PARAM-CONFIG-PUBLISH-GATE-001, PARAM-IDENTITY-MAP-001, PARAM-TOPOLOGY-EDIT-001, PERM-GOV-001, PERM-USER-MGMT-001, PFB-AUTHZ-001, XIAOZE-ACTION-AUTHZ-001, XIAOZE-PERCEPTION-AUTHZ-001.
- Operation evidence records are missing review or forensic metadata: PARAM-ADMIN-002, PARAM-DTS-IMPACT-001, PARAM-DTS-RBAC-001, PARAM-FILE-RESOLVE-001, PARAM-FILE-SYNC-001, PARAM-FILE-UPLOAD-001, PARAM-IMPORT-DTS-FULL-001, PARAM-IMPORT-REVIEW-META-001, XIAOZE-ACTION-APPROVE-001, XIAOZE-ACTION-REJECT-001, XIAOZE-ACTION-RESUME-001, XIAOZE-PERCEPTION-001, XIAOZE-PLAN-MULTISTEP-001, XIAOZE-PROACTIVE-001.
- Acceptance preflight did not pass.
- Local non-HDC mode requires pilot_ready or non_hdc_local preflight outcome.
- Local non-HDC mode requires HDC to be skipped or absent.

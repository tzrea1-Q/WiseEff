# Browser Acceptance Coverage Map

> Chinese: [Chinese](../zh-CN/developer/browser-acceptance-coverage-map.md)

This map is the source of truth for requirement-level browser acceptance coverage. Any plan or PR that changes user-facing UI/API interaction behavior must name the affected acceptance IDs below. If no ID exists for the changed behavior, add one before implementation.

For operation-level coverage, also review [user-operation-coverage-matrix.md](user-operation-coverage-matrix.md). Requirement IDs explain the behavior that must be covered; operation IDs explain the concrete user action, role, route, assertion types, and automation status that prove it.

| ID | Workflow | Blocking | Expected User Behavior | Spec Owner |
| --- | --- | --- | --- | --- |
| `AUTH-RUNTIME-001` | A | Yes | API-mode browser runtime loads the current user with the same auth contract used by local development. | `e2e/acceptance/auth-runtime.acceptance.spec.ts` |
| `SHELL-DIAG-001` | A | Yes | Core routes fail acceptance on unexpected console errors, page errors, request failures, or critical WiseEff API `4xx/5xx` responses. | `e2e/acceptance/shell-navigation.acceptance.spec.ts`; shared diagnostics helper |
| `PARAM-REASON-001` | B | Yes | Parameter drafts cannot be submitted with an empty or blank reason. | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-001` | B | Yes | Parameter submission defaults every workflow slot to an eligible active non-admin user. | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-002` | B | Yes | Workflow assignee dropdowns hide inactive, guest, admin-only, and role-ineligible users. | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-ASSIGNEE-003` | B | Yes | Forced invalid workflow assignees are rejected at the API boundary and surfaced by the UI flow. | `e2e/acceptance/parameters-negative.acceptance.spec.ts` |
| `PARAM-HAPPY-001` | B | Yes | Parameter search, draft, submit, review, merge, persistence, and audit happy path works. | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `PARAM-ADMIN-001` | C | Yes | Parameter admin import preview and audit drawer remain available to Admin. | `e2e/acceptance/parameters.acceptance.spec.ts` |
| `LOG-HAPPY-001` | D | Yes | Log upload, analysis progress, evidence, feedback, archive, and unsupported-file path work. | `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| `DEBUG-SIM-001` | E | Yes | Simulator read, write, mismatch, rollback, and audit path work, including complex JSON value metadata. | `e2e/acceptance/debugging-simulator.acceptance.spec.ts` |
| `DEBUG-ADMIN-001` | E | Yes | Debugging admin can create, edit, archive, restore, and protocol-bind catalog parameters in API mode, including complex value metadata. | `e2e/acceptance/debugging-admin.acceptance.spec.ts` |
| `BRIDGE-WIN-001` | E | No | Node debugging Windows-first local bridge panel can show bridge-missing, pairing, startup, and online states with the same-origin Windows download CTA. | `e2e/acceptance/debugging-local-bridge.acceptance.spec.ts` |
| `BRIDGE-TOOLS-001` | C | No | Connected bridge with `tools.adb.available: false` shows tools-missing copy and install-tools CTA (not bridge-missing copy). | `src/NodeDebuggingPage.test.tsx` |
| `HDC-LAB-001` | F | No | Real HDC device lab read/write smoke runs when explicitly enabled. | `e2e/acceptance/hdc-device-lab.acceptance.spec.ts` |
| `AGENT-APPROVAL-001` | G | Yes | Agent context, approval, rejection, execution, and evidence path work. | `e2e/acceptance/agent.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-001` | G | Yes | Xiaoze answers grounded read-only questions using page context and perception tools. | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-PERCEPTION-AUTHZ-001` | G | Yes | Out-of-scope Xiaoze questions return a safe non-data answer. | `e2e/acceptance/xiaoze-perception.acceptance.spec.ts` |
| `XIAOZE-ACTION-APPROVE-001` | G | Yes | Xiaoze parameter change approval executes through the agent audit chain. | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-REJECT-001` | G | Yes | Rejecting a Xiaoze action approval does not mutate parameter state. | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-ACTION-AUTHZ-001` | G | Yes | Users without edit permission cannot approve Xiaoze mutating actions. | `e2e/acceptance/xiaoze-action.acceptance.spec.ts` |
| `XIAOZE-PLAN-MULTISTEP-001` | G | Yes | Xiaoze resumes a multi-step plan after approval and reports the observed execution result. | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `XIAOZE-PROACTIVE-001` | G | Yes | Opt-in Xiaoze proactive suggestions are read-only, authz-bounded, and absent when disabled. | `e2e/acceptance/xiaoze-planning.acceptance.spec.ts` |
| `PERM-GOV-001` | H | Yes | User governance page is Admin-only and the active Admin cannot disable itself. | `e2e/acceptance/permissions.acceptance.spec.ts` |
| `PERM-MATRIX-001` | H | Yes | Role inclusion rules are enforced for visible UI operations. | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |
| `PERM-MATRIX-002` | H | Yes | Role inclusion and project-scoped workflow eligibility are enforced by API-backed operations. | `e2e/acceptance/permissions-matrix.acceptance.spec.ts` |

## Interpretation

- `Blocking = Yes` means the ID must be covered by a Playwright acceptance marker before `npm run acceptance:coverage` can pass.
- `Blocking = No` means the ID is tracked, but may be skipped when the required external dependency is explicitly out of scope. Today this includes the HDC device lab and Windows local bridge runtime coverage.
- Coverage markers use comments in acceptance specs: `// @acceptance PARAM-REASON-001`.
- A workflow-level pass does not imply every row above is covered. The generated browser evidence must report requirement-level coverage before this map can be treated as satisfied.
- Operation markers use comments in acceptance specs: `// @operation PARAM-REASON-001`. Automated P0/P1 operation IDs must produce operation evidence under `docs/generated/acceptance-operation-evidence.md`.

## Supplemental Manual Evidence (Xiaoze P2)

Playwright acceptance covers `XIAOZE-PLAN-MULTISTEP-001` and `XIAOZE-PROACTIVE-001` at the API/SSE layer. Real-auth browser screenshots (development session, deterministic provider) are archived under `work/ui-checks/xiaoze-p2-*` and indexed in `docs/exec-plans/completed/2026-06-24-xiaoze-p2-planning.md` (Manual Browser Evidence).

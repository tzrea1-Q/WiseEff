# Compact application footer implementation plan

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-24-compact-application-footer.md)

**Status:** Completed 2026-08-24. Implementation and local verification are complete; merge is authorized under an owner-approved local-CI exception because GitHub Actions quota is unavailable.

## Goal

Add a low-emphasis footer to the bottom of every normal authenticated WiseEff page so users can identify the product owner and build version, open the existing product-feedback dialog, and optionally reach a deployment-configured external contact. Preserve the existing rich homepage footer and add only the same metadata/actions as a compact bottom row there.

The footer is page-ending content, not persistent chrome: it scrolls with the page, never uses fixed or sticky positioning, and must not cover Xiaoze, toasts, dialogs, or page actions.

## Locked product decisions

- The marketing homepage keeps its existing multi-column `TemplateFooter`; it gains one compact metadata/action row and must not render a second full application footer.
- Normal authenticated routes render one shared application footer from the application shell. Permission-denied and `NoEntryPage` results remain covered because they render inside that shell.
- The local default copyright owner is `雷泽（WiseEff）`; a production/self-hosted build may override it with the real legal entity name. The current Organization display name is never used as the copyright owner.
- The first release renders `© {current year} {owner}`, `版本 v{version}`, `问题反馈`, and an optional `联系我们` link.
- `问题反馈` opens the existing `FeedbackDialog` with the current route and page title. It is not renamed to `联系我们` because the form accepts product-feedback categories, not general enquiries.
- `联系我们` appears only when a valid external contact is configured. Its visible label is fixed. `https:` opens in a new tab with `noopener noreferrer`; `mailto:` uses the system mail client.
- Invalid or blank contact values render no contact link. Development emits a concise key-only warning; production does not expose configuration details to users.
- Desktop groups copyright/version on the left and actions on the right. Narrow layouts wrap naturally into two left-aligned rows. The component has no card container and uses a tokenized top divider, muted text, and low-emphasis links.
- No privacy policy, terms, filing-number page, social link, analytics, runtime administration UI, backend configuration API, or database field is introduced.

## Route boundary

### Included

- `/`: retain the rich homepage footer and append its compact metadata/action row.
- Every normal authenticated route rendered inside `main#main-content`, including deep links, permission refusals, and the two deliberate `NoEntryPage` routes.
- Representative acceptance routes are `/parameter-home`, `/parameters`, and `/feedback-admin`; shell-level parameterized coverage proves the remaining normal routes.

### Excluded

- The login/register screen, auth bootstrap skeleton, service-unavailable screen, and root `ErrorBoundary` fallback, which return before the normal application shell.
- `/parameter-admin/projects/:projectId/configuration`, whose full-height workbench owns an `overflow: hidden` layout and must not lose working height.
- `/downloads/*`, which is a static download handoff rather than a rendered SPA page.

Do not duplicate the configuration-workbench pathname regex. Export or introduce one shared route classifier and consume it from both `ParameterAdminNextPage` and the shell footer decision.

## Build-time configuration contract

Use the existing Vite build-time configuration model. All values are public presentation metadata, never secrets.

| Variable | Default | Rule |
| --- | --- | --- |
| `VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER` | `雷泽（WiseEff）` | Trim whitespace; fall back when blank. Production operators should set the real legal entity when known. |
| `VITE_WISEEFF_APP_VERSION` | root `package.json` `version` | Optional release-label override, rendered with exactly one leading `v`. |
| `VITE_WISEEFF_CONTACT_HREF` | blank | Accept only absolute `https:` and `mailto:` values. Blank or invalid means the link is absent. |

Create a small pure resolver with unit tests. It owns trimming, version-prefix normalization, protocol validation, and the development-only warning. Add the three keys to `ImportMetaEnv`, local and self-hosted examples, the self-hosted Docker build arguments/environment, Compose build arguments, and the bilingual environment-variable documentation. Self-hosted documentation must state that changing a `VITE_*` value requires rebuilding the frontend image.

## Architecture and expected files

| File | Planned responsibility |
| --- | --- |
| `src/config/appFooterConfig.ts` | Pure build-time footer configuration resolver and package-version fallback. |
| `src/config/appFooterConfig.test.ts` | Defaults, trimming, version override/prefix, `https:`, `mailto:`, blank, invalid protocol, and warning tests. |
| `src/components/common/AppFooter.tsx` | Shared footer content with an `onFeedback` callback: a semantic `<footer>` in the application shell and a non-landmark metadata container when nested in the homepage footer. |
| `src/components/common/AppFooter.test.tsx` | Content, current year, optional contact, safe external-link attributes, mail link behavior, feedback callback, and accessible link/button names. |
| `src/App.tsx` | Lift `FeedbackDialog` ownership from `Sidebar` to `AppShell`; pass one open callback to Sidebar and AppFooter; append the footer after normal page content; exclude the full-height workbench. |
| `src/App.test.tsx`, `src/App.skipLink.test.tsx` | Shell placement, route changes, current page context, included/excluded routes, single homepage footer, and landmark preservation. |
| `src/ParameterAdminNextPage.tsx` and a shared route helper/test | Remove the duplicated configuration-workbench pathname decision. |
| `src/linear-template/LinearTemplateHome.tsx` | Render the shared homepage metadata variant inside the existing rich footer. |
| `src/styles.css`, `src/linear-template/linear-template.css` | Token-only compact layout, link interaction states, wrapping, divider, and homepage integration. |
| `src/vite-env.d.ts` | Type the three public build variables. |
| `.env.example`, `ops/self-hosted/.env.example` | Document safe defaults and optional overrides. |
| `ops/self-hosted/Dockerfile`, `ops/self-hosted/compose.yaml` | Carry the build-time values into the Vite build. |

The dialog-lifting change is required: `Sidebar` currently owns `feedbackOpen` and mounts `FeedbackDialog`, so the footer cannot reuse the same current-page-aware interaction without duplicating dialog state. `AppShell` becomes the single dialog owner; Sidebar remains a trigger only.

## Implementation tasks

### Task 1: Register acceptance ownership before behavior changes

1. Add `SHELL-FOOTER-001` to the bilingual browser acceptance coverage maps.
2. Add its operation definition to `e2e/acceptance/operationMatrix.ts` and regenerate/update the bilingual operation matrices through the repository command rather than hand-editing generated rows.
3. Define the requirement as: all included routes expose one page-ending footer; the homepage does not duplicate it; feedback opens with current-page context; a configured external contact follows the approved protocol behavior; excluded full-screen/transient surfaces remain unchanged.
4. Keep `PFB-SUBMIT-001` as the evidence owner for actual feedback submission, API, database, audit, and screenshot assertions. `SHELL-FOOTER-001` owns only shell presence and entry behavior.

### Task 2: Implement and test the configuration resolver first

1. Write failing tests for defaults, package version, override normalization, accepted protocols, rejected protocols, and warning behavior.
2. Implement the pure resolver and `ImportMetaEnv` declarations.
3. Add local/self-hosted build-variable propagation and examples. Do not read runtime server environment variables from browser code.

### Task 3: Build the shared footer and feedback trigger seam

1. Write component tests before implementation.
2. Render semantic `<footer aria-label="页脚信息">` in the application shell; the homepage variant must render a non-landmark container inside the existing `<footer>` so landmarks are never nested. Use a button for `问题反馈` and an anchor only for a valid external contact.
3. Lift `FeedbackDialog` state and rendering to `AppShell`, preserving dirty-state confirmation, repository injection, route path, and page title.
4. Pass the same callback to Sidebar and the new footer so only one dialog instance exists.

### Task 4: Integrate route and homepage boundaries

1. Append the compact footer after `PageRouter` within the normal page scroll container; do not make it a fixed sibling below `.main-content`.
2. Use the shared route classifier to suppress it for the configuration workbench.
3. Add the non-landmark homepage metadata variant inside the existing `TemplateFooter` and assert there is exactly one footer landmark and one metadata set.
4. Verify route-change scroll reset remains unchanged and the SkipLink still targets the same `main` landmark.

### Task 5: Complete tokenized styling and responsive behavior

1. Use only existing color, typography, spacing, border, motion, and focus tokens; introduce no raw color, font size, shadow, or z-index.
2. Define rest, hover, active, and focus-visible states for the button and optional link.
3. Prove no horizontal overflow and no collision with Xiaoze or toast layers at all required viewports.

### Task 6: Update durable documentation and verify

1. Update bilingual frontend, environment-variable, product-functional-spec, acceptance-map, and operation-matrix documentation.
2. Run the focused tests, UI gates, build, documentation check, and browser walkthrough below.
3. Record exact results and screenshot paths in this plan before moving it to `completed/`.

## Verification plan

### Focused and repository checks

```bash
npm test -- src/config/appFooterConfig.test.ts src/components/common/AppFooter.test.tsx src/App.test.tsx src/App.skipLink.test.tsx
npm run ui:check
npm run build
npm run docs:check
```

Run the acceptance command that owns `e2e/acceptance/shell-navigation.acceptance.spec.ts` and generated operation evidence according to `docs/developer/verification-matrix.md`. Extend that spec to assert `SHELL-FOOTER-001` across its normal-route matrix, while asserting the homepage variant rather than a duplicate application footer.

### Real-browser walkthrough

Use API mode and `playwright-cli`. Capture both snapshots and screenshots under `work/ui-checks/compact-application-footer/` for:

- `/` — rich footer retained, compact metadata row present once.
- `/parameter-home` — short content and natural page-ending placement.
- `/parameters` — long content, scroll-to-footer, and feedback dialog with current-page context.
- `/feedback-admin` — Admin page layout.
- `/parameter-admin/projects/:projectId/configuration` — explicit proof that the compact footer is absent and workbench height is unchanged.

At `1440x900`, `768x1024`, and `390x844`, verify keyboard focus, feedback open/close, configured `https:` and `mailto:` variants, empty-contact omission, zero console errors, relevant network behavior, no overlap, and no horizontal overflow. External navigation should be inspected without sending a message or submitting data to an external party.

## Success criteria

- Every included page has exactly one page-ending footer, and every excluded surface remains unchanged.
- The homepage keeps its rich footer and shows the shared metadata/actions exactly once.
- Copyright owner, version override, and contact address are build-time configurable; defaults work without local setup.
- The displayed version follows the root package version unless explicitly overridden and never renders `vv...`.
- Invalid contact values fail closed without a broken user-visible link.
- Sidebar and footer open the same single feedback dialog with accurate page context.
- All styles use the design system and pass the three-viewport visual/accessibility checks.
- No backend, database, auth, security, or runtime-configuration API changes are introduced.

## UI Interaction Automation Review

- New requirement/operation: `SHELL-FOOTER-001`, owned by `e2e/acceptance/shell-navigation.acceptance.spec.ts` and the shell operation matrix.
- Existing operation retained: `PFB-SUBMIT-001` continues to prove feedback submission; this plan must not duplicate its API/DB/audit flow.
- Existing shell diagnostic requirement retained: `SHELL-DIAG-001` continues to fail on browser/page/request errors.
- Evidence generation impact: update `e2e/acceptance/operationMatrix.ts` and preserve evidence output through the standard `acceptance:browser` / `acceptance:evidence` workflow.

## Documentation Impact Matrix

| Area | Status | Evidence / planned action |
| --- | --- | --- |
| Repository maps and agent guidance | Review | `AGENTS.md`, `ARCHITECTURE.md`; expected unchanged because no new subsystem or routing model is introduced. |
| Planning and technical debt | Update | This plan, its Chinese companion, `docs/PLANS.md`, and `docs/zh-CN/PLANS.md`; no debt row unless implementation defers an accepted requirement. |
| Product specifications | Update | `docs/product-specs/prototype-functional-spec.md` and Chinese companion: add the second current-page feedback entry and footer boundary. |
| Architecture and domain model | No change | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md`, `CONTEXT.md`; presentation-only shell work adds no domain term or architecture decision. |
| API contracts | No change | `docs/design-docs/api-contract.md`, OpenAPI, and DTOs; no server endpoint changes. |
| Security and governance | Review | `docs/SECURITY.md`; expected unchanged. Contact protocol validation and safe external-link attributes are captured in frontend docs/tests. |
| Reliability and runbooks | Review | `docs/runbooks/self-hosted-runtime.md` and Chinese companion for the build-time/rebuild boundary; update only if the environment docs do not provide sufficient operator guidance. |
| Quality and testing | Update | Bilingual browser acceptance maps and generated operation matrices; review `docs/developer/verification-matrix.md` and update only if a new command is required. |
| Frontend and design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`; document the shared footer, lifted feedback-dialog ownership, route exceptions, and config resolver. Review `ui-design-system.md`; no token-scale change expected. |
| Environment variables | Update | `.env.example`, `ops/self-hosted/.env.example`, `docs/developer/environment-variables.md`, and Chinese companion; carry build args through Dockerfile/Compose. |
| Generated artifacts | Review | Generated operation coverage/evidence only; no schema or OpenAPI artifact change expected. |
| References | No change | `docs/references/`; no external protocol or product reference changes. |

## Documentation Update Gate

- [x] Every `Update` row has matching English/Chinese edits where a companion is required.
- [x] Every `Review` row was checked on the implementation tree. `AGENTS.md`, `ARCHITECTURE.md`, `docs/SECURITY.md`, the self-hosted runtime runbook, the verification matrix, UI design system, and generated schema/OpenAPI artifacts remain unchanged because this slice adds no subsystem, API, secret, runtime configuration service, token scale, or data model.
- [x] `npm run docs:check` passed after environment examples, bilingual links, and generated operation matrices were current.
- [x] No accepted requirement was deferred; no technical-debt row is required.
- [x] Exact verification and browser evidence are recorded below before archival.

## Completion evidence

- Focused Vitest: 5 files, 157 tests passed. Full `npm run test:all`: frontend 3041, scripts 830 (5 skipped), Bridge 138, and server 2735 (8 skipped) passed.
- Static/local CI checks passed: `npm run lint` (0 errors; 299 pre-existing warnings), `npm run ui:check`, `npm run build`, `npm run docs:check`, `npm run contract:check`, `npm run logs:eval` (16/16 plus 4/4 meta), `npm run selfhost:check`, `npm run acceptance:operations`, `npm run acceptance:coverage`, `npm run acceptance:ci`, and `npm run acceptance:quality`.
- Browser gates passed against an isolated API-mode runtime and disposable database: `npm run acceptance:quality-run` 97/97 and `npm run acceptance:smoke` 4/4. The complete shell-navigation command passed 27/27: 26/26 shell cases (the full normal-route matrix, both `NoEntryPage` cases, homepage, workbench exclusion, and permission refusal) plus runtime warmup 1/1. Focused operation evidence validation passed with both `SHELL-FOOTER-001` and `SHELL-DIAG-001` present.
- `playwright-cli` covered `/`, `/parameter-home`, `/parameters`, `/feedback-admin`, and `/parameter-admin/projects/aurora/configuration` at `1440x900`, `768x1024`, and `390x844`. Every route/viewport had a snapshot and screenshot under `work/ui-checks/compact-application-footer/`; no horizontal overflow, overlap, or console error was observed, and relevant API requests returned 200. The two CopilotKit license warnings were pre-existing non-error warnings.
- Footer feedback opened the single dialog with `/parameter-home` and its current title. Default contact omission, safe `https:` (`target="_blank"`, `noopener noreferrer`), and `mailto:` behavior were verified in separate builds without external submission. Representative evidence: `parameter-home-footer-1440x900.png` and `parameter-home-feedback-1440x900.png`.
- The initial complete quality run exposed an incomplete local demo seed; after running the required development M0 seed, the affected interaction visual group passed 6/6 and the full gate passed 97/97. The first smoke invocation lacked matching HMAC variables and was discarded; the correctly configured isolated rerun passed. Early focused shell runs corrected test-only browser assumptions (nested footer role mapping, duplicate Close controls, evidence ownership, and role-fixture setup) before the final 27/27 aggregate pass.

## Git & PR Workflow

Implementation starts from the latest `main` on `feat/compact-application-footer`. An implementation subagent may edit, test, and commit only on that feature branch; it must not open or merge a PR. The parent/session owner reviews Standards and Spec results, runs or spot-checks the final verification, opens the PR, merges after required checks pass, and synchronizes local `main`.

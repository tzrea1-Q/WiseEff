# Template-based bulk user creation

> Chinese: [用户模板批量创建方案](../../zh-CN/exec-plans/active/2026-11-07-user-bulk-import.md)

Date: 2026-11-07. Status: implementation authorized and in progress for [specification #1530](https://github.com/tzrea1-Q/WiseEff/issues/1530) and child tickets #1531–#1534. Source baseline: `dc1ede937`. After Q17 and specification/ticket publication, the user explicitly invoked `/implement-spec` for the complete feature with GPT-6.1 Terra subagents at extra-high reasoning effort and emphasized frontend delivery quality. This later instruction supersedes the earlier development hold retained in the decision history and tracker bodies. Implementers use isolated worktrees, TDD and the approved test seams; a single integration branch carries the feature through draft PR, independent review and readiness. Main merge, deployment and production account creation are not authorized.

## Goal and confirmed decisions

An administrator fills a downloadable user template and imports it to avoid creating many users individually.

| Decision | Confirmed answer |
| --- | --- |
| Q1 Meaning | The requested input is a user **template**, not business-module permissions. One row represents one intended new user |
| Q2 Scale | Occasional batches of at most 500 users. This is the requested design envelope, not measured capacity |
| Q3 Completion | Create enabled accounts that can log in immediately, not pending invitations |
| Q4 Authority and organization scope | One selected Organization per batch; keep existing organization/platform administrator permissions; no organization column |
| Q5 Assignment scope | Account information and organization roles only; no Team or Project assignments |
| Q6 Format | XLSX only, with Chinese headings, instructions and examples |
| Q7 Authentication | Local username/password accounts only; unavailable for OIDC deployments |
| Q8 Initial password | Required per row; privately delivered by the administrator, never displayed in previews, reports or audit |
| Q9 First login | Preserve voluntary password changes; no mandatory first-login reset |
| Q10 Confirmation | Read-only preflight and preview followed by one explicit confirmation |
| Q11 Failure/conflict behavior | Any invalid row or existing username rejects the whole batch; no overwrite or skipping |
| Q12 Role multiplicity | Multiple roles separated by a Chinese semicolon; blank roles fail |
| Q13 Privileged roles | Preserve current grant rules and highlight privileged rows |
| Q14 Columns | Name, username, initial password, title and organization roles; only title is optional |
| Q15 Result | On-page summary/row feedback and password-free XLSX result/error download |
| Q16 History | No import-history page; current result, existing audit and safe retry suffice; no durable workbook or plaintext password storage |
| Q17 Final confirmation | Complete plan confirmed on 2026-11-07; do not start development |

The [domain glossary](../../../CONTEXT.md) distinguishes this template from Modules, Organization membership, Teams, Project membership and review duties.

## Current implementation and reuse

- [Member management](../../../src/UserPermissionsPage.tsx) has single-account creation. [The client](../../../src/infrastructure/http/userGovernanceClient.ts) calls `POST /api/v1/users`; [routes](../../../server/modules/users/routes.ts) select local-password or OIDC provisioning according to deployment configuration.
- [The creation service](../../../server/modules/users/service.ts) creates an enabled user, credentials or explicit OIDC binding, organization roles and a password-free audit entry in one transaction. Local usernames are normalized and globally case-insensitively unique. There is no first-login forced-password-change workflow in the inspected source.
- One account has one Home organization. Organization administrators manage their own Organization; platform administrators may explicitly select another Operating organization. [ADR-0051](../../adr/0051-organization-provisioning-and-member-admission.md) describes the vocabulary and governance boundary; the current services establish implementation evidence.
- [Invitations](../../../server/modules/users/invitations.ts) are a different completion state: issuing a link does not create a user. Acceptance creates the account and may apply Team and Project participation presets.
- The installed `xlsx` dependency and [existing template generator](../../../src/application/parameters/import/buildImportTemplate.ts) support data, instructions and fictional examples on separate sheets. The parameter-specific parser and wizard are not general user-import components.
- [Module structure import](../../../src/components/parameter-admin-next/ModuleStructureImport.tsx) and its [apply service](../../../server/modules/parameter-governance/moduleStructure/apply.ts) demonstrate preview, explicit confirmation, revalidation and idempotent replay. Their tables and domain semantics remain parameter-specific.
- No user file-import or batch-creation API was found. Looping over the single-user API would produce independent transactions. Its password hashing currently occurs while holding a global administrator-mutation lock; a bulk design must account for that contention before claiming the 500-user target.

## Decision tree and scope

Template → occasional ≤500 users → one Organization → enabled local accounts → profile/organization roles → XLSX → supplied passwords without forced reset → preview and atomic confirmation → password-free export without a history page. Q1–Q16 close the product branches; Q17 confirms the complete plan, including the technical defaults below. No planning decisions remain open; the later `/implement-spec` request authorizes development.

Excluded: invitations, OIDC, CSV, cross-Organization files, updating/restoring/transferring existing users, Team/Project/review-duty assignments, password generation, notifications, inline spreadsheet editing, bulk undo and background-job administration. Correct the source workbook and preflight again. After success, account changes use existing management functions rather than automatic bulk deletion.

No new ADR is necessary: existing admission, identity and Organization boundaries remain intact. This plan records the batch-specific rationale; `CONTEXT.md` records the resolved vocabulary.

## User journey

1. Add **Import users** beside single-user creation on `/organization/members`. Show the selected Organization throughout. Require existing administrator authority and local authentication; suspended/read-only Organization states cannot start the operation. Enforce the same constraints server-side.
2. Download the template, fill its data sheet and select the XLSX. Parse in the browser and submit typed rows to preflight; file selection creates no accounts.
3. Preview source row, normalized username, name, title and roles, with totals, all determinable row/field errors and privileged-role count. There is no password display column. An unreadable workbook receives a file-level error without claiming every row was inspected.
4. Any error disables creation. Download a password-free error list, correct the original workbook and upload again. A clean preview enables **Confirm creation of N users**. Changing the file or selected Organization invalidates the preview.
5. Confirmation freezes the input/Organization and prevents duplicate button submissions. Success shows Organization, batch ID, created count and row results, refreshes members and offers the result workbook. Confirmed rollback says zero users were created; a lost response says **Result not yet confirmed** and recovers the original batch.

Cancel before confirmation clears the draft. After submission, closing the dialog or losing the connection does not guarantee cancellation. Refresh can recover the latest pending batch by non-secret ID; missing receipt means not confirmed while an earlier request may still be running. Do not automatically create a new batch to resolve an uncertain result.

## Template and validation

Generate `用户数据`, `填写说明` and clearly fictional `填写示例` sheets. Read only the named data sheet, regardless of tab order. The filename may include `v1`, but users may rename it. Preformat inputs as text; explain private password delivery and that the report cannot be reimported as a credential-bearing template.

| Chinese heading / API field | Planned rule |
| --- | --- |
| `姓名` / `name` | Required text, trimmed, 1–100 characters |
| `用户名` / `username` | Required text; shared trim/lowercase normalization; 3–64 characters from `a-z`, digits, `.`, `_`, `-`; preview the normalized value |
| `初始密码` / `password` | Required text, 8–1024 characters; preserve whitespace/leading zeros exactly; never trim or silently coerce numeric cells |
| `职务` / `title` | Optional text, trimmed, at most 100 characters; blank keeps the existing `User` default |
| `组织角色` / `roles` | Required existing Chinese role labels separated by `；`; trim labels, deduplicate exact roles, reject empty segments and unknown labels |

Use existing UI role labels and IDs. The guide shows the caller's grantable roles; edited workbooks still require server authorization. Multiple roles union existing rights, without assigning project participation or review duties.

Planned import-only limits: 2 MiB XLSX, 1–500 nonempty rows, at most 5,000 physical rows in the data sheet, and 4 MiB per preview/confirmation JSON request. These do not change single-user field limits. Require exactly the five named headings; order may vary, but missing/duplicate/unknown nonempty headings fail. Ignore entirely empty rows, validate partially filled rows, and retain physical row numbers. Include hidden/filtered rows. Reject merged input cells, formula cells even with cached values, numeric/date/boolean inputs, encrypted/corrupt files, unsupported types and oversized ranges; never silently truncate.

Reuse `xlsx`, not the parameter parser. Before calling its workbook reader, use the already-installed `jszip` to check ZIP structure and count actual streamed decompressed bytes: at most 256 entries, 8 MiB per entry and 32 MiB total. Stop on the first limit breach; do not trust declared ZIP sizes, decompress all entries with an unbounded `Promise.all`, or write a custom ZIP parser. This catches oversized shared strings and ignored sheets before XLSX parsing; post-parse row limits alone do not prevent decompression exhaustion. Then enforce bounded declared/observed sheet ranges and fail explicitly, never truncate silently.

The API receives JSON, not workbook ZIP bytes; it independently validates rows, lengths, roles and unknown fields. Do not evaluate formulas/macros/external links. Export user text as string cells without formula or hyperlink metadata.

## API and atomic creation

Planned endpoints use the existing Operating organization query convention:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v1/users/imports/preview` | Read-only validation, username-conflict lookup and password-free preview/errors/token |
| `POST /api/v1/users/imports` | Rows, preview token and client-generated import ID; one atomic creation |
| `GET /api/v1/users/imports/:importId` | Committed result for the authorized original operator and target Organization; no history list |

Register named import routes before generic user-ID routes. Enforce local authentication, trusted user initiation, `users:manage`, selected Organization and role-grant rules. Reject body Organization overrides, project-scoped grants and client-supplied credential hashes. A preview token is a consistency check, not permission. Its non-secret projection covers operator, Organization/lifecycle version, normalized rows and roles; plaintext passwords never enter a public token or ordinary persisted request fingerprint. Revalidate passwords at confirmation, and invalidate the browser preview after any file change.

1. Check transport limits, the import-ID envelope, current identity/target access and fields needed for non-secret intent comparison. Do not yet require a fresh preview or revalidate passwords/grants for an already committed operation.
2. Recover an existing committed receipt before new-user conflicts, preview freshness or password validation/hashing. Authorized replay returns the original result. Only a new batch proceeds to full row, password, role-grant and preview validation; return all determinable errors through safe allowlisted structures.
3. Hash all passwords with the shared salted scrypt helper outside the transaction and administrator lock, using bounded concurrency initially set to 4. Plaintext remains only in request memory.
4. In one transaction, follow the existing administrator/lifecycle lock order; re-read actor activity, roles/grant authority, Home/Operating relationship and target Organization state. Serialize the import ID and check its receipt again.
5. Recompute the non-secret preview projection, check global username occupancy and write every user, credential, organization role, per-user audit and batch receipt. Existing username uniqueness remains the final defense against registration/invitation races.
6. Commit once. Any role/credential/audit/receipt/constraint failure rolls back the whole batch. Map username races to safe row errors after rollback where possible, without exposing foreign member or Organization details. A lost COMMIT response enters result recovery, never a false rollback claim.

Extract the smallest internal prepare/write seam from single-user creation so both paths share rules and audit behavior. HTTP never accepts hashes. Do not loop over single-user HTTP calls or hold the global lock while hashing 500 passwords. Preserve single-user OIDC behavior. Do not reuse parameter-domain tables or introduce a generic import framework.

## Safe retry and data retention

Generate a random import ID per intent, scoped to the original operator and target Organization. Tab session storage may retain only the latest non-secret batch locator, never rows, file bytes or passwords. After resolving the previous result, a changed source starts a new intent.

Add a minimal user-domain receipt in the account-creation transaction: ID, operator, Organization, timestamp, counts, non-secret intent fingerprint and source-row → created-user-ID results. The stable fingerprint covers requested normalized non-secret data and identity/scope, not current actor permissions, Organization lifecycle version or preview token; those mutable facts belong only to preview/current-authorization checks. Same ID with different non-secret content fails. Concurrent same-ID requests serialize. A committed ID always returns the original result: resubmitted passwords are ignored and never reset users. Password changes are new intent, not retries; existing usernames then conflict normally. This first-commit rule avoids keeping plaintext or a fast password-derived verifier merely to compare retries.

No committed receipt means **not confirmed**, not proof of failure. Reload lookup needs no passwords. If a replay is necessary, reselect the original file with the same pending ID; committed-result lookup precedes preview/new-account conflict checks. Always recheck current authority; other actors, other Organizations and revoked administrators cannot obtain a result merely by knowing its ID.

Retain minimal receipts for the Organization's lifetime, with no history UI and no expiry that could permit accidental recreation. Resolve current names/usernames through authorized reads; deleted users remain historical IDs and cannot be recreated through replay. Classify the new table in Organization deletion inventory/cleanup and existing deleted-actor attribution conventions; preserve foreign receipts. Do not put original cells, redundant usernames, password hashes or workbook bytes in receipts.

Errors, previews, audit, logs, telemetry, snapshots and downloads use explicit allowlists. Password errors contain only row, field and rule; never raw `received` values, request bodies or whole-request fingerprints. Durable password hashes belong only in the credential store. Clear draft/request references when finished without promising JavaScript memory zeroization.

The result workbook contains source row, username when available, status, error field and repair suggestion, plus batch/Organization context. No password column. In a blocked batch, otherwise valid rows say **not created: batch blocked**, never **success**. It is a report, not an importable replacement for the original file.

## Implementation slices

These engineering work areas remain within specification #1530. The approved delivery tickets below cut across them as complete user journeys; implementation is now authorized. Deliver one coherent feature PR without merging incomplete credential or authorization paths.

| Slice | Owning seams | Completion condition |
| --- | --- | --- |
| S1 Contract | User DTO schemas; bilingual acceptance maps | Register proposed requirement/operation `PERM-USER-IMPORT-001` as future coverage before code; freeze row/error/response rules |
| S2 Atomic command | `server/modules/users/service.ts`, `repository.ts`, `schemas.ts`; small new `bulkImport.ts`; existing credential helper; new receipt migration and deletion ownership integration | Shared single/batch rules, hashes outside locks, complete rollback, safe retry and real PostgreSQL invariants |
| S3 API/workbook | User routes, `server/app.ts` limits, DTO/OpenAPI registration; one organization workbook utility | Read-only preflight, confirmation, receipt recovery, template round-trip and password-free reports |
| S4 UI | `src/UserPermissionsPage.tsx`, `src/infrastructure/http/userGovernanceClient.ts`; one focused organization import dialog | Upload, errors, preview, privileged-role highlighting, confirmation, recovery and export with keyboard/focus support at 1440×900 |
| S5 Verification/docs | User/auth regression suites, bulk integration tests, proposed `e2e/acceptance/user-bulk-import.acceptance.spec.ts`, bilingual user/API/security docs | Selected checks and independent review pass; evidence distinguishes local, API, PostgreSQL, browser and target-host scope |

Adjust proposed new filenames to nearby conventions without changing behavior. Recheck migration numbering against current main at integration. Organization erasure ownership belongs in S2, not deferred cleanup.

### Published delivery tickets

The user approved this breakdown and its dependencies on 2026-11-07. Each ticket has its own end-to-end acceptance criteria and scoped tests. All four are native children of #1530 with `ready-for-agent`; the edges below are native GitHub blocking relationships, not merely body text. The parent Issue's body and state were not changed.

| Ticket | Blocked by | Complete behavior |
| --- | --- | --- |
| [#1531 Template and read-only preflight](https://github.com/tzrea1-Q/WiseEff/issues/1531) | None | Download, bounded workbook parsing, real API/username/role validation and password-free row preview; no account creation |
| [#1532 Atomic account creation and retry receipt](https://github.com/tzrea1-Q/WiseEff/issues/1532) | #1531 | Confirm through new-user login, including the minimal single-user prefactor, hashes outside locks, atomic writes/audit/receipt, current-page retry, erasure ownership and real 500-user verification |
| [#1533 Refresh and interrupted-result recovery](https://github.com/tzrea1-Q/WiseEff/issues/1533) | #1532 | Recover the original pending result after refresh or connection loss without stored passwords, false failure or duplicate creation |
| [#1534 Password-free error and result reports](https://github.com/tzrea1-Q/WiseEff/issues/1534) | #1532 | Download safe XLSX reports, correct original rows and preflight again; preserve truthful outcomes and literal text |

#1533 and #1534 have no mutual blocking edge. #1531 is the initial technical frontier; the later `/implement-spec` request authorizes claiming and executing the graph. The coordinator owns independent Standards/Spec review and final required checks on the complete candidate after all four slices. Ticket publication alone did not authorize implementation; the later user instruction does.

## Acceptance and verification

| Case | Required observation |
| --- | --- |
| A1 Template | Empty template creates nothing; examples/instructions are excluded; sheet reordering, physical rows and password/text fidelity work |
| A2 Normal batch | Mixed-role accounts are active and can log in with supplied passwords; no forced reset or Team/Project grants |
| A3 Validation | All determinable missing/invalid/duplicate field errors are visible; formula/nontext input is rejected; zero users created |
| A4 Conflicts | Normalized in-file duplicates and existing usernames anywhere block every row; existing profiles/passwords/roles remain intact |
| A5 Limits | 1 and 500 rows succeed; 0/501 and oversized fields/files/bodies/ranges fail without truncation; ZIP entry/actual expanded-byte limits reject oversized shared strings and ignored-sheet payloads before XLSX parsing |
| A6 Authority | Non-admin, forged scope, foreign lookup and ordinary-admin platform grants fail; platform admin may explicitly target another active Organization |
| A7 Staleness | Actor revocation/transfer/disable, Organization suspension/deletion and late username occupation cannot bypass final checks |
| A8 Rollback | Inject failures after some users and during credential/role/audit/receipt writes; all new accounts and success audits roll back |
| A9 Retry | Double click, concurrent same-ID requests, lost response, reload and replay create one batch; stale preview does not block committed-result recovery; mismatched non-secret content fails; replay never resets a password |
| A10 Secrets | No plaintext or fast password fingerprints in previews/errors/audit/logs/receipts/download/session storage; exported data is literal text |
| A11 Lifecycle/regression | Receipt inventory/Organization erasure preserve foreign data; deleted users/actors cannot trigger recreation; single-user/password-reset/OIDC behavior remains intact |
| A12 Browser | Real local-auth API at 1440×900: template, invalid preview/export, clean confirmation, result export, new login and recovery, with operation evidence |
| A13 Capacity | Record complete 500-user API/PostgreSQL latency and lock hold time; verify intended deployment proxy/timeouts before claiming target support |

On 2026-11-07, the existing `hashLocalAccountPassword` helper performed 500 hashes with fictional input and concurrency 4 in **2,489 ms** on this workstation. No users, database or HTTP were involved. This supports starting with a bounded synchronous command, not claiming end-to-end or target-host performance. Measure complete requests and unrelated administrator responsiveness before shipping; if the target cannot support 500 rows, explicitly revisit execution rather than silently lowering the limit or partially committing.

Run `npm run test:impact -- <changed-files>` for the actual implementation, inspect both fallback flags and complete all selected required native checks. Retain focused user/auth tests, workbook round-trip/error coverage, real PostgreSQL rollback/concurrency tests, TypeScript/build, API/OpenAPI checks and selected browser commands in an isolated `WISEEFF_RUNTIME_LANE`. Existing `PERM-USER-MGMT-001`/`ORG-OPERATING-LIFECYCLE-001` are regression references, not batch evidence. One independent review covers authorization, tenancy, credentials, migration/erasure and concurrency. Record exact commands/counts/environment in the authorized PR.

Planning checks: documentation governance passed; database-schema verification skipped because PostgreSQL was unreachable. No implementation/product acceptance tests have run. Final documentation and whitespace checks are recorded at handoff.

## Git & PR Workflow

Integration branch: `codex/user-bulk-import`, based on `dc1ede937`, reusing the isolated planning worktree. Preserve the original checkout's unrelated documents. Implementer branches/worktrees start at the integration tip, merge its current tip before handoff, and are integrated by a merger subagent. Open one draft PR after the first implementation merge, link the specification and all four tickets for closure, verify current-head CI and independent review, then mark ready when required evidence is complete. Do not merge main or deploy without authorization. Archive implementer worktrees after their work is integrated and no longer needed.

## Documentation Impact Matrix

| Area | Disposition and exact paths |
| --- | --- |
| Repository maps and vocabulary | Update `CONTEXT.md`; Review `ARCHITECTURE.md` and `docs/zh-CN/root/ARCHITECTURE.md` only if the final design changes a system boundary |
| Planning | Update this plan, `docs/zh-CN/exec-plans/active/2026-11-07-user-bulk-import.md`, `docs/PLANS.md`, `docs/zh-CN/PLANS.md` as answers settle |
| Product and user guidance | Review `docs/product-specs/new-user-onboarding.md`, `docs/zh-CN/product-specs/new-user-onboarding.md`, `docs/user-guide/organization-and-governance.md`, `docs/zh-CN/user-guide/organization-and-governance.md`; update approved behavior during implementation |
| Architecture and API | Review `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`; do not describe proposed endpoints as shipped |
| Quality and operation coverage | Review `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` and their `docs/zh-CN/developer/` companions; add batch IDs before implementation |
| Reliability and runbooks | Review `docs/RELIABILITY.md`, `docs/zh-CN/RELIABILITY.md` after retry/retention choices; no runbook changes yet |
| Security and governance | Review `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/security/user-permission-design.md`, `docs/zh-CN/security/user-permission-design.md` after credential and authority choices |
| Frontend and design | Review `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `docs/developer/ui-quality-checklist.md`; use existing components and PC-first policy |
| Generated artifacts | Review `docs/generated/openapi.json` if an API is added; no generated output changes in this planning phase |
| Decision references | Review `docs/adr/0051-organization-provisioning-and-member-admission.md` and its Chinese companion; no new ADR justified yet |

## Documentation Update Gate

Keep the English and Chinese plans aligned after each decision round. Do not mark the plan approved while branches remain unresolved. Before completion, every Update/Review row must be updated or recorded unchanged with supporting evidence; implementation/browser-operation evidence and any deferred work remain explicit. Run `npm run docs:check` before handoff. This plan is not implementation acceptance.

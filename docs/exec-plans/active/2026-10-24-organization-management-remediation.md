# Organization management remediation

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-10-24-organization-management-remediation.md)
> Status: all 40 findings implemented; local verification and remaining delivery gates recorded below.
> Scope: user-authorized repair of all 40 organization-management audit findings.
> Baseline: `2fba5b55fed1b6aa16eb9ae5ef85c10b344cdb97`.

## Outcome and boundaries

Repair all audit items across the platform organization directory, ten organization workspace destinations, and their dialogs. Reuse the existing design system, typed domain clients, authorization and handover rules. Keep tenant isolation, audit, administrator protection, deletion retention and human approval intact. Do not mutate existing development accounts to test password changes or destructive behavior.

The audit report and before screenshots are local supporting material under `.wiseeff-tools/organization-ui-audit/`; this plan records implementation scope, not an alternative acceptance service. Source changes stay on `codex/organization-management-remediation-20261024`. The user subsequently authorized commit, push, PR and merge after CI passes. Rendered approval, current-head CI and delivery results are recorded in the PR when actually obtained.

## Complete coverage

| Audit ID | Required outcome | Owner | Completion |
| --- | --- | --- | --- |
| 01 | Protect platform-admin password resets | Backend | Implemented |
| 02 | Freeze pending role/team selections | All UI owners | Implemented |
| 03 | Preserve drafts on accidental dismissal | People | Implemented |
| 04 | Count every handover domain | Backend | Implemented |
| 05 | Keep suspended credentials readable | Resources | Implemented |
| 06 | Isolate collection load failures | Resources | Implemented |
| 07 | Offer retries only for recoverable erasures | Resources | Implemented |
| 08 | Remove inaccessible management navigation | Coordinator | Implemented |
| 09 | Respect workflow publication in resource links | Coordinator | Implemented |
| 10 | Reduce repeated organization chrome | Coordinator | Implemented |
| 11 | Give overview metrics the full row | Coordinator | Implemented |
| 12 | Collapse zero pending counters | Coordinator | Implemented |
| 13 | Consolidate empty handovers and duplicate actions | Resources | Implemented |
| 14 | Clarify child navigation and resource ownership | Coordinator | Implemented |
| 15 | Unify permission terminology | People | Implemented |
| 16 | Separate member tasks and single-user duties | People + coordinator | Implemented |
| 17 | Provide useful team and empty-project follow-ups | People | Implemented |
| 18 | Unify member joining actions | People | Implemented |
| 19 | Use explicit persistent creation actions | People + resources | Implemented |
| 20 | Restore project selection from the URL | Resources | Implemented |
| 21 | Label participant fields and project context | Resources | Implemented |
| 22 | Make bulk grants actionable without teams | Resources | Implemented |
| 23 | Provide collection and option lookup | All UI owners | Implemented |
| 24 | Summarize team members once | People | Implemented |
| 25 | Link accepted invitations to members | People | Implemented |
| 26 | Keep pending request counts independent | People | Implemented |
| 27 | Make approval history traceable and searchable | People | Implemented |
| 28 | Match reset actions to account capability | People | Implemented |
| 29 | End the current session after self reset | People | Implemented |
| 30 | Exclude unavailable transfer targets | People | Implemented |
| 31 | Provide transfer completion follow-ups | People | Implemented |
| 32 | Recover from OIDC binding conflicts | People | Implemented |
| 33 | Stabilize Bridge refresh and pairing follow-ups | Resources | Implemented |
| 34 | Show actionable credential errors | Resources | Implemented |
| 35 | Separate organization entry and administration | Resources | Implemented |
| 36 | Display the actual deletion blockers | Resources | Implemented |
| 37 | Prioritize deletion impact and pin actions | Resources | Implemented |
| 38 | Keep basic organization settings concise | Coordinator | Implemented |
| 39 | Keep one creation action in empty lists | People | Implemented |
| 40 | Make shared multi-select styling self-contained | Coordinator | Implemented |

## Verification

- Implementers run changed focused tests. The coordinator integrates, inspects both impact fallback flags, and owns related/full selections, static checks, build and API browser evidence.
- Password protection requires independent review and isolated PostgreSQL cases covering rejected ordinary administrators, unchanged credentials/sessions, permitted platform administrators, organization isolation and role concurrency.
- Verify affected pages and form/error/empty/pending/read-only/keyboard states at 1440×900; add 1280×800 for dense members and risky dialogs.
- Verify the final current candidate. Existing audit screenshots, historical CI and a selected command do not establish acceptance. Do not change visual baselines without explicit approval.
- Keep English/Chinese frontend design documentation aligned with the actual interface changes.

## Current evidence

- All 40 audit rows are implemented. Real-browser follow-up also repaired the double leave confirmation when opening team management from an edited member, and duplicate React keys in deletion-preview zero counts. Their regression checks failed before the fixes and passed afterward.
- Frontend full run: 606 files / 6,297 tests passed. The subsequent deletion-key repair was verified separately by its 4-test component suite and affected deletion/erasure browser cases. Organization backend: 23 files / 228 tests passed against isolated PostgreSQL, with one server worker. Independent authorization/tenant/destructive-seam review reported no findings; its 9 PostgreSQL security cases passed. Bridge tests: 21 files / 142 tests passed.
- Real API browser runs passed organization overview/navigation, member/profile/roles, invitations, teams and mixed-result bulk grants, project participation, transfer/offboarding, administrator succession, handovers, paused-organization credential reading, Bridge/credential revocation, public experience registration, deletion previews, durable erasure retries, platform directory and permission cases. Checks included 1440×900 and targeted 1280×800 layouts, keyboard operation, empty/error/pending/read-only states, draft preservation and published resource links. The last role-set rerun passed unchanged after a development `.env` edit had interrupted an earlier run through Vite document reloads.
- Native browser quality initially returned 281 passed / 9 failed out of 290; each failed case was corrected and replayed successfully with the original quality thresholds. Current TypeScript check, Vite production build with a 4 GB heap, changed-file lint/semantic checks, UI ratchet and whitespace check passed. The default 2 GB Vite build exhausted its heap; no build-memory policy was changed. Quality consistency checks passed 150/150 and browser-impact inventory checks passed 20/20. English/Chinese design documentation and this plan are synchronized.
- Broader selected regression is not green: the full server run encountered PostgreSQL OOM/recovery failures; the full script run encountered unavailable dedicated targets/stores, environment-dependent catalog rehearsals and timeouts. The full cross-business browser fallback stopped after an unrelated JSON rollback case timed out; its interrupted receipt is not acceptance. Scoped passes above do not replace these gates. Controlled-issuer OIDC browser cases, Linux visual-baseline acceptance, human visual approval and GitHub CI have not been obtained; no visual PNG baseline was replaced.
- The API-mode development page remains available at `http://127.0.0.1:20049/organization`. After a helper accidentally included local database connection files in tool output, the three exposed isolated development database roles were rotated, services restarted, and database authentication, health, proxy login and identity rechecked successfully. No credential values are recorded here. Temporary local test infrastructure was removed after verification; current delivery state belongs in the PR.

## Documentation Impact Matrix

| Surface | Documentation | Change |
| --- | --- | --- |
| Organization UI and interaction | `docs/FRONTEND.md` and Chinese companion | Record navigation, scoped deep links, drafts, read-only and pending states |
| Execution plan index | `docs/PLANS.md` and Chinese companion | Link this bounded remediation |
| API/schema/operations | Existing domain contracts | No API shape, migration or deployment change |

## Documentation Update Gate

Run `docs:check` against the isolated PostgreSQL test service. Keep this plan and its Chinese companion synchronized with actual evidence; visual approval, CI and merge remain unclaimed until observed.

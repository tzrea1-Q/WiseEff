# Parameter library implementation

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-11-05-parameter-library.md)

Implementation and independent review are complete. [PR #1521](https://github.com/tzrea1-Q/WiseEff/pull/1521) owns final candidate CI and human review; this archive does not assert merge readiness, main integration or deployment.

Implement [specification #1513](https://github.com/tzrea1-Q/WiseEff/issues/1513) and the [accepted design](../../design-docs/2026-11-05-parameter-library-design.md). Reuse the published Catalog, canonical current Binding/value ownership and existing project editor. Keep global definitions separate from Organization-scoped configuration reads; preserve write authorization and source integrity. No second value store or deployment is planned.

## Tasks and ownership

| Issue | Slice | Prerequisites | Status |
| --- | --- | --- | --- |
| #1514 | Global entry and complete definition reading | None | Integrated; focused HTTP/PG 51/51, frontend 77/77, browser 1/1 passed |
| #1515 | Organization-scoped configuration reading | None | Integrated; scoped HTTP/PG 22/22, related 58/58, browser 1/1 passed |
| #1516 | Current instances and exact usage | #1514, #1515 | Integrated; scoped HTTP/PG 62/62, focused frontend 22/22, browser 1/1 passed |
| #1517 | Usage filters and unconfigured coverage | #1516 | Integrated; frontend 73/73 and real API browser 1/1 with axe passed; combined HTTP covered by #1518 |
| #1518 | Explicit instance comparison | #1516 | Integrated; HTTP/PG 37/37 plus array/type case, frontend 74/74, combined browser 1/1 with comparison axe passed |
| #1519 | Exact project edit and return | #1516 | Integrated; combined frontend 233/233, final real-API browser 1/1, read-only handoff browser 1/1 passed |
| #1520 | Share current view and copy full values | #1517, #1518 | Integrated; frontend 78/78 and real-API browser 1/1 passed; release-pinning copy race fixed and covered by #1519 combined checks |

The coordinator owns integration, runtime setup, expensive verification and the PR. Each issue is implemented with TDD in a managed worktree by a GPT-6.1 Terra agent at xhigh reasoning. Merger agents integrate completed slices. Independent Standards and Spec reviews run after all slices; one implementation agent fixes findings.

## Git & PR Workflow

Base: `origin/main` at `d867166f5332dbceacbce348f7e73f1b16911ac1`. Integration branch: `codex/parameter-library`. The user explicitly invoked `implement-spec`, selecting a single integration PR in place of the ordinary per-slice PR convention. Open a draft after the first worker merge, closing #1513–#1520 when eventually merged. Finish with a verified, reviewed PR ready for review; no main merge or deployment is authorized.

## Verification

Approved behavior seams are public HTTP plus real PostgreSQL, and browser journeys against a real API. Each worker runs focused red/green checks and affected static checks. The coordinator runs `npm run test:impact -- --base d867166f5332dbceacbce348f7e73f1b16911ac1`, honors both fallback flags, and owns selected native regression, `npm run build`, `npm run ui:check` and `npm run docs:check`. No skipped or mock result counts as backend acceptance.

Browser ownership: `e2e/acceptance/parameter-library.acceptance.spec.ts`, requirement and operation IDs `PARLIB-READ-001`, `PARLIB-SCOPE-001`, `PARLIB-INSTANCES-001`, `PARLIB-FILTER-001`, `PARLIB-COMPARE-001`, `PARLIB-RETURN-001`, `PARLIB-SHARE-001`. Record real operation evidence through the native acceptance runner. Inspect 1440×900 and a compact 1280×800 state for dense table/comparison layout; cover DTS and software configuration, keyboard focus, long values, errors and stale responses. Use isolated runtime/database lane names. Existing Catalog and project-workbench regression owners remain intact.

Draft [PR #1521](https://github.com/tzrea1-Q/WiseEff/pull/1521) is open. Final selection has both Vitest and browser full-fallback flags; the coordinator retains the full selected gates for the integrated candidate. Focused worker results above do not complete those gates. Scope browser coverage lives in `e2e/acceptance/parameter-library-scope.acceptance.spec.ts`. Independent review is complete; final visual approval and final regression remain pending.

At integration `5a67ec729`, build, changed-file static coverage, UI standards, documentation/database-schema checks, OpenAPI, operation matrix and browser coverage checks passed. The corrected native library consistency run passed 3/3 (warmup and light/dark); its first attempt returned 401 because the manual test environment lacked the native smoke authentication setup, and its trace is retained separately. The current-instance aggregate retains the existing five-query budget: the failing regression was 3 failed/16 passed before correction; six focused suites then passed 127/127.

Independent Standards and Spec reviews of `84d7f6d5d` found one P2 each: list configuration filtering/counts need one coherent snapshot, and historical comparisons need an explicitly labelled latest published revision. A single implementation agent fixed both in `1b1b2414e`, integrated by `48892bb9c`. Real PostgreSQL checks passed 53/53, frontend 73/73, and the extended real-API browser scenario 1/1 at 1440×900; changed-file static checks passed. The browser displays historical/value revision #1, effective revision #2 and current published revision #3 distinctly. The reviewers found no other actionable issues. Final broad CI and human effect approval remain pending; no merge or deployment is authorized.

CI run `42134110472` at `ba376920f` passed all L1 jobs, smoke and accessibility. Its visual lane found a product regression (an empty notice shifted the project workbench) and a test-helper race (a dialog hid the hint during dismissal). Commit `64c88cdd8` fixes both without changing baselines, thresholds or visible-hint failure handling. Component checks passed 75/75, the helper browser regression 1/1, and clean CI-seeded real-API warmup plus compact dark checks 2/2; changed-file lint passed. The 1440×900 real-API layout was inspected. Darwin visual comparisons against older platform baselines failed and remain historical failed evidence; final Linux comparison belongs to the PR's current-head CI. Initial compact runs on an adopted development database were not equivalent to CI; the clean browser seed corrected the environment without changing the 200-control gate.

## Documentation Impact Matrix

| Area | Action | Paths and decision |
| --- | --- | --- |
| Repository maps | Updated | `ARCHITECTURE.md` and `CONTEXT.md` name the definition-first surface and canonical query/source owners. |
| Planning | Updated | `docs/PLANS.md`, this plan and Chinese companions track the single integration PR and verification ownership. |
| Product | Updated | The bilingual accepted design records implementation authorization and links this execution plan. |
| Architecture | Updated | ADR-0055 and the bilingual domain model distinguish Organization-wide current configuration reads from project-authorized writes. |
| Quality | Updated | Browser coverage maps, `operationMatrix.ts` and generated operation coverage describe the seven real-API journeys; final execution results remain below. |
| Reliability | Unchanged | No new service, migration, device command, deployment or recovery procedure. The bootstrap readiness fix preserves the same strict Docker capability proof and runtime limits. |
| Security | Updated | Bilingual `docs/SECURITY.md` documents current-configuration read scope; project writes and human approval remain unchanged. |
| Frontend and users | Updated / unchanged | Bilingual frontend and parameter user guides describe reading, filtering, comparison, sharing and exact project return. The UI design system is unchanged: existing tokens, controls, Markdown renderer and navigation layout are reused. |
| Generated artifacts | Updated / unchanged | Native `contract:openapi` updates `docs/generated/openapi.json`; there are no migrations, so `docs/generated/db-schema.md` remains unchanged and is checked by `docs:check`. |
| References | Updated / unchanged | User guidance for the retired comparison route now points to the library or project row comparison. Historical Catalog/workbench acceptance records remain unchanged. |

## Documentation Update Gate

All impact rows are resolved above. Bilingual documentation, generated contracts and runtime evidence are recorded; documentation checks passed on the integrated candidate. Final CI, effect approval and PR readiness remain distinct states in PR #1521 rather than being inferred from this implementation archive.

# Project configuration workbench candidate upload (#231)

> Status: **Active**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-candidate-upload`
> Issue: [#231](https://github.com/tzrea1-Q/WiseEff/issues/231), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#230](https://github.com/tzrea1-Q/WiseEff/issues/230) (merged at `24aabb4c5c824c9b871cc16194b3c1aebda6917d`)
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-07-project-configuration-workbench-candidate-upload.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) · [ADR-0018](../../adr/0018-uploaded-file-versions-are-staged-before-activation.md)
> Starts at: `24aabb4c5c824c9b871cc16194b3c1aebda6917d`

## Goal

Deliver the staged Candidate file version lifecycle: upload → parse → impact review → abandon. Creating or inspecting a candidate must never change the active file version or Config set composition. Activation remains #232.

## Scope and success criteria

1. Candidate persistence and public contracts represent `uploading`, `parsing`, `ready`, `blocked`, `failed`, and `abandoned` without using the active-version pointer as staging storage.
2. Uploading an existing-file replacement or a new project file creates a Candidate and leaves Working configuration unchanged.
3. Candidate impact includes text/source diff, structural diff, validation diagnostics, coverage/mapping effects, conflicts, and explicit blockers where applicable.
4. Candidate source mode and inspector distinguish the candidate from file history, active version, Working configuration, and Release baseline.
5. Parse failure leaves active source untouched and exposes actionable diagnostics with an abandon path.
6. A blocked candidate remains inspectable and can be recomputed when external blockers change.
7. Ready, blocked, or failed candidates can be abandoned without changing Config set membership or active source.
8. Candidate reads/writes remain organization/project scoped, permission checked, and audited where policy requires.
9. API/database integration proves the non-activation invariant; API-mode browser acceptance `PROJ-CONFIG-CANDIDATE-001` proves upload, impact, failure, and abandon.

## Non-goals

- Activation (#232), structured property edit submit (#233), conflicts arbitration UI beyond candidate-related conflict evidence, release readiness, cutover.
- Free-form DTS editing.
- Copying from prototype `e941f236` / `codex/prototype-config-workbench`.
- Closing #231 or opening/merging a PR from the implementation agent.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Persistence + HTTP/contracts | `project_parameter_file_candidates` (+ migration); states above; never writes `current_version_id` / config-set membership on create/inspect/abandon | migration + repository + route + integration tests |
| Application ports | `createCandidate`, `getCandidate`, `getCandidateImpact`, `abandonCandidate` (+ list/recompute as needed) on `ParameterFileRepository`; mock + HTTP parity | port + mock + client tests |
| Non-activation invariant | upload / inspect impact / abandon leave active version and config-set membership unchanged | server integration tests |
| Workbench UI | Enable「上传候选」; `sourceMode=candidate`; inspector impact evidence; parse-fail diagnostics; blocked recompute; abandon for ready/blocked/failed; independent identity labels | `ProjectConfigurationWorkbench` tests |
| Authz + audit | org/project scoped; Admin for writes; view for reads; audit on create/abandon | route/service tests |
| Browser acceptance | `PROJ-CONFIG-CANDIDATE-001` | EN/ZH maps + `requirements.ts` + `operationMatrix.ts` + e2e + playwright-cli |

Reuse structural ingest/diff/validation for impact computation; do not activate.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work and commit on `feat/project-configuration-workbench-candidate-upload`; do **not** push/merge `main`, open a PR, or close #231 |
| Parent agent | Review commits, open/merge the PR, sync local `main`, and close #231 when accepted |

The branch starts at `24aabb4c5c824c9b871cc16194b3c1aebda6917d` (merge of PR #244 / inspector history).

## Tasks

### 0. Register plan

- [ ] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan lists.
- [ ] Claim issue #231 (`gh issue edit 231 --add-assignee @me`).
- [ ] Lock the TDD seams above.

### A. Persistence + public contracts

- [ ] Red: migration defines `project_parameter_file_candidates` with lifecycle states and no active-version staging.
- [ ] Red/Green: repository insert/get/list/update status; public DTO/schemas.

### B. Service + routes (create / impact / abandon / recompute)

- [ ] Red/Green: `createCandidate` stores bytes, parses, computes impact → ready/blocked/failed; never sets active version or membership.
- [ ] Red/Green: `getCandidate` / `getCandidateImpact` / `abandonCandidate` / recompute for blocked.
- [ ] Authz + audit on write paths.

### C. Application ports + mock/HTTP parity

- [ ] Extend `ParameterFileRepository` with candidate operations; mock + HTTP client parity tests.

### D. Non-activation invariant

- [ ] Integration tests: upload/inspect/abandon leave `current_version_id` and config-set membership unchanged.

### E. Workbench UI

- [ ] Wire upload control; candidate source mode + inspector; impact evidence; fail diagnostics; abandon; identity chips.

### F. Acceptance + docs + completion

- [ ] Register `PROJ-CONFIG-CANDIDATE-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [ ] Update FRONTEND/API (and ZH) as needed; generated artifacts if contracts change.
- [ ] Verification matrix + three-viewport UI evidence under `work/ui-checks/project-configuration-workbench-candidate-upload/`.
- [ ] Dual-axis Standards vs Spec review vs `24aabb4c`; fix; re-run impacted tests.
- [ ] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-CANDIDATE-001` | `PROJ-CONFIG-CANDIDATE-001` | Admin uploads candidate (replacement or new), reviews impact in candidate source/inspector, sees parse-failure diagnostics with abandon, abandons ready/blocked/failed without changing active version or config-set membership | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + playwright-cli under `work/ui-checks/project-configuration-workbench-candidate-upload/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench src/application/ports src/infrastructure/mock/mockParameterFileRepository.test.ts src/infrastructure/http/parameterFileClient.test.ts
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files
```

Completion gates:

```bash
npm test
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

Frontend-visible: playwright-cli three viewports `1440x900`, `768x1024`, `390x844` under `work/ui-checks/project-configuration-workbench-candidate-upload/`.

Review gate: Standards vs Spec against `24aabb4c5c824c9b871cc16194b3c1aebda6917d` and issue #231.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — candidate upload, source mode, inspector impact |
| API contract | Update | `docs/design-docs/api-contract.md` (+ ZH) — candidate endpoints/DTOs; regenerate OpenAPI if tooling requires |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | Update | schema summary / OpenAPI when candidate persistence and routes land |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | ADR-0018 already accepted; CONTEXT.md if vocabulary needs candidate entity |
| Reliability / security | Review | `docs/RELIABILITY.md`, `docs/SECURITY.md` — candidate cleanup / authz |
| Environment | Review | no new env vars expected beyond existing workbench flag |

## Documentation Update Gate

- [ ] Every `Update` row is delivered in English and Chinese where applicable.
- [ ] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [ ] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [ ] `npm run docs:check` passes.
- [ ] No deferred #231 acceptance remains; follow-ups belong to later child issues of #227 (#232+).

## Outcomes / Residual risk

_To be filled at completion._

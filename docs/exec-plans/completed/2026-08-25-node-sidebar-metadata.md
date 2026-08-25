# Node debugging detail-sidebar metadata repair

- Issue: #632
- Status: Completed
- Branch: `codex/issue-632-node-sidebar-20260825`, based on latest `main`
- Scope: `/node-debugging` detail sidebar identity, catalog documentation hydration, and multiline rendering

## Goal

Present one clear node identity in the detail sidebar: the node name is the title, the brief description is the subtitle, optional detailed documentation is shown once in the body, and configured write-format hints retain their line breaks without exposing the internal node id. Existing node operation identity and guarded read/write behavior remain unchanged.

## Architecture and files

- `src/infrastructure/http/debuggingDtos.ts`: carry existing runtime catalog documentation into the page-facing domain row.
- `src/NodeDebuggingPage.tsx`: render the dynamic sheet identity, optional detailed description, and multiline write-format hint while preserving operation controls.
- `src/styles.css`: scope whitespace behavior to the node-debugging surface and wrap long content in narrow sheets.
- `src/NodeDebuggingPage.test.tsx`: verify the public page seam for metadata-rich and sparse nodes and preserve existing operation behavior.
- `src/infrastructure/http/debuggingDtos.test.ts`: verify rich and sparse runtime DTO mapping, including internal identity preservation.

## Acceptance criteria

- The sheet accessible name/title is the selected node name; its subtitle is only the non-empty brief description.
- The body does not repeat the name or brief description and never renders the opaque runtime id/compatibility key.
- A configured detailed description is rendered with intentional line breaks; an empty one renders no empty section.
- A configured write-format hint preserves internal line breaks and wraps long unbroken text; empty-hint fallback remains unchanged.
- Status, RO/WO/RW fields, target editor, guarded writes, readback, snapshots, rollback preparation, operation history, and HDC/ADB protocol identity are unchanged.
- No API route, database column, migration, or second metadata source is introduced.

## Verification

- Focused: `npm test -- --run src/NodeDebuggingPage.test.tsx src/infrastructure/http/debuggingDtos.test.ts`
- Full frontend: `npm test`
- Static/UI: `npm run ui:check`, `npm run lint`, `npm run build`, `git diff --check`
- Browser: `/node-debugging` in mock mode at `1440x900`, `768x1024`, and `390x844`; open a node detail sheet, configure metadata through the existing admin editor, inspect snapshots/screenshots, console/network, and mobile overflow.
- Hardware boundary: mock/local browser evidence does not establish deployment-machine or real HDC/ADB readiness.

## Browser acceptance and operation coverage

This presentation repair reuses the existing coverage rather than changing the acceptance model:

- Acceptance requirement `DEBUG-SIM-001` and `DEBUG-PERM-001` in `docs/developer/browser-acceptance-coverage-map.md` remain the relevant `/node-debugging` simulator and permission coverage.
- Operation `DEBUG-SIM-001` and `DEBUG-PERM-001` in `docs/developer/user-operation-coverage-matrix.md`, covered by `e2e/acceptance/debugging-simulator.acceptance.spec.ts`, are reviewed; existing guarded operation assertions remain intact.
- Catalog metadata editing is already covered by `DEBUG-ADMIN-001` in `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md`, using `e2e/acceptance/debugging-admin.acceptance.spec.ts`; this change does not alter that admin workflow.
- The manual `playwright-cli` walkthrough supplements, but does not replace, automated acceptance coverage.

## Git & PR Workflow

The parent agent owns review, commit, PR creation, CI waiting, merge, and synchronization of the clean local `main` worktree. The dirty primary worktree is out of scope and must remain untouched.

## Documentation Impact Matrix

| Documentation area | Decision | Evidence / path |
| --- | --- | --- |
| Repository maps and onboarding | No change | `AGENTS.md`, `docs/README.md`; implementation stays within the existing frontend/runtime seams. |
| Planning docs | Update | This plan records issue scope, branch, acceptance, coverage, and verification. |
| Product specs | No change | `docs/product-specs/`; issue #632 is a bounded presentation repair with no product workflow change. |
| Architecture and domain | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md`; no seam, identity, or persistence change. |
| API contracts | Review | `docs/api/`, `docs/design-docs/api-contract.md`; existing runtime fields are reused and no endpoint/schema changes are made. |
| Quality and testing | Review | `docs/developer/verification-matrix.md`, `docs/developer/ui-quality-checklist.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`; existing coverage is reused and browser evidence is captured. |
| Reliability and runbooks | No change | `docs/RELIABILITY.md`, `docs/runbooks/`; no runtime or deployment behavior changes. |
| Security and governance | Review | `docs/SECURITY.md`, `docs/security/`; internal ids remain operationally available but are removed from ordinary UI rendering. |
| Frontend and design | Review | `docs/FRONTEND.md`, `docs/design-docs/ui-design-system.md`; existing `WorkbenchSheet` and tokens are retained. |
| Generated artifacts | No change | No generated schema, contract, or seed artifact is changed. |
| References | No change | `docs/references/`; no new external convention is introduced. |

## Documentation Update Gate

Before moving this plan to `docs/exec-plans/completed/`, run `npm run docs:check` and record the result. Each matrix row marked `Update` or `Review` must be either updated or explicitly confirmed unchanged with the evidence above. No deferred documentation work is expected; if that changes, add it to `docs/exec-plans/tech-debt-tracker.md` before completion.

Completion evidence: `npm run docs:check` passed. The pgvector canonical artifact check was skipped because the local server has no pgvector extension; CI remains the authoritative pgvector verification environment. The reviewed documentation and acceptance coverage remain unchanged, and no deferred documentation work was created.

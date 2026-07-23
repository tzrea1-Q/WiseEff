# Local post-cutover M1 seed — execution plan

> Chinese: [`docs/zh-CN/exec-plans/active/2026-07-23-local-post-cutover-seed.md`](../../zh-CN/exec-plans/active/2026-07-23-local-post-cutover-seed.md)  
> Design: [`docs/design-docs/2026-07-23-local-post-cutover-seed-design.md`](../../design-docs/2026-07-23-local-post-cutover-seed-design.md)  
> Branch: `feat/local-post-cutover-seed`

## Goal

Make `db:seed:m1` / `npm run dev:all` default to semantic-only data plus local post-cutover finalize so typed binding draft submission works locally without weakening production cutover gates.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation | Work on `feat/local-post-cutover-seed` from `main`; commit on the feature branch |
| Implementation | Must not push to `main`, open/merge PRs, or fast-forward local `main` |
| Parent / session owner | Review, open PR, merge, sync local `main` |

## Tasks

- [x] Add `server/modules/parameter-topology/localPostCutover.ts` + unit tests
- [x] Default M1 seed skips flat identity; call local finalize; `WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` opt-out
- [x] Update EN/ZH local-development + FRONTEND; `.env.example`; design specs
- [x] Wipe local Docker volume and verify typed submit; `npm run docs:check`
- [x] CI follow-up: allowlist `localPostCutover.ts` in legacy dependency guard; make `reset:quality-runtime` tolerate flat→legacy PPV rename

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Developer local setup | Update | `docs/developer/local-development.md`, `docs/zh-CN/developer/local-development.md` |
| Env example | Update | `.env.example` |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Design / plans | Update | `docs/design-docs/2026-07-23-local-post-cutover-seed-design.md`, zh companion under `docs/zh-CN/superpowers/specs/`, this plan + zh |
| Runbooks | Review | `docs/runbooks/parameter-identity-cutover.md` — no production rule change; local-dev clarifies wipe vs dirty-cutover ban |
| Architecture / AGENTS | No change | — |
| Product specs | No change | — |
| Generated schema | No change | — |

## Documentation Update Gate

Blocking until Update/Review rows are done or recorded unchanged. Run `npm run docs:check` before marking complete.

## Verification

```bash
npm run test:server -- --run server/modules/parameter-topology/localPostCutover.test.ts server/modules/parameter-topology/legacyDependencyGuard.test.ts server/modules/parameters/seedM1Parameters.test.ts
npm test -- --run scripts/reset-quality-runtime.test.ts
npm run docs:check
# wipe volume then:
npm run db:migrate && npm run db:seed:m0 && npm run db:seed:m1
# confirm parameter_identity_cutovers > 0; submit typed draft in UI
```

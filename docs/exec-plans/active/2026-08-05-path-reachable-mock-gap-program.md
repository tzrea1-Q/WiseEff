# Path-reachable mock / half-implemented gap program (A+1)

> Status: **Active** — planning artifacts only; implementation proceeds via child plans
> Date: 2026-08-05
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-05-path-reachable-mock-gap-program.md`](../../zh-CN/exec-plans/active/2026-08-05-path-reachable-mock-gap-program.md)
> Origin: Mock vs backend gap audit for parameter management and debugging (2026-08-05)

## Goal

Close every **path-reachable** gap where parameter management or debugging still behaves as mock-only or half-wired (missing durable backend/DB and/or UI closure on the API path), without reviving product-offline surfaces.

## Scope

### In scope (child plans)

| ID | Gap | Reachable entry | Child plan | Branch |
| --- | --- | --- | --- | --- |
| C4 | Mock import fake-success + dead residuals | Mock import apply; dead `AI_FEEDBACK`; orphan reload-bindings contracts | [`2026-08-05-mock-honesty-and-dead-residual-cleanup.md`](./2026-08-05-mock-honesty-and-dead-residual-cleanup.md) | `feat/mock-honesty-dead-residual-cleanup` |
| C2 | Node debugging UI closure | `/node-debugging` | [`2026-08-05-node-debugging-ui-closure.md`](./2026-08-05-node-debugging-ui-closure.md) | `feat/node-debugging-ui-closure` |
| C3 | Admin local audit hints | `/parameter-admin` `PUSH_AUDIT_HINT` | [`2026-08-05-parameter-admin-audit-hints.md`](./2026-08-05-parameter-admin-audit-hints.md) | `feat/parameter-admin-audit-hints` |
| C1 | Project parameter initialization | New-project wizard; `/parameter-review` init tab; init lock | [`2026-08-05-project-parameter-initialization.md`](./2026-08-05-project-parameter-initialization.md) | `feat/project-parameter-initialization` |

### Out of scope (explicit)

- `/debugging` parameter-reload workspace (product-offline / TD-032 direction)
- Parameter reload HTTP (410 GONE) and dropped `parameter_reload_bindings`
- `/parameter-comparison` (NoEntryPage)
- Vite local HDC bridge (`viteHdcApi`) as a production seam
- Log analysis, Xiaoze main chat, product feedback (except where audit/debugging cross-cut)

## Locked decisions (program-level)

1. **Initialization = semantic snapshot** — approve copies selected source-project binding/effective values into the new project; never revive flat `recommendedValue` as API truth.
2. **Node debugging is the only runtime entry** — enhance `/node-debugging` only; do not restore `/debugging`.
3. **High-risk device writes require human confirmation** — runtime must not silently inject `confirmationToken`.
4. **Admin hints = audit projection** — no second audit store; local `PUSH_AUDIT_HINT` is not SSOT.
5. **Mock import must mutate or fail honestly** — no fake “import completed” toast.

## Delivery order

```text
C4 (honesty + cleanup)  ─┐
                          ├─► optional parallel
C2 (node UI closure)    ─┘
        │
        ▼
C3 (admin audit projection)
        │
        ▼
C1 (project initialization — largest)
```

- Prefer **C4 ∥ C2** first.
- **C3** may start after C2 mid-flight if branches do not collide on admin shell.
- **C1** is last among the four; open its branch independently but avoid concurrent large topology cutover conflicts on the same files.

This program file does **not** own a single mega-branch. Each child plan owns one feature branch from latest `main`.

## Program checklist

- [ ] C4 merged to `main`
- [ ] C2 merged; TD-015 moved to Completed (or closed with evidence)
- [ ] C3 merged
- [ ] C1 merged; design doc amendment + product-spec touch landed (implementation complete on `feat/project-parameter-initialization`; awaiting parent PR)
- [ ] Program Documentation Update Gate satisfied; `npm run docs:check` green
- [ ] Move this program to `docs/exec-plans/completed/` only after all four children complete

## Program verification gate

Before marking this program complete:

```bash
npm run docs:check
```

Plus each child’s verification commands (see child plans). Frontend-visible children (C1, C2, C3) must leave playwright-cli / acceptance evidence notes in their own Documentation Update Gate.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this program + four children, zh-CN companions |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md`, `docs/zh-CN/exec-plans/tech-debt-tracker.md` — retarget TD-015 to C2; add TD-060 (init) and TD-061 (admin audit hints) until children close |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` (+ zh-CN) — children own concrete Updates |
| Design docs | Review | `docs/design-docs/2026-05-20-project-parameter-initialization-design.md` — C1 amends |
| Frontend | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — C1/C2/C3 |
| Architecture | No change | `ARCHITECTURE.md` unless C1 introduces a new module boundary (then Update in C1) |
| API / domain | Review | Owned by C1/C3 |
| Security | Review | C2 high-risk confirm; C1/C3 audit |
| Reliability / runbooks | No change | unless C1 adds ops notes |
| Quality / acceptance | Update | Owned by C1/C2 coverage IDs |
| Generated | Review | C1 migration → `docs/generated/db-schema.md` |
| References | No change | — |

## Documentation Update Gate

Blocking for program completion:

- Every child Documentation Update Gate is closed or deferred to tech-debt with an ID.
- TD-015 closed by C2; TD-060 / TD-061 closed by C1 / C3 or explicitly re-scoped.
- Bilingual PLANS index lists the five plans; zh-CN companions exist for this program and each child.
- `npm run docs:check` passes.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work on the **child** feature branch only; commit there; do not open/merge PRs |
| Parent agent | Review child PRs, merge, sync `main`; archive this program when all children are done |

Do not open a PR for this program file alone unless packaging doc-only index updates with the first child.

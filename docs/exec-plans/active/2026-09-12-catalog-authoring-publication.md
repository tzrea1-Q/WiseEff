# Catalog authoring and publication

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-09-12-catalog-authoring-publication.md)

Status: **Active**. CP-00 contract freeze is in this change. CP-01 read-only verification is recorded separately. No production TypeScript, SQL migration, Hosted run, target-host mutation, GitHub Issue, or production enablement is claimed.

Work-package prefix: `CP`. Numbers are plan-local until Issues are authorized.

Accepted `origin/main` at this freeze: `063b12c49dbc134e83103c77b813188e34f09461` (tree follows that merge of [#826](https://github.com/tzrea1-Q/WiseEff/pull/826)). The architecture brief used `c332ed3cc2893cadc10d50e235f291bb8fd1ac30`; the delta is the vendor successor compiler and `advance` CLI. Re-fetch before every later dispatch.

Normative contracts:

- [ADR-0043](../../adr/0043-catalog-authoring-and-online-publication.md)
- [Control plane](../../design-docs/catalog-authoring-and-publication-control-plane.md)
- [Baseline verification](../../references/catalog-publication-baseline-verification.md)

## Goal

Change parameter definitions from “content that must ship with the application” into “business metadata that can be authored and published in-product,” while keeping official Subject, Definition, immutable Revision, complete Catalog Release, unique synchronizer, and exact historical interpretation.

Success layers stay distinct: implementation complete, real PostgreSQL, real browser, Hosted, target-host evidence, production authorization. None implies another.

## Scope

In:

- Typed in-product authoring and controlled YAML import into one publication pipeline.
- Frozen Artifact / Candidate / Authorization / Job / Activation Receipt.
- Online `advance` through the existing installer plus Receipt.
- Instance-shared official definitions; explicit capabilities; self-hosted low-risk single-actor publish only under real grants and explicit policy.
- `adopted-preexisting` for already-installed baselines.

Out:

- Organization-private definitions, overlays, source precedence.
- Web/SQL writers of Catalog tables.
- #824, forged P13 retirement, re-bootstrap, seed, old-migration edits.
- Changing the frozen Wayfinder #668 53-node graph.
- Production host execution in this documentation wave.

## Hard dependencies

```text
CP-00 (this freeze)
  ├─ CP-01 exact Artifact (blocks online adoption, not further contract writing)
  └─ CP-02 persistence/roles
        ├─ CP-03 Builder
        ├─ CP-04 Authorization
        └─ CP-05 online activation  ← CP-03 + CP-04
              └─ CP-06 runtime/upgrade gates
                    └─ CP-07 jobs/API/manager
                          └─ CP-08 M1 page
                                └─ CP-11(M1) → CP-12(limited)
CP-09 vendor adapter after CP-03; channel integration after CP-07
CP-10 after M1 path is stable
```

Do not ship page-direct Catalog writes before CP-05/06. Downstream may write contract tests against this freeze; launch uses only implementations that passed their native gates.

## Work-package status

| Package | Risk | State | Editable paths (later Scratch; not this wave) | Stop |
| --- | --- | --- | --- | --- |
| CP-00 contract | R3 design / R1 docs | **this candidate** | docs listed in the Documentation Impact Matrix | Reviewable docs. No product code. |
| CP-01 read-only verify | R1 | **this candidate** | `docs/references/catalog-publication-baseline-verification.md` and Chinese pair | No host login, no Catalog writes, no fixture-as-install |
| CP-01 Artifact adopt write | R3 | blocked on host evidence + CP-00/02 | publication adopt adapter | No bootstrap/seed/SQL Catalog inserts |
| CP-02 | R3 | not dispatched | next migration, `catalog-kernel/security/`, publication persistence, generated schema | Shared files owned only here |
| CP-03 | R3 | not dispatched | `server/modules/catalog-publication/builder/` | No Catalog writes |
| CP-04 | R3 | not dispatched | auth policy, proposals, publication authorization | No request-body roles; no fake repository URLs |
| CP-05 | R3 | not dispatched | `catalog-kernel/install/` | No second materializer; no cut-then-verify |
| CP-06 | R3 | not dispatched | `productionWire.ts`, release-verification, `parameter-data-mode.ts`, self-hosted gates | No deleting P13/digest checks |
| CP-07 | R3 exec / R2 HTTP | not dispatched | publication module, catalog-api routes, generated DTO | Handler is not the synchronizer |
| CP-08 | R2 | not dispatched | `src/features/parameter-catalog-governance/` and ports | Mock ≠ acceptance |
| CP-09 | R2 transform / R3 activate | not dispatched | vendor import adapter | No second writer after CP-07 |
| CP-10 | R2 / matcher R3 | not dispatched | Builder ops + UI | No silent Binding cutover |
| CP-11 | R3 | not dispatched | focused tests, e2e | Independent tester does not patch then self-pass |
| CP-12 | Temporal / ops | not dispatched | runbooks, authorized host | Default is reviewable candidate, not business-host execution |

Frontier after this wave: CP-00 reviewable; CP-01 host adoption **blocked** (host not accessed). Next dispatch only after independent review of this candidate and a separate authorization: CP-02. Do not create GitHub Issues, open a PR, or apply ready labels without that authorization.

## Evidence boundary

| Layer | This wave |
| --- | --- |
| Documentation / static | In scope (`docs:check` on the candidate) |
| Local pure/fake tests | Not run for product code (none changed) |
| Real local PostgreSQL | **Not run** |
| Browser-real | **Not run** |
| Hosted/CI | **Not run** |
| Target host | **Not accessed** |
| Release / production approval | **Not granted** |

User-reported host facts (`crel_acme_1`, digest `sha256:365305492cf3fddb973b65268d1c7b8c60715240e9fd2dac05aa9091f0c38044`, one definition) are reports for CP-01 to verify. They are not database evidence.

## Git & PR Workflow

- Scratch branch for this documentation wave: `docs/catalog-authoring-publication-cp00` from `origin/main` `063b12c49dbc134e83103c77b813188e34f09461`.
- Implementation agents commit only on the feature branch. They must not push `main`, open or merge GitHub PRs, or sync `main` after merge.
- Parent opens a PR only when this lane is `INTEGRATION-READY` **and** the user authorizes PR creation. This wave’s stop boundary is a reviewable document candidate.
- Later code lanes use distinct Scratch branches (`feat/catalog-publication-schema`, `feat/catalog-publication-builder`, …), WIP 2 when sharing migrations/OpenAPI/auth/Kernel/CI, otherwise up to 4 with review capacity reserved.
- Merge order: CP-00/01 docs → CP-02 → CP-03/04 (path-disjoint Scratch, serial on shared contracts) → CP-05 → CP-06 → CP-07 → CP-08 → CP-11(M1). CP-09 content inventory may proceed after CP-03; it must not install on a host without separate authorization.
- Stop immediately on: Catalog table writes from web, forged repository references, #824 bundling, P13 forgery, second pointer, cut-then-verify, production host mutation without explicit authorization.

Suggested later Issue titles (not created):

| ID | Title |
| --- | --- |
| CP-00 | Freeze catalog authoring/publication contract |
| CP-01 | Verify and adopt preexisting Catalog Artifact |
| CP-02 | Publication schema, receipts, and role isolation |
| CP-03 | Complete-successor Builder from typed ChangeSet |
| CP-04 | Catalog publish capabilities, policy, and bound authorization |
| CP-05 | Online activation with pre-commit verification and Receipt |
| CP-06 | Dual application/Catalog readiness and upgrade freeze |
| CP-07 | Publication jobs, API, and manager process |
| CP-08 | M1 page loop on `/parameter-admin/specs` |
| CP-09 | Vendor YAML import on the same pipeline |
| CP-10 | New subjects and revisions |
| CP-11 | Adversarial integration evidence |
| CP-12 | Target enablement and operator handoff |

## T01–T28 owners

See [control plane §10](../../design-docs/catalog-authoring-and-publication-control-plane.md). High-risk negatives are assigned before implementation.

## Focused commands (later lanes; not claimed run here)

```bash
npm run docs:check
npm run contract:check
npm run parameter-catalog-boundaries:check
npm run db:schema-doc:check
npm run test:server -- <package-owned test path>
npm run build
npm run selfhost:check
```

Angle-bracketed forms are not executable as written. New publication test entry names are registered when those files exist.

## Documentation Impact Matrix

| Document | Action | Gate |
| --- | --- | --- |
| `docs/exec-plans/active/2026-09-12-catalog-authoring-publication.md` | Add (this file) | CP-00 |
| `docs/zh-CN/exec-plans/active/2026-09-12-catalog-authoring-publication.md` | Add Chinese pair | CP-00 |
| `docs/adr/0043-catalog-authoring-and-online-publication.md` | Add | CP-00 |
| `docs/zh-CN/design-docs/adr-0043-catalog-authoring-and-online-publication.md` | Add Chinese pair | CP-00 |
| `docs/adr/0040-canonical-parameter-catalog-relational-model.md` | Limited source/authority amendment | CP-00 |
| `docs/zh-CN/design-docs/adr-0040-canonical-parameter-catalog-relational-model.md` | Same | CP-00 |
| `docs/adr/0041-platform-schema-catalog-releases-materialize-before-runtime.md` | Limited source/runtime amendment | CP-00 |
| `docs/zh-CN/design-docs/adr-0041-platform-schema-catalog-releases-materialize-before-runtime.md` | Same | CP-00 |
| `docs/design-docs/catalog-authoring-and-publication-control-plane.md` | Add | CP-00 |
| `docs/zh-CN/design-docs/catalog-authoring-and-publication-control-plane.md` | Add Chinese pair | CP-00 |
| `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md` | Addendum: Receipt, current installer, no second pointer | CP-00 text; CP-05 code |
| `docs/zh-CN/design-docs/catalog-kernel-interface-and-transaction-boundary.md` | Same | CP-00 |
| `docs/design-docs/parameter-catalog-api-transition.md` | Addendum: capabilities, routes, reasons | CP-00 text; CP-04/07 code |
| `docs/zh-CN/design-docs/parameter-catalog-api-transition.md` | Same | CP-00 |
| `docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md` | Addendum: combine app pin with Catalog activation; `new-empty` ≠ P13 | CP-00 text; CP-06 code |
| `docs/zh-CN/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md` | Same | CP-00 |
| `docs/design-docs/parameter-catalog-cutover-archive-rollback.md` | Addendum: `adopted-preexisting`; do not bundle #824 | CP-00 text; CP-01/06/12 |
| `docs/zh-CN/design-docs/parameter-catalog-cutover-archive-rollback.md` | Same | CP-00 |
| `docs/references/catalog-publication-baseline-verification.md` | Add CP-01 record | CP-01 |
| `docs/zh-CN/references/catalog-publication-baseline-verification.md` | Add Chinese pair | CP-01 |
| `docs/adr/README.md`, `CONTEXT.md` | Index ADR-0043; glossary source clause | CP-00 |
| `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | Index this plan | CP-00 |
| `docs/design-docs/index.md` and Chinese | Index control plane | CP-00 |
| `scripts/bilingual-docs.ts` | Register control-plane pair | CP-00 |
| `docs/runbooks/catalog-publication.md` | Later | CP-07/12 |
| `docs/generated/db-schema.md` | Generated only | CP-02 |
| Frozen Wayfinder plan 53-node map | No change | — |

Old assertions are not bulk-deleted. “Proposal acceptance does not materialize” remains a test. “No web request can ever ask for official publication” is the product constraint this program replaces.

## Documentation Update Gate

- Language pairs are separate linked files. Commands, paths, API names, states, and capabilities stay English in both.
- Facts, targets, and unverified states are labeled. This wave does not write “completed” for CP-02–CP-12.
- Generated schema/OpenAPI are not hand-edited.
- `npm run docs:check` must pass on this candidate before calling CP-00 locally green.
- Target-host and production sentences stay `not-run` / `not-granted`.
- Links in changed files must resolve.

## Completion checklist for this wave

- [x] ADR number 0043 confirmed unused at freeze SHA
- [x] Retain/supersede table for ADR-0040/0041
- [x] Frozen ChangeSet, relations, API, reasons, capabilities, T01–T28 owners
- [x] CP-01 record does not treat the user brief as host evidence
- [ ] Independent Standards/Spec review of this SHA
- [ ] User authorization to open a PR
- [ ] Hosted
- [ ] Merge
- [ ] Production enablement

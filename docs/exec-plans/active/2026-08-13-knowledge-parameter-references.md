# Structural parameter-to-knowledge references

> Status: **Active**
> Date: 2026-08-13
> Branch: `feat/knowledge-parameter-references`
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-13-knowledge-parameter-references.md`](../../zh-CN/exec-plans/active/2026-08-13-knowledge-parameter-references.md)
> Design: [`docs/design-docs/2026-08-12-knowledge-base-design.md`](../../design-docs/2026-08-12-knowledge-base-design.md) — deferred roadmap item 2
> Predecessors: [`2026-08-12-knowledge-base-mvp.md`](../completed/2026-08-12-knowledge-base-mvp.md), [`2026-08-13-knowledge-log-recommendations.md`](../completed/2026-08-13-knowledge-log-recommendations.md)
> Integrity ADRs: [ADR-0011](../../adr/0011-spec-deprecation-is-soft-retirement.md) (spec deprecation is soft retirement), [ADR-0013](../../adr/0013-attribution-subjects-are-stable-catalog-entities.md) (attribution subjects are stable catalog entities), [ADR-0017](../../adr/0017-definition-identity-is-correctable.md) (`parameter_specs.id` is a surrogate)

## Goal

A knowledge entry can declare structural references to parameter definitions, and both sides render them honestly:

- **Reference entity**: `knowledge_parameter_references` rows bind a knowledge entry to `parameter_specs.id` — the stable surrogate key (ADR-0017), never a project binding or logical node id — with organization scope, creator attribution, a unique (entry, spec) pair, and FKs on both sides. Hard-deleting an entry cascades its reference rows, and the existing delete audit records the removed reference count.
- **Authoring**: references are edited from the knowledge-entry side by whoever may edit the entry (`knowledge:edit` own / `knowledge:manage` any) through a parameter-definition picker (searching via the parameter-specs read API the caller can already use; `parameter:view` gates the search). Add/remove are audited through the ADR-0027 seam.
- **Knowledge side**: entry detail shows referenced definitions as chips (name, module, lifecycle badge — deprecated definitions show 已废弃 honestly per ADR-0011, and the reference **survives** deprecation) deep-linking to `/parameter-admin?spec=…`.
- **Parameter side**: the definition detail dialog gains a 相关知识 list showing **published** entries referencing that definition (published-only invariant: drafts/archived never appear regardless of who looks; `knowledge:view` required, section hidden otherwise). Organization scope is enforced server-side on every read.
- **Xiaoze**: the existing `knowledge.getDocument` read-tool payload gains the entry's referenced definitions (id + name + lifecycle) so grounding answers can name the parameters; no new tools.

## Non-goals

- No reverse authoring: references are never edited from the parameter side.
- No references to project bindings, logical nodes, config sets, or spec *versions* — the subject is the definition (`parameter_specs.id`) only.
- No retrieval-index or embedding changes: references do not affect search ranking.
- No new permissions: existing `knowledge:view` / `knowledge:edit` / `knowledge:manage` / `parameter:view` compose.
- No DTS-reload run distillation, collections, or MCP surface (deferred roadmap items 3-5).

## Integrity rules (the point of this feature)

| Event | Behavior |
| --- | --- |
| Spec identity correction (ADR-0017 re-attribution / property-key rename) | References bind to the surrogate `parameter_specs.id`, which never changes during a correction — references survive untouched. |
| Spec deprecation (ADR-0011 soft retirement) | The reference row stays; both display sides keep the chip/entry and show the 已废弃 lifecycle badge honestly. |
| Spec hard delete | **The catalog has no spec hard-delete path** (no delete route or service function exists; deprecation is the only retirement, ADR-0011). The FK therefore uses the default restrictive behavior: any future delete path must decide reference disposition explicitly instead of losing rows silently. |
| Entry archive | Reference rows stay; the entry drops out of the parameter-side 相关知识 list because that list is published-only. Restore brings it back. |
| Entry hard delete | Reference rows cascade with the entry; the existing `knowledge-entry-delete` audit metadata gains `parameterReferenceCount`. |
| Cross-organization | A caller can only reference specs their organization can read (org-owned or platform-global, same rule as the spec detail API); reads are organization-scoped server-side. |

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/knowledge-parameter-references`; do not push, open, or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `feat/knowledge-parameter-references`, checked out from the latest `main` (worktree-isolated).

## Tasks

1. **Acceptance registration first**: add `KB-XREF-001` (edit references on an entry; see the published entry on the definition detail; drafts never appear; deprecation keeps the chip with an honest badge) to `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` (EN + zh), `e2e/acceptance/requirements.ts`, and `e2e/acceptance/operationMatrix.ts` before implementing the UI.
2. **Migration** `0109_knowledge_parameter_references.sql`: the reference table (uuid pk, `organization_id` FK, `entry_id` FK `on delete cascade`, `parameter_spec_id` text FK to `parameter_specs(id)` with default restrictive delete behavior, `created_by_user_id` FK, `created_at`, unique `(entry_id, parameter_spec_id)`), plus a `(organization_id, parameter_spec_id)` index for the parameter-side read.
3. **Backend** (`server/modules/knowledge/`): `parameterReferences.ts` repository/service slice — `PUT /api/v1/knowledge/entries/:entryId/parameter-references/:specId` (idempotent add) and `DELETE …/:specId`, gated by the same `requireKnowledgeGovern` rule as entry editing, refusing archived entries like content edits, validating the spec exists in caller scope (org-owned or platform-global), audited via the ADR-0027 seam (`knowledge-parameter-reference-add`/`-remove`); entry DTOs gain `parameterReferences` (spec id, property key, display name, driver module, lifecycle) loaded for list + detail; `GET /api/v1/knowledge/related-to-spec?specId=…` returns published-only referencing entries (`knowledge:view`, org-scoped, 404 for specs outside caller scope); hard delete records `parameterReferenceCount` in its audit metadata; `getPublishedKnowledgeDocument` + `knowledge.getDocument` tool payload gain `referencedParameters` (id + name + lifecycle); routeManifest + schemaRegistry entries; regenerate `docs/generated/openapi.json`.
4. **Frontend**: domain type `KnowledgeParameterReference` + `KnowledgeEntry.parameterReferences`; `KnowledgeRepository` port methods `addParameterReference` / `removeParameterReference` / `relatedToSpec`; HTTP client + mock implementations (mock keeps the same published-only and lifecycle-badge semantics and seeds one referenced definition); knowledge entry detail dialog renders reference chips (name, module, lifecycle badge, deep link `/parameter-admin?spec=…`); entry editor gains the picker section for existing entries (search via `ParameterTopologyRepository.listSpecs`, add/remove immediate, hidden without `parameter:view` or a topology repository); definition detail dialog (`ParameterSpecDetail`) gains a 相关知识 section (published entries, deep link `/knowledge?entryId=…`), injected from the parameter-admin page only when the caller holds `knowledge:view`.
5. **Acceptance spec**: extend `e2e/acceptance/knowledge.acceptance.spec.ts` with the KB-XREF-001 scenario (seed a spec; reference it from a published entry and a draft entry; assert the parameter-side list shows only the published entry; deprecate the spec and assert the chip survives with the 已废弃 badge; assert audit rows and DB state).
6. **Docs**: api-contract EN + zh (three endpoints + entry DTO change); FRONTEND EN + zh (chips, picker, 相关知识 section, port methods); domain-model EN + zh entity note (knowledge parameter reference + integrity rules); design-doc EN + zh mark deferred roadmap item 2 shipped; regenerate `docs/generated/db-schema.md` (pgvector container per the TD-091 rule); PLANS EN + zh.

## Verification

- Targeted vitest: `server/modules/knowledge/parameterReferences.test.ts` (reference CRUD, idempotent add, archived-entry refusal, draft-never-on-parameter-side, deprecation survival, entry-delete cascade + audit count, org isolation, permission negatives, spec-scope negatives), `server/modules/knowledge/routes.test.ts`, `server/modules/agent/tools/knowledgeTools.test.ts`, `src/infrastructure/mock/mockKnowledgeRepository.test.ts`, `src/infrastructure/http/knowledgeClient.test.ts`, knowledge page/dialog component tests.
- `npm run test:server`; `npm test`; `npm run build`; `npm run docs:check`; `npm run contract:openapi` + `npm run contract:check`; `npm run acceptance:coverage` + `npm run acceptance:operations`.
- `npm run acceptance:e2e -- knowledge.acceptance.spec.ts` on an isolated stack (dedicated pre-migrated database `wiseeff_kb_xref`, frontend port within the 5173-5199 CORS whitelist).
- playwright-cli checks of the `/knowledge` entry editor picker + `/parameter-admin` definition-detail 相关知识 section at 1440x900 / 768x1024 / 390x844 (snapshot + screenshot under `work/ui-checks/`, `console error` clean).

## Success criteria

- An editor can add and remove definition references on their own entry; a manager on any entry; viewers and non-owners get 403; archived entries refuse reference edits like content edits.
- References bind to `parameter_specs.id` and survive identity corrections and deprecation; deprecated definitions render an honest 已废弃 badge on the knowledge side while the reference stays.
- The definition detail 相关知识 list shows published referencing entries only — drafts and archived entries never appear for any caller; the section is hidden without `knowledge:view`; organization scope is enforced server-side.
- Hard-deleting an entry removes its reference rows and the delete audit records how many were removed.
- `knowledge.getDocument` reports the entry's referenced definitions (id + name + lifecycle).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan + zh companion; `docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| Design docs | Update | `docs/design-docs/2026-08-12-knowledge-base-design.md` + zh (mark deferred roadmap item 2 shipped) |
| Domain / glossary | Update | `docs/design-docs/domain-model.md` + zh (knowledge parameter reference entity + integrity rules); `CONTEXT.md` unchanged (no new ubiquitous-language term beyond the entity note) |
| API | Update | `docs/design-docs/api-contract.md` + zh; `docs/generated/openapi.json` |
| Frontend | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` (chips, picker, 相关知识 section, port methods) |
| Quality / acceptance | Update | `docs/developer/browser-acceptance-coverage-map.md` + zh; `docs/developer/user-operation-coverage-matrix.md` + zh; `e2e/acceptance/knowledge.acceptance.spec.ts` |
| Generated artifacts | Update | `docs/generated/openapi.json`; `docs/generated/db-schema.md` (migration 0109) |
| Security | No change | `docs/SECURITY.md` — existing permissions compose; no new permission or trust boundary |
| Product specs | Review | `docs/product-specs/product-spec.md` + zh — knowledge workflow wording already covers cross-references generically; update only if wording needs it |
| Repository maps | No change | `ARCHITECTURE.md` — no new module or runtime seam |
| Reliability / runbooks | No change | No new env keys, jobs, or operations procedures |
| Developer env | No change | `.env.example`, `docs/developer/environment-variables.md` — no new keys |
| References | No change | `docs/references/` — not affected |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md` — record any deferral leaving this plan |

## Documentation Update Gate

- [x] KB-XREF-001 registered in coverage map + operation matrix (EN + zh) before UI implementation
- [x] api-contract EN + zh and `docs/generated/openapi.json` include the two reference-edit endpoints, the entry DTO change, and `GET /api/v1/knowledge/related-to-spec`
- [x] FRONTEND EN + zh document the reference chips, the editor picker, the 相关知识 section, and the port methods
- [x] domain-model EN + zh record the reference entity and its integrity rules
- [x] Design doc EN + zh mark deferred roadmap item 2 as shipped
- [x] `docs/generated/db-schema.md` regenerated with migration 0109
- [x] PLANS EN + zh list this active plan
- [x] Tech-debt tracker reviewed — no deferral leaves this plan, nothing to record
- [x] `npm run docs:check` green

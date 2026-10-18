# WiseEff Development Roadmap

> Chinese: [Chinese](../../zh-CN/exec-plans/development-roadmap.md)

Date: 2026-10-13

## Current State

M0-M5 productization foundations and substantial M6 self-hosted implementation have merged. The current repository baseline includes the React/Vite/TypeScript frontend, mock and API runtimes, a TypeScript modular backend, PostgreSQL migrations, auth/audit boundaries, OpenAPI checks, Redis/BullMQ queue support, worker/object-store and HDC gateway seams, Xiaoze integration, observability, and release/upgrade tooling. Implementation and target-environment acceptance are separate milestones.

Delivered capabilities on this branch include:

- **User Guide and Platform Overview (#1143):** this change delivers the bilingual task guides and platform map, with product-user and newcomer entry points. Delivery on this branch does not imply merge or production readiness.
- **Canonical parameter Catalog:** publication, release building, and canonical parameter integration across workbench, debugging, knowledge, logs, and Xiaoze. The [authoring and publication design](../../design-docs/catalog-authoring-and-publication-control-plane.md) owns the model; merged code does not by itself establish production cutover readiness.
- **Knowledge base:** search, entry publication, and canonical Definition references, with [knowledge design](../../design-docs/2026-08-12-knowledge-base-design.md) as the topic owner.
- **Agentic log analysis:** the multi-step kernel, domain/tool context, evaluation harness, and explicitly labeled rules fallback. The [active analysis plan](2026-08-12-agent-log-analysis-system.md) records implementation as complete; real expert-annotated cases, a second pilot domain, and human judge calibration remain external inputs. The proposed [analysis skill platform plan](2026-10-18-log-analysis-skill-platform.md) (ADR-0047) generalizes it so administrators build per-module analysis skills without code changes.
- **DTS reload and organization administration:** reload candidates, runs, deployment, baseline restoration, and draft promotion; organization settings, member/role governance, activation, and registration-role approvals. See the [organization administration design](../../design-docs/2026-08-19-organization-administration-design.md).
- **Frontend overhaul, delivered slices:** shared design-system work, the parameter/Catalog navigator workbench, unified review inbox, and Chinese Catalog names have merged through #1117, #1124, and #1125. The remaining template migrations and regression guards are still open under #1126; the overhaul is not complete.

The product is suitable for controlled staging and pilot evidence collection. As stated in the [README](../../../README.md), it is not broadly production-ready until real target-environment evidence exists for live API, PostgreSQL-backed E2E, HDC device lab, backup/restore, rollback, identity, queue, observability, capacity, and Xiaoze LLM readiness checks. Local tests, merged implementation, and individual host rehearsals do not replace those gates; mock mode remains for demos/tests, not production business data.

## Engineering Principles

- Build backend foundations before replacing frontend data sources.
- Route every domain through ports before connecting real APIs.
- Keep mock runtime for demos and tests, not production business data.
- Treat Agent and device writes as approval/audit workflows.
- Verify each milestone with tests, docs, and evidence gates.

## Milestones

- M0: productization foundation.
- M1: parameter management MVP.
- M2: log analysis MVP.
- M3: debugging MVP.
- M3.5: commercial readiness hardening for M1-M3.
- M4: Agent collaboration MVP.
- M5: commercial pilot readiness and evidence governance.
- M6: self-hosted production hardening, including identity, storage/backup, queue, observability, release, rollback, capacity, and target evidence.

## Active Plans

- Xiaoze general agent: P0 perception complete ([P0](../completed/2026-06-24-xiaoze-p0-perception.md)); P1 action complete including the in-browser HITL resume loop ([P1](../completed/2026-06-24-xiaoze-p1-action.md), TD-028 closed 2026-06-24); P2 planning complete ([P2](../completed/2026-06-24-xiaoze-p2-planning.md): LangGraph plan-act-observe loop, checkpoint resume, opt-in proactive suggestions), per the [design spec](../../design-docs/2026-06-24-xiaoze-agent-design.md). The later PostgreSQL durable-checkpoint implementation closed TD-029; the historical P2 deferral is not current backlog (see the [tech-debt tracker](../tech-debt-tracker.md)).

## Current Active Focus

This is a dated priority snapshot, not a delivery schedule. Active-plan placement alone is not proof that implementation is unfinished: some plans retain historical status or await external evidence. Reconcile them with merged code, the [tech-debt tracker](../tech-debt-tracker.md), and open `ready-for-agent` issues before starting work.

- **Finish the frontend overhaul:** [#1126](https://github.com/tzrea1-Q/WiseEff/issues/1126) remains open and `ready-for-agent`, including admin-list and settings-form templates (#1128, #1129, #1132), remaining workbench migrations, compact-PC coverage, accessibility lint, visual baselines, and the TD-113 token ratchet. Preserve existing permissions and approval behavior.
- **Close trusted-provenance gaps:** TD-068 has landed trusted-context propagation in DTS reload and parameter paths, but [#615](https://github.com/tzrea1-Q/WiseEff/issues/615) and its `ready-for-agent` closure slices still own legacy-label contraction and unified evidence under #609. The [trusted-invocation plan](2026-08-24-td-068-trusted-invocation-context-seam.md) and tracker must not be read as proof of end-to-end closure. TD-123 debugging audit provenance remains separate and open.
- **Collect target and domain evidence:** follow the active [non-HDC target-evidence plan](2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md), M6 identity/storage/queue/observability/release plans, and the log-analysis plan's external-input requirements. TD-007 still needs target Redis evidence and capacity tuning; do not infer full-pilot acceptance from repository checks.
- **Keep the self-hosted path operable:** the [IP lab profile](2026-08-18-self-hosted-ip-lab-profile.md), [setup wizard](2026-08-18-self-hosted-setup-wizard.md), and [upgrade plan](2026-08-20-self-hosted-one-command-upgrade.md) own setup, recovery, and remaining verification. Their older branch/run notes are historical context, not a current host-health claim. The [CI feedback-loop plan](../completed/2026-08-18-ci-feedback-loop-optimization.md) is completed (#523–#525).
- **Close remaining contracts:** TD-003 still tracks handwritten-client contract coverage. This follow-up is not a new production-readiness claim.

Do not move an active plan to completed until its Documentation Update Gate and verification commands pass. No completion dates are promised here.

## Engineering Workflow

Every feature branch should update or add tests first, keep `npm test` and `npm run build` passing, update API contracts and DTOs when endpoints change, include negative tests for permissions/audit/Agent/device paths, and run `npm run docs:check` for documentation-impacting work.

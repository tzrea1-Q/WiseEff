# Documentation Governance Audit

Date: 2026-05-29

## Reason

M5 commercial pilot readiness has merged through PR #39. This audit records which key documents were reviewed or updated during M5.1 so future agents do not rely on stale roadmap, architecture, status, or evidence language.

## Reviewed Documents

| Document | Decision | Notes |
| --- | --- | --- |
| AGENTS.md | Review | Agent guide should mention mandatory documentation governance for future plans while staying short and navigable. |
| README.md | Review | Project status should reflect the M5 merged baseline and continue routing operators to honest M5.1 evidence closure. |
| ARCHITECTURE.md | Update | Runtime map still needs to distinguish implemented worker, Agent, and gateway seams from future durable infrastructure and external evidence. |
| docs/README.md | Update | Knowledge-base baseline should move from M0-era wording to the merged M0-M5 baseline. |
| docs/PLANS.md | Update | Planning state should list M5.1 as active, archive completed M5 work, and carry the documentation impact matrix/update gate rule. |
| docs/QUALITY_SCORE.md | Update | Scores and evidence should reflect PR #39 merge, GitHub CI success, and remaining external pilot proof. |
| docs/RELIABILITY.md | Review | Confirm M5 readiness wording stays honest about staging, HDC device-lab, backup/restore, rollback, and live provider evidence. |
| docs/SECURITY.md | Review | Confirm production auth, Agent provider, device gateway, approval, and audit boundaries match the M5 merged implementation. |
| docs/FRONTEND.md | Review | Confirm mock/API runtime guidance, M5 pilot gate wording, and remaining UI/documentation gaps are current. |
| docs/design-docs/full-stack-architecture.md | Update | Distinguish implemented M5 seams from future production infrastructure, durable queue, cloud SDK, and real environment proof. |
| docs/design-docs/api-contract.md | Review | Confirm the committed OpenAPI artifact, contract freshness gate, and API drift responsibilities are accurate. |
| docs/design-docs/deployment-operations.md | Update | Add M5.1 evidence closure, PR #39/CI context, and clarify that staging evidence is still required. |
| docs/design-docs/security-governance.md | Update | Add the M5 pilot HMAC, HDC, live Agent provider, and outage evidence boundary note. |
| docs/design-docs/testing-strategy.md | Update | Add documentation governance verification and `docs:check` expectations alongside release gates. |
| docs/exec-plans/active/development-roadmap.md | Update | Mark M0-M5 implementation as merged and M5.1 as the current documentation/evidence closure before new scope. |
| docs/exec-plans/tech-debt-tracker.md | Review | Keep TD-019 open until real staging, HDC device-lab, backup/restore, rollback, and live smoke evidence exists. |
| docs/generated/db-schema.md | Update | Source list and `agent_run_traces` summary now include `0010_m5_agent_provider_traces.sql` and provider latency/token/cost/safety/fallback columns. |
| docs/generated/m5-pilot-acceptance.md | Update | Record PR #39 merge and CI success; keep external checks unchecked until they are actually run. |
| docs/references/productization-api-contract-draft.md | Update | Historical runtime note now distinguishes the old draft from the current mock plus HTTP API runtime baseline. |
| docs/references/* | Review | Tooling references for Vite, Vitest, node-postgres, uv, and nixpacks were spot-checked; no contradictory M5 runtime or stack assumptions were found beyond the API contract draft update. |
| docs/runbooks/m5-commercial-pilot-readiness.md | Update | Add documentation/evidence closure to the go/no-go process and keep pilot signoff tied to real target-environment evidence. |

## Additional Review Notes

- Product docs and references were reviewed for stale prototype-only, runtime, tooling, or API assumptions; only status notes were updated, and product intent was not rewritten.
- Generated artifacts should stay evidence-based: OpenAPI freshness is covered by `npm run contract:check`, and the database schema summary was manually aligned to the current migration list.
- External pilot evidence should remain visibly separate from repository-local proof so PR #39 and CI success are not overstated as staging or device-lab signoff.

## Remaining Documentation Risks

- No external pilot evidence should be marked complete until the target environment has run it.
- Future plans must carry a documentation impact matrix and update gate.

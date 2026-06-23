# WiseEff Testing Strategy

> Chinese: [Chinese](../zh-CN/design-docs/testing-strategy.md)

Date: 2026-05-25

## Goals

WiseEff's test strategy upgrades the prototype into a product-quality gate. The test suite must cover domain rules, API contracts, key UI workflows, permission boundaries, async jobs, Agent tool governance, device gateway behavior, and operations evidence.

## Layers

| Layer | Goal | Tooling |
| --- | --- | --- |
| Domain unit tests | Pure rules, state machines, permissions, derived data | Vitest |
| Component tests | Page/component interaction, accessibility, edge states | Testing Library |
| API integration tests | Routes, database writes, transactions, error model | Vitest server tests |
| Contract tests | OpenAPI and DTO drift | Contract scripts |
| State-model tests | Workflow transitions and invariants | fast-check + Vitest |
| E2E tests | Login, parameter workflow, log upload, debugging | Playwright |
| Job tests | Worker retry, failure, idempotency | Queue/database tests |
| Agent tests | Tool permissions, approvals, structured output | Model mocks and golden cases |
| Device tests | Gateway reads/writes and failures | Simulator and HDC lab |
| Security tests | RBAC, authz, audit, validation | Automated negative cases |

## Browser Acceptance

Browser acceptance covers requirement IDs and operation IDs from `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md`. Evidence-grade runs write replayable records under `docs/generated/acceptance-operation-evidence.md` and its index.

Debugging admin catalog changes are covered by `DEBUG-ADMIN-001` in `e2e/acceptance/debugging-admin.acceptance.spec.ts`. The acceptance flow exercises Admin UI, API, DB persistence, and audit evidence for parameter create/edit/archive/restore plus HDC/ADB binding management and complex value metadata editing.

Simulator debugging is covered by `DEBUG-SIM-001` in `e2e/acceptance/debugging-simulator.acceptance.spec.ts`, including a complex JSON write path that records `valueKind`, digest, and preview metadata in `node_operations` without leaking full payloads into operation evidence.

Targeted unit coverage includes `server/modules/debugging/valueCodec.test.ts`, gateway preservation tests, admin/runtime UI tests, and DTO mapper tests for legacy scalar defaults.

## Key Commands

```bash
npm test
npm run test:server
npm run test:all
npm run build
npm run contract:check
npm run acceptance:models
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:evidence
npm run acceptance:quality
```

Pi-backed provider work should also run:

```bash
npm run agent:pi-eval
npm test -- scripts/run-pi-agent-smoke.test.ts
npm run test:server -- server/modules/agent/piProvider.test.ts server/modules/agent/providerRegistry.test.ts server/modules/agent/orchestrator.test.ts
npm run test:server -- server/modules/agent/providerEvidence.test.ts server/modules/operations/health.test.ts server/modules/operations/routes.test.ts server/observability/metrics.test.ts server/app.test.ts
npm run test:m4
npm run build
```

These tests cover `@earendil-works/pi-ai` adapter mapping, unknown or ungrounded tool rejection, registry selection through `AGENT_API_FORMAT=pi`, safe provider evidence, readiness and pilot-readiness details, low-cardinality metrics labels, and the existing WiseEff approval boundary for Pi-like mutating tool plans. `agent:pi-eval` is offline and deterministic. `agent:pi-smoke` is live-key dependent and should be attached only as target or staging provider evidence.

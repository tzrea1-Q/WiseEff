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

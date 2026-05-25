# WiseEff Knowledge Base

Date: 2026-05-25

This directory is the repository knowledge base. `AGENTS.md` and `ARCHITECTURE.md` are short maps; the durable product, architecture, design, quality, reliability, security, and execution knowledge lives here.

## Reading Order

1. [Product Specs](product-specs/index.md): product goals, prototype behavior, MVP scope, and onboarding flows.
2. [Architecture](../ARCHITECTURE.md): top-level runtime and codebase map.
3. [Design Docs](design-docs/index.md): full-stack architecture, domain model, API contract, historical designs, testing, deployment, and security.
4. [Frontend](FRONTEND.md): frontend structure, UI rules, runtime modes, and testing expectations.
5. [Plans](PLANS.md): how active and completed execution plans are managed.
6. [Quality Score](QUALITY_SCORE.md): current quality grades and verification gates.
7. [Reliability](RELIABILITY.md): operational, task, deploy, and rollback expectations.
8. [Security](SECURITY.md): identity, RBAC, audit, Agent tools, device safety, and data protection.

## Directory Layout

```text
docs/
  design-docs/
    index.md
    core-beliefs.md
    full-stack-architecture.md
    domain-model.md
    api-contract.md
    ...
  exec-plans/
    active/
    completed/
    tech-debt-tracker.md
  generated/
    db-schema.md
  product-specs/
    index.md
    product-spec.md
    prototype-functional-spec.md
    mvp-scope.md
    new-user-onboarding.md
  references/
    design-system-reference-llms.txt
    nixpacks-llms.txt
    uv-llms.txt
    vite-react-llms.txt
    vitest-llms.txt
    node-postgres-llms.txt
  DESIGN.md
  FRONTEND.md
  PLANS.md
  PRODUCT_SENSE.md
  QUALITY_SCORE.md
  RELIABILITY.md
  SECURITY.md
```

## Status

This harness structure reorganizes existing WiseEff docs without changing product code. The existing productization docs were moved into `product-specs/`, `design-docs/`, and `exec-plans/` so future agents can find the right source of truth without relying on chat history.

Current baseline:

- Frontend prototype: React, Vite, TypeScript, mock runtime, HTTP runtime seam.
- Backend M0: TypeScript Node server, auth context endpoint, audit boundary, migration skeleton.
- Main product priority: make parameter management the first real closed-loop workflow, then move logs, debugging, and Agent orchestration from mock/demo paths to governed backend paths.

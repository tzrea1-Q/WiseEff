# WiseEff Development Roadmap

> Chinese: [Chinese](../../zh-CN/exec-plans/development-roadmap.md)

Date: 2026-05-25

## Current State

M0-M5 productization work has merged and M6 self-hosted hardening is in progress. WiseEff now has a React/Vite/TypeScript frontend with mock and API runtimes, a TypeScript modular backend, PostgreSQL migrations, auth/audit boundaries, OpenAPI checks, worker/object-store seams, Redis/BullMQ queue support, HDC gateway seams, live Agent provider seams, observability, and release-readiness work.

The product is suitable for controlled staging and pilot evidence collection. It is not broadly production-ready until target evidence is collected for identity, backup/restore, queue, observability, rollback, capacity, target synthetic browser acceptance, HDC device-lab, and live Agent provider paths.

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

- Xiaoze general agent: P0 perception complete ([P0](../completed/2026-06-24-xiaoze-p0-perception.md)); P1 action complete including the in-browser HITL resume loop ([P1](../completed/2026-06-24-xiaoze-p1-action.md), TD-028 closed 2026-06-24); P2 planning complete ([P2](../completed/2026-06-24-xiaoze-p2-planning.md): LangGraph plan-act-observe loop, `MemorySaver` checkpoint resume, opt-in proactive suggestions; durable checkpointing deferred as TD-029), per the [design spec](../../superpowers/specs/2026-06-24-xiaoze-agent-design.md).

## Current Active Focus

Active plans under `docs/exec-plans/active/` track remaining target evidence and self-hosted hardening. Do not move a plan to completed until its Documentation Update Gate and verification commands pass.

## Engineering Workflow

Every feature branch should update or add tests first, keep `npm test` and `npm run build` passing, update API contracts and DTOs when endpoints change, include negative tests for permissions/audit/Agent/device paths, and run `npm run docs:check` for documentation-impacting work.

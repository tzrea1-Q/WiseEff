# WiseEff Bilingual Developer Docs Implementation Plan

> **For agentic workers:** This plan has been completed. Future work should use the bilingual inventory in `scripts/bilingual-docs.ts` and the governance checks in `scripts/check-doc-governance.ts`.

**Goal:** Convert every developer-facing document that humans are expected to read into separate English and Chinese documentation files linked to each other.

**Architecture:** Keep language-specific documents separate and connect them through reciprocal links. English pages stay in their current canonical locations. Chinese pages live under `docs/zh-CN/` or next to operational files as `*.zh-CN.md`. Repository maps and `npm run docs:check` enforce the bilingual-link rule.

**Tech Stack:** Markdown, TypeScript documentation governance checks, npm scripts.

---

## Scope Boundary

Included: developer-facing documentation inventory, reciprocal language links, Chinese companion pages, English cleanup where English-path docs contained Chinese prose, and governance checks that prevent future drift.

Excluded: generated artifacts, completed historical plans, historical design records, external references, and application runtime i18n.

## Implementation Tasks

- [x] Lock the bilingual governance rule in `AGENTS.md` and `docs/PLANS.md`.
- [x] Add machine-readable bilingual inventory and validation in `scripts/bilingual-docs.ts` and `scripts/check-doc-governance.ts`.
- [x] Pair core entry points.
- [x] Pair daily developer operation docs.
- [x] Pair product, architecture, API, and security docs.
- [x] Pair runbooks and self-hosted operations.
- [x] Pair standing planning context.
- [x] Remove Chinese prose from required English developer-facing docs.
- [x] Run final verification.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/README.md` | Added language links and bilingual rule. |
| Planning docs | Update | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, `docs/exec-plans/tech-debt-tracker.md`, this plan | Planning docs are bilingual governance surfaces. |
| Product specs | Update | `docs/product-specs/*.md`, `docs/zh-CN/product-specs/*.md` | Product behavior docs are developer-facing. |
| Architecture docs | Update | `docs/design-docs/*.md`, `docs/zh-CN/design-docs/*.md` | Current architecture docs are paired; historical dated designs remain excluded. |
| Quality/testing docs | Update | `docs/developer/*.md`, `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, Chinese companions | Verification gates are developer-facing. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/*.md`, `ops/self-hosted/**/*.md`, Chinese companions | Operational procedures have bilingual linked pages. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/security/*.md`, Chinese companions | Security obligations are developer-facing. |
| Generated artifacts | Review | `docs/generated/*` | Excluded unless promoted to human-operated evidence. |
| Governance scripts | Update | `scripts/bilingual-docs.ts`, `scripts/check-doc-governance.ts`, `scripts/check-doc-governance.test.ts` | Enforce bilingual pairs, reciprocal links, English-side language separation, and mojibake checks. |

## Documentation Update Gate

- [x] `AGENTS.md` contains the bilingual developer-facing documentation rule.
- [x] Every required developer-facing doc in `scripts/bilingual-docs.ts` has a separate companion file.
- [x] Every paired doc links to its companion near the top.
- [x] Required English developer-facing docs contain no Chinese prose outside code blocks.
- [x] `npm run docs:check` passes.
- [x] `npx vitest run scripts/check-doc-governance.test.ts` passes.
- [x] `git diff --check` passes.

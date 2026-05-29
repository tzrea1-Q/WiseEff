# WiseEff Developer Docs zh-CN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chinese developer-documentation layer for WiseEff's key developer-facing knowledge without replacing the existing English source documents.

**Architecture:** Keep canonical detailed docs in their current locations, add `docs/zh-CN/` as a curated Chinese developer reading path, and link it from the normal docs entry points. The Chinese layer is not a machine-generated mirror; it is an independently readable guide that points back to detailed English docs when deeper historical detail is needed.

**Tech Stack:** Markdown documentation, existing `docs:check` governance script, repository docs index, execution-plan governance.

---

## Scope Boundary

This plan includes:

- A Chinese developer documentation index under `docs/zh-CN/`.
- Chinese developer guides for architecture, frontend, backend/runtime/operations, security/reliability, quality gates, and plan governance.
- Links from the English docs index and repository maps so Chinese-speaking developers can find the new material.
- Documentation governance language requiring future developer-facing docs to either update the Chinese layer or record why no Chinese update is needed.
- Ignoring local backup/restore artifacts so documentation work is not polluted by local validation outputs.

This plan does not include:

- Translating every historical design document or completed execution plan word-for-word.
- Translating generated artifacts such as `docs/generated/openapi.json`.
- Translating external reference notes under `docs/references/`.
- Adding runtime i18n for the application UI.

## File Structure

Modify:

- `.gitignore`: ignore local `.wiseeff-backups/` and `.wiseeff-restore/` directories.
- `AGENTS.md`: add Chinese documentation routing for developer-facing reading.
- `ARCHITECTURE.md`: link the Chinese architecture guide from the high-level map.
- `docs/README.md`: add a Chinese developer reading path.
- `docs/PLANS.md`: add the bilingual developer-doc governance rule.

Create:

- `docs/zh-CN/README.md`: Chinese knowledge-base entry point and reading order.
- `docs/zh-CN/architecture.md`: Chinese architecture summary for developers.
- `docs/zh-CN/frontend.md`: Chinese frontend runtime and contribution guide.
- `docs/zh-CN/backend-runtime.md`: Chinese backend, database, worker, object-store, device, and Agent runtime guide.
- `docs/zh-CN/security-reliability.md`: Chinese security, audit, reliability, backup, rollback, and pilot-readiness guide.
- `docs/zh-CN/quality-and-plans.md`: Chinese verification gates, plan lifecycle, and documentation governance guide.

## Task 1: Add Chinese Developer Docs

- [x] **Step 1: Create `docs/zh-CN/README.md`**

Add a Chinese entry document with:

- scope statement for Chinese developer docs;
- reading order;
- links to the five Chinese guide files;
- note that detailed English docs remain the canonical deep references until a Chinese page explicitly replaces them.

Expected: Chinese-speaking developers can start from one file and know what to read next.

- [x] **Step 2: Create the five focused Chinese guide files**

Create:

- `architecture.md`
- `frontend.md`
- `backend-runtime.md`
- `security-reliability.md`
- `quality-and-plans.md`

Expected: each file is concise enough to scan but complete enough to onboard a developer without reading chat history.

## Task 2: Wire Chinese Docs Into Existing Entry Points

- [x] **Step 1: Update `docs/README.md`**

Add a `Chinese Developer Docs` section near the reading order with a link to `zh-CN/README.md`.

- [x] **Step 2: Update `AGENTS.md`**

Add a routing note that Chinese developer onboarding starts at `docs/zh-CN/README.md`.

- [x] **Step 3: Update `ARCHITECTURE.md`**

Add the Chinese architecture guide to the deeper-docs list.

Expected: humans and agents can discover the Chinese docs from the standard repository maps.

## Task 3: Add Governance For Future Chinese Updates

- [x] **Step 1: Update `docs/PLANS.md`**

Extend documentation governance so any future developer-facing architecture, runtime, quality, security, reliability, or plan change must either:

- update the relevant `docs/zh-CN/` page; or
- explicitly record that no Chinese-doc update is needed.

- [x] **Step 2: Keep plan governance valid**

This active plan already includes `## Documentation Impact Matrix` and `## Documentation Update Gate`, so `npm run docs:check` should pass after edits.

## Task 4: Verify

- [x] **Step 1: Run documentation governance**

Run:

```bash
npm run docs:check
```

Expected: `Documentation governance check passed.`

- [x] **Step 2: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

## Documentation Impact Matrix

| Category | Decision | Files |
| --- | --- | --- |
| Repository maps | Update | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` |
| Planning | Update | `docs/PLANS.md`, this plan |
| Product | Review | `docs/product-specs/index.md`; no change because this is developer-doc routing, not product scope |
| Architecture | Update | `docs/zh-CN/architecture.md`; review `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md`, `docs/design-docs/api-contract.md` |
| Quality and operations | Update | `docs/zh-CN/quality-and-plans.md`, `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/security-reliability.md` |
| Security and governance | Update | `docs/zh-CN/security-reliability.md` |
| Frontend and design | Update | `docs/zh-CN/frontend.md`; design docs remain linked as English deep references |
| Generated artifacts | No change | `docs/generated/*` generated artifacts remain in their current language/format |
| References | No change | `docs/references/*` external reference notes remain unchanged |

## Documentation Update Gate

- `docs/zh-CN/README.md` must link every Chinese guide added by this plan.
- Existing repository maps must link the Chinese developer-doc entry point.
- `docs/PLANS.md` must describe how future developer-facing changes handle Chinese docs.
- This plan may move to `docs/exec-plans/completed/` only after `npm run docs:check` and `git diff --check` pass.

## Expected Outcome

After this plan, WiseEff supports Chinese-language developer onboarding and daily development reference for the key developer-facing areas: architecture, frontend, backend/runtime, security/reliability, quality gates, and plan governance. The project also has a durable rule for keeping the Chinese layer in sync when future developer-facing docs change.

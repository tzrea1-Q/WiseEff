# Agent tools: one declaration per tool, everything else derived

> Status: **Completed 2026-08-13** (single-PR change; plan recorded at completion)
> Date: 2026-08-13
> Branch: `refactor/agent-tool-single-definition`
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-13-agent-tool-single-definition.md`](../../zh-CN/exec-plans/completed/2026-08-13-agent-tool-single-definition.md)
> Source: 2026-08-12 architecture review, candidate 4

## Goal

One agent tool used to cross 8–10 representations: a hand-written `AgentToolName` union, the registry definition with `run`, a dead second `AgentToolDefinition` in `types.ts`, three name-keyed side tables in `toolCatalog.ts` (Chinese labels, model descriptions, schemas — a missing row degraded silently via fallbacks), the planning descriptor, the OpenAI definition and system-prompt bullet, and a separate English `label` per tool. Adding one read-only tool meant editing at least six files.

Now `server/modules/agent/toolMetadata.ts` is the single declaration point: `{ name, label(zh), kind, permission, requiresApproval, scope?, description, schema }` per tool. Everything else derives mechanically.

## What changed

- **`toolMetadata.ts` (new)**: the `AGENT_TOOL_METADATA` table, the derived `AgentToolName` union (`types.ts` re-exports it; the hand-written union is gone), `requireAgentToolMetadata` (literal-narrowing), and `getXiaozeToolLabel`.
- **`tools/*`**: each tool spreads its metadata and adds only `run` — the per-tool `label/kind/permission/requiresApproval/scope` literals are gone. Tool `label`s are now the user-facing Chinese labels everywhere (run steps, tool-result frames, audits, approvals, admin DTOs) instead of an unused English variant.
- **`toolCatalog.ts`**: the three name-keyed side tables are deleted; `buildXiaozePlanningToolDescriptors` is a mechanical projection of the metadata carried by each registered tool (no fallback path left to degrade silently). `formatToolCatalogForSystemPrompt` / `toOpenAiToolDefinitions` are unchanged consumers.
- **`types.ts`**: the dead second `AgentToolDefinition` deleted; `AgentToolKind` re-exported from the metadata module.

Out of scope (belongs to review candidate 5, the shared wire contract): the frontend fallback label table (`xiaozeToolLabels.ts`) and shipping labels inside AG-UI frames.

## Verification

- `npx tsc -b --force` green; `server/modules/agent` suite green (32 files / 179 tests); `npm run build` and `npm run docs:check` green.
- Descriptions/schemas were moved verbatim, so the model-facing catalog, OpenAI definitions, and system prompt are byte-identical for existing tools.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan + zh; `docs/PLANS.md` + zh |
| Others | No change | Wire protocol unchanged; permissions unchanged; no product behavior change beyond tool labels now being consistently Chinese in stored tool-call rows |

## Documentation Update Gate

- [x] `docs/PLANS.md` EN + zh list this plan
- [x] `npm run docs:check` green

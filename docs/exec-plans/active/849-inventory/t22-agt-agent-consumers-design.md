# T2.2-AGT agent consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-agt-agent-consumers-design.md)

Companion to the [threat matrix](t22-agt-agent-consumers-threat-matrix.md). Agent catalog reads stay in principal scope. Parameter mutation is approved binding draft, not legacy PPV/definition write.

Status: **Spec PASS with P2 folded.** Independent review `01a0afc7-92e3-7393-af5a-442594f0cc6c`. Implementation may start.

## 1. What T2.2-AGT is

Classify S12-AGT (30). Repair: `action.submitParameterChange` still has `submitLegacyParameterChange` for identity-mode `legacy`, so a stale checkpoint/editedArgs `parameterId` can still take `getProjectParameterForUpdate` + flat submit. Fail closed. Do not steal LOG/xiaoze internals.

| Seam | Owner today | T2.2-AGT |
| --- | --- | --- |
| Perception search/overview | `readProjectProtectedParameters` binding pin | Keep |
| `action.submitParameterChange` semantic | binding + `createBindingDraft` + submit draft identity | Keep |
| `action.submitParameterChange` legacy | `submitLegacyParameterChange` | **Delete**; non-semantic mode refuses (no PPV write) |
| Submit `parameterSpecId` | from draft | Keep (T2.2-PRJ still requires it) |
| Approval / trusted invocation | durable session + tool-call + approval | Keep |
| Catalog structural tools | none in `toolMetadata.ts` | Keep none |
| Knowledge draft tool | `action.createKnowledgeDraft` | Keep; not a spec mint |
| Xiaoze checkpointer / orchestrator | out of S12-AGT paths | Record; tool-layer gate is AGT-owned |
| Comparison contribution | adapter | Keep |
| Mock / jobs / scripts | none in shard paths | Record none |
| E2E `xiaoze-action.acceptance.spec.ts` | already binding id | Keep; default no new Playwright |

## 2. Classification method

Group `s12-agt.json` by `file` × `rule`. Labels: canonical-current-agent-read, canonical-current-agent-draft, exact-canonical-history, archived-notice (vanished legacy-submit tokens).

## 3. Repairs after Spec PASS

**A. Remove legacy Agent parameter write (`actionTools.ts`)**

Delete `submitLegacyParameterChange`. `action.submitParameterChange` always:

1. `requireDurableAgentInvocation` (unchanged).
2. If identity mode is not `"semantic"`, throw `CONFLICT` (`reason: "legacy-identity-mode-retired-for-agent"` or equivalent). Do **not** call `getProjectParameterForUpdate` or submit `{ parameterId, targetValue }` flat items.
3. Else existing binding path: `loadBindingContext` → project match → head revision → sensitive guard → `createBindingDraft` → submit with `draftId` / `projectParameterBindingId` / `parameterSpecId` from the draft.

Unknown/non-binding `parameterId` stays NOT_FOUND via `loadBindingContext`. Do not invent a spec id. Do not wrap `db.query`. Do not intercept TOP `writeLock` SQL.

**B. Tests (`actionTools.test.ts` only)**

Retarget/delete “submits the legacy flat shape on legacy-identity databases (TD-079)”. New: identity mode `legacy` → CONFLICT, `getProjectParameterForUpdate` not called, `submitParameterChanges` not called. Keep durable-invocation, binding submit, DTS parse, cross-project 404, missing-revision 409, draft cleanup. Do not treat the 14 integration sql-write rows as a zero-30 mandate. Do not edit `xiaoze/**` unused `getProjectParameterForUpdate` mocks. E2E `xiaoze-action.acceptance.spec.ts` already uses binding id; keep.

**C. Out of family**

Do not edit `xiaoze/**`, `orchestrator.ts`, T2.1 `semanticBindingFixture.ts`, T2.2-TOP `writeLock.ts`/`createBindingDraft` structural 409. Do not start T2.2-LOG. Do not 410 Agent tools.

## 4. Ratchet

1. Implement A–B.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **AGT** shard entries (legacy-submit tokens). No growth, no checker weakening.
4. Receipt: AGT before **30**, total before **3513**, after counts, delta.

`submitLegacyParameterChange` still present after repair is a Spec fail even if delta ≠ 0. Honest zero is allowed only when the function is gone and the checker is blocked (T2.2-TOP `editService.ts` blob).

## 5. Evidence

- `test:server -- actionTools.test.ts` (and `actionTools.integration.test.ts` / `toolRegistry.test.ts` if touched).
- `git diff --check`. `tsc -b` if types change.
- Browser: default **no UI sweep**. Do not treat PARAM-INIT or Xiaoze Playwright as this todo's gate.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Delete legacy submit + refuse non-semantic mode + tests.
2. Checker / AGT shard ratchet if possible.
3. Receipt; review; stop. No T2.2-LOG. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Remove legacy Agent write | `actionTools.ts`, tests | Spec PASS |
| B | Shard ratchet | `s12-agt.json` if tokens gone | A |
| C | Receipt | T2.2-AGT docs | B |

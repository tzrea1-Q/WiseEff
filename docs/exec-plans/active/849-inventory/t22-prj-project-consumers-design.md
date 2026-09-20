# T2.2-PRJ project consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-prj-project-consumers-design.md)

Companion to the [threat matrix](t22-prj-project-consumers-threat-matrix.md). `/parameters` tray already hydrates via T2.1 `createCanonicalDraftTraySource` (v2). Runtime `refresh` still lists v1 `/parameter-drafts/mine`. Initialization HTTP already encodes project states. PARAM-INIT Playwright stays T3.2.

Status: **independent Spec review PASS with P2.** P2s folded here. Production edits follow this freeze.

## 1. What T2.2-PRJ is

Classify S12-PRJ. Repair the workbench **live draft owner** so refresh/discard use canonical v2 project-value-drafts when `projectId` is known. Keep initialization states. Do not 410 v1 draft GET/DELETE. Do not steal FIL. Do not claim PARAM-INIT e2e.

| Seam | Owner today | T2.2-PRJ |
| --- | --- | --- |
| Workbench parameter rows | `semanticParameterReads` `b.id` | Keep (canonical binding id) |
| Tray on `/parameters` | T2.1 canonical tray v2 | Reuse |
| `parameterRuntime.refresh` drafts | `listDrafts()` → v1 `/mine` | **Per-project v2 list** |
| `parameterClient.listDrafts(projectId)` | v1 `/mine?projectId=` | **GET v2 `.../parameter-value-drafts`** |
| `deleteDraft` with projectId | v1 DELETE | **v2 DELETE** when projectId present |
| `saveDraft` semantic | 409 CONFLICT | Keep |
| v1 GET/DELETE drafts HTTP | still 2xx | Keep (T2.1 helper) |
| Initialization HTTP | live | Keep 2xx |
| PARAM-INIT-* Playwright | `coverage: "future"` | Stay future (T3.2) |
| Submit `parameterSpecId` | required on binding items | Keep (T2.1); not row identity |
| Mock parameter repository | in-memory drafts | Keep; no spec mint |
| Jobs/scripts | none in `s12-prj.json` paths | Classify as none; `fileSync*` stays history, not T2.2-FIL |

## 2. Classification method

Group `s12-prj.json` by `file` × `rule` in the receipt. Four labels: canonical-current-workbench, canonical-current-initialization, canonical-current-dts-spec, exact-canonical-history. Archived-notice only if a token vanishes because the client left v1 mine (expect small/zero delta; v1 strings remain in routes.ts).

## 3. Repairs after Spec PASS

**A. Client list/delete (parameterClient.ts)**

- `listDrafts(projectId)` when `projectId` is a non-empty string: `GET /api/v2/projects/:projectId/parameter-value-drafts`. Parse **`projectValueDraftListResponseSchema` / `catalogBindingDraftDtoSchema`**, not `workbenchDraftListSchema`. Map: `projectId` from the path, `parameterId` ← `bindingId`, `projectParameterBindingId` ← `bindingId`, pins from `effectiveRevisionId` / `currentValueId`. Needed so `discardDrafts` matches `semanticParameterReads` `b.id`. Do not invent `parameterSpecId` as the row id.
- `listDrafts()` without projectId: keep current v1 `/mine` (refresh will stop using this).
- Port: `ParameterRepository.deleteDraft(draftId, projectId?)`. If `projectId` present, `DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId`; else v1 DELETE. Mock accepts the optional second argument. Update `parameterRuntime.test.ts` (`deleteDraft` called with draft id **and** projectId).
- Do not parse a spec-definition body. Reuse catalog list/delete URLs already owned by T2.1; do not edit `catalogProjectValueRoutes.ts` unless a mapper bug blocks mapping.

**B. Runtime refresh (parameterRuntime.ts)**

After `listProjects()`, hydrate drafts with `Promise.all(projects.map((p) => api.listDrafts(p.id))).then((groups) => groups.flat())`. Do not call `listDrafts()` with no projectId on the refresh path. `discardDrafts` already has `projectId` — pass it into `deleteDraft`.

**C. Tests**

- `parameterClient.test.ts`: `listDrafts("aurora")` expects v2 path, not `/api/v1/parameter-drafts/mine?projectId=aurora`.
- `parameterRuntime.test.ts`: refresh calls `listDrafts` per project id.
- Keep v1 DELETE test for the no-projectId fallback.

**D. Out of family**

Do not edit T2.1 `semanticBindingFixture.ts`. Do not 410 v1 draft routes. Do not rewrite initializationService spec fields. Do not change PARAM-INIT coverage map. Do not start T2.2-FIL.

## 4. Ratchet

1. Implement A–C.
2. `parameter-catalog-boundaries:check -- --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If relocation blobs from T2.1/T2.2-TOP still block, record the exact error; do not rewrite those fixtures.
3. Delete only vanished **PRJ** shard entries. No growth, no checker weakening.
4. Receipt: PRJ before **422**, total before **3513**, after counts, delta. Honest zero delta allowed.

## 5. Evidence

- Focused `npm test -- parameterClient.test.ts parameterRuntime.test.ts` (and mock if touched).
- `npx tsc -b` if ports/clients change.
- `git diff --check`.
- Browser: only if the workbench draft table (not only the T2.1 tray) visibly changes. Then 1440x900 once. Default **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Client v2 list/delete + tests.
2. Runtime refresh per-project + tests.
3. Checker / shard if possible.
4. Receipt; review; stop. No T2.2-FIL. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Client v2 drafts | `parameterClient.ts`, `parameterClient.test.ts` | Spec PASS |
| B | Refresh per project | `parameterRuntime.ts`, `parameterRuntime.test.ts` | A |
| C | Shard ratchet | `s12-prj.json` only if tokens gone | A–B |
| D | Receipt | T2.2-PRJ docs | C |

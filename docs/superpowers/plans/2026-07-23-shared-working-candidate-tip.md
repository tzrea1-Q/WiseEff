# Shared Working Candidate Tip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all unsubmitted typed binding drafts for a user×project share one working candidate tip so multi-parameter「本轮」edits can batch-submit without the tray multi-candidate blocker or `candidate revision` jargon.

**Architecture:** Server is the source of truth. `createBindingDraft` resolves the round’s working tip from open drafts, rejects bases that are not that tip, stacks a new tip, then rebases sibling open drafts’ `candidate_config_revision_id` onto it. Submit asserts one shared tip. Frontend aligns tray state from the create response and replaces user-facing blocker copy.

**Tech Stack:** TypeScript, Postgres via existing `Queryable`, Vitest (`editService.test.ts`, service/frontend tests), Vite React workbench (`ApiProjectTopologyWorkspace`, `DtsBindingDraftTray`).

**Spec:** [`docs/superpowers/specs/2026-07-23-shared-working-candidate-tip-design.md`](../specs/2026-07-23-shared-working-candidate-tip-design.md)  
**Chinese summary:** [`docs/zh-CN/superpowers/plans/2026-07-23-shared-working-candidate-tip.md`](../../zh-CN/superpowers/plans/2026-07-23-shared-working-candidate-tip.md)

## Global Constraints

- Round scope = unsubmitted typed binding drafts for `(organizationId, projectId, userId)` only (not cross-user).
- When a working tip exists, `baseRevisionId` must equal that tip.
- Never show `candidate revision` in user-facing tray blockers; use「本轮 / 工作版本」.
- Do not change review roles, merge/writeback, or submit wire item shape (`draftId`, binding, spec, action, value, reason, assignees).
- Additive DTO fields only: `workingCandidateRevisionId`, `rebasedDraftIds`.
- Feature branch from latest `main`: `feat/shared-working-candidate-tip`.
- Implementation agents commit on the feature branch only; parent opens/merges the PR.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Checkout `feat/shared-working-candidate-tip` from `main`, implement, test, commit on branch |
| Implementation agent | Must not push to `main`, open/merge GitHub PRs, or fast-forward local `main` |
| Parent agent | Review, create PR, merge, `git pull origin main` |

## File map

| File | Responsibility |
| --- | --- |
| `server/modules/parameters/repository.ts` | List open binding drafts for user×project; rebase sibling candidate pointers |
| `server/modules/parameter-topology/editService.ts` | Tip resolve, base gate, post-create rebase, response fields |
| `server/modules/parameter-topology/service.ts` | Pass through new response fields |
| `server/modules/parameter-topology/editService.test.ts` | Multi-binding tip sharing + stale-base 409 |
| `server/modules/parameters/service.ts` | Submit-time shared-tip assertion |
| `server/modules/parameters/service.test.ts` | Mixed tip rejected; shared tip accepted |
| `src/application/ports/ParameterTopologyRepository.ts` | Extend `BindingDraftResult` |
| `src/infrastructure/http/parameterTopologyClient.ts` | Map new fields |
| `src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx` | Align tray after rebase |
| `src/components/parameter-topology/DtsBindingDraftTray.tsx` | Copy + demote multi-tip blocker |
| Matching `*.test.tsx` / client tests | Frontend behavior |
| `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document shared working tip behavior |

---

### Task 1: Repository helpers for open drafts + rebase

**Files:**
- Modify: `server/modules/parameters/repository.ts`
- Test: `server/modules/parameter-topology/editService.test.ts` (exercised in Task 2; add a focused repository test only if helpers are non-trivial to reach via editService)

**Interfaces:**
- Produces:
  - `listOpenBindingDraftsForUser(db, { organizationId, projectId, userId }) => Promise<Array<{ id: string; candidateConfigRevisionId: string | null; projectParameterBindingId: string | null; updatedAt: string }>>`
  - `rebaseOpenBindingDraftCandidates(db, { organizationId, projectId, userId; candidateConfigRevisionId; excludeDraftId?: string }) => Promise<string[]>` — returns rebased draft ids

- [ ] **Step 1: Write the failing test (via editService multi-binding — stub first if needed)**

Add to `server/modules/parameter-topology/editService.test.ts` inside `describe("createBindingDraft")` (same fixture helpers as existing tests):

```ts
it("shares one working tip across two different binding drafts", async () => {
  const fixture = await seedConfigAndTwoBindings(db!, auth); // or seed second binding via existing helpers
  const first = await createBindingDraft(db!, auth, {
    bindingId: fixture.bindingA.id,
    baseRevisionId: fixture.revision.id,
    targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "3000", value: "3000" }]] },
    reason: "Edit A",
  }, { toolchain: passToolchain });

  const second = await createBindingDraft(db!, auth, {
    bindingId: fixture.bindingB.id,
    baseRevisionId: first.candidateRevisionId,
    targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "1", value: "1" }]] },
    reason: "Edit B",
  }, { toolchain: passToolchain });

  expect(second.candidateRevisionId).toBe(second.workingCandidateRevisionId);
  expect(second.rebasedDraftIds).toEqual(expect.arrayContaining([first.draftId]));
  expect(second.candidateRevisionId).not.toBe(first.candidateRevisionId);

  const stored = await db!.query<{ id: string; candidate_config_revision_id: string | null }>(
    `select id, candidate_config_revision_id from parameter_drafts
     where organization_id = $1 and project_id = $2 and user_id = $3
     order by id`,
    [ORG_ID, PROJECT_ID, USER_ID],
  );
  expect(stored.rows).toHaveLength(2);
  expect(new Set(stored.rows.map((r) => r.candidate_config_revision_id)).size).toBe(1);
  expect(stored.rows[0]!.candidate_config_revision_id).toBe(second.candidateRevisionId);
});
```

If `seedConfigAndTwoBindings` does not exist, extend the existing seed helper in the same test file to insert a second binding on the same config revision (mirror `seedConfigAndBinding`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.server.config.ts server/modules/parameter-topology/editService.test.ts -t "shares one working tip"`

Expected: FAIL (missing `workingCandidateRevisionId` / siblings still on old tip).

- [ ] **Step 3: Implement repository helpers**

In `server/modules/parameters/repository.ts`:

```ts
export async function listOpenBindingDraftsForUser(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string },
): Promise<
  Array<{
    id: string;
    candidateConfigRevisionId: string | null;
    projectParameterBindingId: string | null;
    updatedAt: string;
  }>
> {
  const result = await db.query<{
    id: string;
    candidate_config_revision_id: string | null;
    project_parameter_binding_id: string | null;
    updated_at: Date | string;
  }>(
    `
    select id, candidate_config_revision_id, project_parameter_binding_id, updated_at
    from parameter_drafts
    where organization_id = $1
      and project_id = $2
      and user_id = $3
      and project_parameter_binding_id is not null
    order by updated_at desc, id asc
    `,
    [input.organizationId, input.projectId, input.userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    candidateConfigRevisionId: row.candidate_config_revision_id,
    projectParameterBindingId: row.project_parameter_binding_id,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(),
  }));
}

export async function rebaseOpenBindingDraftCandidates(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    candidateConfigRevisionId: string;
    excludeDraftId?: string;
  },
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `
    update parameter_drafts
    set candidate_config_revision_id = $4,
        updated_at = now()
    where organization_id = $1
      and project_id = $2
      and user_id = $3
      and project_parameter_binding_id is not null
      and candidate_config_revision_id is distinct from $4
      and ($5::text is null or id <> $5)
    returning id
    `,
    [
      input.organizationId,
      input.projectId,
      input.userId,
      input.candidateConfigRevisionId,
      input.excludeDraftId ?? null,
    ],
  );
  return result.rows.map((row) => row.id);
}
```

Export these from the same module `editService` already imports (`upsertDraft` from `../parameters/repository`).

- [ ] **Step 4: Commit**

```bash
git add server/modules/parameters/repository.ts server/modules/parameter-topology/editService.test.ts
git commit -m "$(cat <<'EOF'
feat(parameters): add open-draft list and candidate rebase helpers

Support sharing one working tip across a user×project draft round.
EOF
)"
```

---

### Task 2: `createBindingDraft` tip gate + sibling rebase + response fields

**Files:**
- Modify: `server/modules/parameter-topology/editService.ts`
- Modify: `server/modules/parameter-topology/service.ts` (pass-through)
- Modify: `server/modules/parameter-topology/editService.test.ts`
- Modify: routes/DTO types if `BindingDraftResult` is declared server-side separately

**Interfaces:**
- Consumes: `listOpenBindingDraftsForUser`, `rebaseOpenBindingDraftCandidates`
- Produces: `BindingDraftResult` / service result includes:
  - `workingCandidateRevisionId: string` (= `candidateRevisionId`)
  - `rebasedDraftIds: string[]`

- [ ] **Step 1: Add stale-working-tip failing test**

```ts
it("rejects create when baseRevisionId is not the current working tip", async () => {
  const fixture = await seedConfigAndTwoBindings(db!, auth);
  const first = await createBindingDraft(db!, auth, {
    bindingId: fixture.bindingA.id,
    baseRevisionId: fixture.revision.id,
    targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "3000", value: "3000" }]] },
    reason: "Edit A",
  }, { toolchain: passToolchain });

  await expect(
    createBindingDraft(db!, auth, {
      bindingId: fixture.bindingB.id,
      baseRevisionId: fixture.revision.id, // stale published tip, not working tip
      targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "1", value: "1" }]] },
      reason: "Edit B off tip",
    }, { toolchain: passToolchain }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    details: expect.objectContaining({ reason: "stale-working-tip" }),
  });

  void first;
});
```

- [ ] **Step 2: Run tests — expect FAIL on tip sharing + stale gate**

Run: `npx vitest run --config vitest.server.config.ts server/modules/parameter-topology/editService.test.ts -t "working tip|stale-working-tip|shares one working tip"`

- [ ] **Step 3: Implement tip resolve + gate + rebase in `createBindingDraft`**

Near the top of `createBindingDraft` (after binding/revision loads, before overlay mutate), add:

```ts
const openDrafts = await listOpenBindingDraftsForUser(db, {
  organizationId: auth.organization.id,
  projectId: binding.project_id,
  userId: auth.user.id,
});
const tipCandidates = openDrafts
  .map((d) => d.candidateConfigRevisionId?.trim())
  .filter((id): id is string => Boolean(id));
const workingTip = tipCandidates.length > 0
  ? openDrafts.find((d) => d.candidateConfigRevisionId?.trim())!.candidateConfigRevisionId!.trim()
  : null;
// openDrafts is ordered updated_at desc → first non-null candidate is working tip
const resolvedWorkingTip =
  openDrafts.map((d) => d.candidateConfigRevisionId?.trim()).find((id) => id) ?? null;

if (resolvedWorkingTip && input.baseRevisionId !== resolvedWorkingTip) {
  throw new ApiError(
    "CONFLICT",
    "请刷新后基于本轮最新工作版本继续编辑。",
    409,
    {
      reason: "stale-working-tip",
      bindingId: input.bindingId,
      baseRevisionId: input.baseRevisionId,
      workingCandidateRevisionId: resolvedWorkingTip,
    },
  );
}
```

Use only `resolvedWorkingTip` (delete the unused `workingTip`/`tipCandidates` draft lines above when implementing).

After successful `upsertDraft` (and before return), rebase siblings:

```ts
const rebasedDraftIds = await rebaseOpenBindingDraftCandidates(db, {
  organizationId: auth.organization.id,
  projectId: binding.project_id,
  userId: auth.user.id,
  candidateConfigRevisionId: candidateRevisionId,
  excludeDraftId: draftId,
});
```

Extend return value:

```ts
return {
  draftId,
  parameterId: draftParameterId,
  writeTarget,
  candidateRevisionId,
  workingCandidateRevisionId: candidateRevisionId,
  rebasedDraftIds,
  rawText,
  action,
  parameterSpecId: binding.parameter_spec_id,
  projectParameterBindingId: binding.binding_id,
  // ...existing debug fields unchanged...
};
```

Update `CreateBindingDraftServiceResult` / `service.ts` `createBindingDraft` return to include the two new fields.

Keep existing same-binding replacement test green (still one row; `rebasedDraftIds` may be empty).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run --config vitest.server.config.ts server/modules/parameter-topology/editService.test.ts -t "createBindingDraft"`

Expected: PASS for new cases + existing createBindingDraft cases.

- [ ] **Step 5: Commit**

```bash
git add server/modules/parameter-topology/editService.ts server/modules/parameter-topology/service.ts server/modules/parameter-topology/editService.test.ts
git commit -m "$(cat <<'EOF'
feat(parameters): share working tip across binding draft round

Gate creates on the round tip and rebase sibling drafts onto each new tip.
EOF
)"
```

---

### Task 3: Submit asserts one shared tip

**Files:**
- Modify: `server/modules/parameters/service.ts` (`submitParameterChanges`)
- Modify: `server/modules/parameters/service.test.ts`

**Interfaces:**
- Consumes: loaded exact drafts’ `candidateConfigRevisionId`
- Produces: `409 CONFLICT` when a submit batch has more than one distinct tip

- [ ] **Step 1: Write failing test**

In `service.test.ts` near existing `submitParameterChanges` tests, add a case that builds two exact drafts with different `candidateConfigRevisionId` values (reuse existing draft fixtures / direct DB insert patterns already in that file) and expects reject:

```ts
it("submitParameterChanges rejects mixed working tips in one batch", async () => {
  await expect(
    submitParameterChanges(db, makeAuth(), {
      projectId: PROJECT_ID,
      items: [
        { draftId: draftA, projectParameterBindingId: bindingA, parameterSpecId: specId, action: "set", targetValue: "<1>", reason: "a" },
        { draftId: draftB, projectParameterBindingId: bindingB, parameterSpecId: specId, action: "set", targetValue: "<2>", reason: "b" },
      ],
      assignees: completeAssignees,
    }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: expect.stringMatching(/同一工作版本|工作版本/),
  });
});
```

Use real fixture IDs from the file’s helpers — do not leave placeholders; copy the local `makeAuth` / seed patterns already used by neighboring tests.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run --config vitest.server.config.ts server/modules/parameters/service.test.ts -t "mixed working tips"`

- [ ] **Step 3: Implement assertion**

After the loop that loads `parameters` / `exactDraft` entries and before creating the submission round:

```ts
const tipIds = [
  ...new Set(
    parameters
      .map(({ exactDraft }) => exactDraft?.candidateConfigRevisionId?.trim())
      .filter((id): id is string => Boolean(id)),
  ),
];
if (parameters.some(({ exactDraft }) => "draftId" in /* item */ true) && tipIds.length > 1) {
  throw new ApiError(
    "CONFLICT",
    "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。",
    409,
    { reason: "mixed-working-tips", candidateConfigRevisionIds: tipIds },
  );
}
```

Implement against the actual `parameters` array shape in that function (check `"draftId" in item` via each entry’s `item`).

- [ ] **Step 4: Run — expect PASS** (also keep an existing happy-path submit test green)

Run: `npx vitest run --config vitest.server.config.ts server/modules/parameters/service.test.ts -t "submitParameterChanges"`

- [ ] **Step 5: Commit**

```bash
git add server/modules/parameters/service.ts server/modules/parameters/service.test.ts
git commit -m "$(cat <<'EOF'
fix(parameters): reject submit batches with mixed working tips

Keep review rounds on a single shared candidate tip.
EOF
)"
```

---

### Task 4: Frontend ports, client, tray, workspace

**Files:**
- Modify: `src/application/ports/ParameterTopologyRepository.ts`
- Modify: `src/infrastructure/http/parameterTopologyClient.ts`
- Modify: `src/infrastructure/http/parameterTopologyClient.test.ts`
- Modify: `src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx`
- Modify: `src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx`
- Modify: `src/components/parameter-topology/DtsBindingDraftTray.tsx`
- Modify: `src/components/parameter-topology/DtsBindingDraftTray.test.tsx`

**Interfaces:**
- Consumes: create response `workingCandidateRevisionId`, `rebasedDraftIds`
- Produces: tray drafts all showing tip; no `candidate revision` user copy

- [ ] **Step 1: Extend port + client mapping (failing client test first)**

```ts
// ParameterTopologyRepository.ts — BindingDraftResult
export type BindingDraftResult = {
  draftId: string;
  parameterId: string;
  candidateRevisionId: string;
  workingCandidateRevisionId?: string;
  rebasedDraftIds?: string[];
  rawText: string;
  action: "set" | "delete";
  parameterSpecId: string;
  projectParameterBindingId: string;
  writeTarget: { role: string; propertyKey: string; targetRef?: string | null };
  overlayFileId: string;
  overlayFileName: string;
};
```

Update `bindingDraftFromDto` to pass through optional fields.

Add/adjust client test expectation for the new fields.

- [ ] **Step 2: Workspace — align tray after create**

In `ApiProjectTopologyWorkspace` where `setPendingDrafts` runs after `createBindingDraft`, set every matching rebased draft’s `candidateRevisionId` to the new tip:

```ts
setPendingDrafts((current) => {
  // ...existing nextDraft construction...
  const tip = draft.workingCandidateRevisionId ?? draft.candidateRevisionId;
  const rebased = new Set(draft.rebasedDraftIds ?? []);
  const withoutBinding = current.filter(
    (item) =>
      item.projectId === requestProjectId &&
      item.projectParameterBindingId !== draft.projectParameterBindingId,
  );
  const aligned = withoutBinding.map((item) =>
    item.projectId === requestProjectId && (rebased.has(item.draftId) || rebased.size === 0)
      ? { ...item, candidateRevisionId: tip }
      : item,
  );
  // Prefer: always align all same-project drafts to tip when server returns tip
  const forced = (rebased.size > 0 ? aligned : withoutBinding).map((item) =>
    item.projectId === requestProjectId ? { ...item, candidateRevisionId: tip } : item,
  );
  return [...forced.filter((i) => i.projectId === requestProjectId), nextDraft /* with tip */];
});
```

Simplify when implementing: after building `nextDraft` with `candidateRevisionId: tip`, map **all** same-project pending drafts to `tip`, then replace/add `nextDraft`. That matches server rebase of the whole round.

Add workspace test: two sequential `createBindingDraft` mocks returning different candidates + `rebasedDraftIds` → tray drafts share final tip (or assert submit path not blocked). Prefer asserting pending draft state if exposed via tray text `同一工作版本`.

- [ ] **Step 3: Tray copy + blocker**

In `DtsBindingDraftTray.tsx`:

1. Replace `candidateBlocker` message with:

```ts
? "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。"
```

2. Update header count line to include healthy hint when `candidateBlocker` is null, e.g. subtitle or span: `本轮 ${drafts.length} 项 · 同一工作版本`.

3. Update `identityBlocker` to avoid the word `candidate` in user text (`草稿缺少完整的项目、工作版本、binding 或规格身份，已阻止提交。`).

Update `DtsBindingDraftTray.test.tsx` expectations for the new strings.

- [ ] **Step 4: Run frontend unit tests**

Run:

```bash
npx vitest run src/components/parameter-topology/DtsBindingDraftTray.test.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx src/infrastructure/http/parameterTopologyClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/ports/ParameterTopologyRepository.ts \
  src/infrastructure/http/parameterTopologyClient.ts \
  src/infrastructure/http/parameterTopologyClient.test.ts \
  src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx \
  src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx \
  src/components/parameter-topology/DtsBindingDraftTray.tsx \
  src/components/parameter-topology/DtsBindingDraftTray.test.tsx
git commit -m "$(cat <<'EOF'
feat(parameters): align draft tray to shared working tip

Surface rebase results and replace candidate jargon in blockers.
EOF
)"
```

---

### Task 5: Docs + docs:check

**Files:**
- Modify: `docs/FRONTEND.md`
- Modify: `docs/zh-CN/frontend.md`
- Review: `docs/design-docs/api-contract.md` / zh-CN only if create-draft response is documented there (Update if listed; else No change)

- [ ] **Step 1: Update FRONTEND paragraphs**

In the API-mode workbench / typed draft section, state explicitly:

- A user×project open draft round shares one working tip.
- Each subsequent typed edit must use that tip as `baseRevisionId`; the server rebases sibling drafts onto the new tip.
- Tray healthy copy:「本轮 N 项 · 同一工作版本」; mixed tips are exceptional and actionable in Chinese.

Mirror the same meaning in `docs/zh-CN/frontend.md` (Chinese prose only).

- [ ] **Step 2: Run docs check**

Run: `npm run docs:check`

Expected: PASS (or fix any link/bilingual inventory issues introduced).

- [ ] **Step 3: Commit**

```bash
git add docs/FRONTEND.md docs/zh-CN/frontend.md
git commit -m "$(cat <<'EOF'
docs: document shared working tip for typed draft rounds

EOF
)"
```

---

### Task 6: Verification gate

**Files:** none required beyond fixes if verification fails

- [ ] **Step 1: Server tests**

```bash
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-topology/editService.test.ts \
  server/modules/parameters/service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Frontend tests + build**

```bash
npx vitest run \
  src/components/parameter-topology/DtsBindingDraftTray.test.tsx \
  src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx \
  src/infrastructure/http/parameterTopologyClient.test.ts
npm run build
```

Expected: PASS / build OK.

- [ ] **Step 3: Manual / browser smoke (parent or implementer with API up)**

1. Login, open `/parameters` for a project with ≥2 editable bindings.
2. Edit binding A → 加入本轮; edit binding B → 加入本轮.
3. Tray shows「同一工作版本」;「提交审核」enabled (roles present).
4. No `candidate revision` string in the error area.

If `playwright-cli` is used for this frontend-visible copy change, capture desktop snapshot evidence under `work/ui-checks/`.

- [ ] **Step 4: Final commit only if Step 3 forced fixes; otherwise stop**

Parent agent opens PR from `feat/shared-working-candidate-tip` when verification is green.

---

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps (`AGENTS.md`, `ARCHITECTURE.md`) | No change | — |
| Planning (`docs/PLANS.md`, exec-plans) | Review | Optionally link this plan from an active exec-plan only if product roadmap tracking requires it; default No change |
| Product specs | No change | Behavior is workbench draft UX, not MVP scope change |
| Design / API | Review | `docs/design-docs/api-contract.md` + zh-CN — Update only if BindingDraft response fields are enumerated; else record unchanged |
| Quality / testing | No change | Existing test strategy covers editService/submit |
| Reliability / runbooks | No change | — |
| Security / governance | No change | — |
| Frontend docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Generated OpenAPI | Review | Regenerate/update if repo workflow requires schema sync for additive response fields; otherwise document as additive JSON fields tolerated by clients |
| References | No change | — |
| Superpowers spec | No change | Already committed |

## Documentation Update Gate

Before marking complete / opening PR as ready:

- [ ] Every `Update` row applied
- [ ] Every `Review` row updated or explicitly unchanged with evidence in the PR body
- [ ] `npm run docs:check` PASS
- [ ] No deferred doc work left undocumented in `docs/exec-plans/tech-debt-tracker.md`

---

## Spec coverage self-check

| Spec requirement | Task |
| --- | --- |
| User×project open drafts share tip | Task 1–2 |
| base must equal working tip | Task 2 |
| Sibling rebase after create | Task 1–2 |
| Submit shared-tip assert | Task 3 |
| Tray copy / no jargon | Task 4 |
| Acceptance criteria 1–6 | Task 2–4, 6 |
| FRONTEND docs | Task 5 |
| Non-goals untouched | Global Constraints |

## Placeholder scan

No TBD/TODO placeholders. Fixture helper names in Task 1–3 must be adapted to existing test seeds in-file (`seedConfigAndBinding` extensions), not left unimplemented.

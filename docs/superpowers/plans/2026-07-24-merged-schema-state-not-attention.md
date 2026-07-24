# Merged Schema State Must Not Show Attention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop false workbench「待处理」badges caused by merge writeback storing `schema_state=merged`, which API normalization maps to `unreviewed`.

**Architecture:** Dual fix on the server only. (1) Read path: `normalizeBindingSchemaState("merged")` → `valid`. (2) Write path: locked merge writeback persists `schemaState: "valid"` and `policyState: "not_applicable"` instead of `"merged"`. Workbench governance logic stays unchanged.

**Tech Stack:** TypeScript, Vitest (`npm run test:server` / targeted `tsx` vitest), PostgreSQL-backed topology modules under `server/modules/parameter-topology/`.

**Spec:** [`docs/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md`](../specs/2026-07-24-merged-schema-state-not-attention-design.md)  
**Chinese:** [`docs/zh-CN/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md`](../../zh-CN/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md)  
**Chinese plan summary:** [`docs/zh-CN/superpowers/plans/2026-07-24-merged-schema-state-not-attention.md`](../../zh-CN/superpowers/plans/2026-07-24-merged-schema-state-not-attention.md)

## Global Constraints

- Product DTO `schemaState` remains `"valid" | "invalid" | "unreviewed"` only.
- `merged` is a stored/writeback marker that must normalize to `valid`, not `unreviewed`.
- Do not change badge copy, `resolveGovernanceState`, or `ImportanceCell`.
- Do not add a DB migration or bulk UPDATE of historical rows.
- Do not force `policyState: "pass"` after merge; use `"not_applicable"`.
- True `unreviewed`, open identity mapping, and `invalid` / policy `fail` behavior must stay unchanged.
- Feature branch: `fix/merged-schema-state-not-attention` from latest `main`.
- Implementation agents commit on the feature branch only; parent opens/merges the PR.
- `docs/superpowers/` is gitignored; force-add EN plan/spec with `git add -f` when committing.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work on `fix/merged-schema-state-not-attention`, implement, test, commit on branch |
| Implementation agent | Must not push to `main`, open/merge GitHub PRs, or fast-forward local `main` |
| Parent agent | Review, create PR, merge, `git pull origin main` |

## File map

| File | Responsibility |
| --- | --- |
| `server/modules/parameter-topology/schemaState.ts` | Map `merged` → `valid` |
| `server/modules/parameter-topology/schemaState.test.ts` | Unit coverage for `merged` |
| `server/modules/parameter-topology/editService.ts` | Writeback persists `valid` / `not_applicable` |
| `server/modules/parameter-topology/editService.test.ts` (or nearest writeback assertion) | Assert new persisted enums if a test already covers that upsert |
| `docs/design-docs/domain-model.md` + ZH twin | One-sentence note on merge writeback schema_state normalization |
| Spec/plan EN+ZH under `docs/superpowers` / `docs/zh-CN/superpowers` | Already authored; keep in sync if behavior tweaks |

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Superpowers spec | `docs/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md`, ZH twin | Review (approved; force-add EN if missing from git) |
| Domain model | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` | Update (one sentence: merge writeback stores/normalizes healthy schema as `valid`) |
| FRONTEND / product specs / API contract | — | No change (DTO enum unchanged; UI logic unchanged) |
| Repo maps / ARCHITECTURE / SECURITY / RELIABILITY | — | No change |
| Exec-plans / tech-debt | — | No change (no deferred backfill) |

## Documentation Update Gate

Blocking before complete:

- [ ] EN + ZH domain-model one-liners updated (or recorded unchanged with evidence)
- [ ] Spec/plan EN force-added if still ignored-only
- [ ] `npm run docs:check` passes
- [ ] Targeted server tests for normalize + writeback pass

---

### Task 1: Normalize `merged` → `valid` (TDD)

**Files:**
- Modify: `server/modules/parameter-topology/schemaState.test.ts`
- Modify: `server/modules/parameter-topology/schemaState.ts`

**Interfaces:**
- Consumes: `normalizeBindingSchemaState(value: string | null | undefined): BindingSchemaStateDto`
- Produces: `"merged"` maps to `"valid"`; other cases unchanged

- [ ] **Step 1: Write the failing test**

In `schemaState.test.ts`, extend the healthy-states test:

```ts
  it("maps product and legacy healthy states to valid", () => {
    expect(normalizeBindingSchemaState("valid")).toBe("valid");
    expect(normalizeBindingSchemaState("matched")).toBe("valid");
    expect(normalizeBindingSchemaState("reviewed")).toBe("valid");
    expect(normalizeBindingSchemaState("merged")).toBe("valid");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- server/modules/parameter-topology/schemaState.test.ts`

Expected: FAIL — `expected 'unreviewed' to be 'valid'` (or equivalent) for `"merged"`.

- [ ] **Step 3: Minimal implementation**

In `schemaState.ts`, add `"merged"` to the healthy branch:

```ts
export function normalizeBindingSchemaState(value: string | null | undefined): BindingSchemaStateDto {
  if (value === "invalid") return "invalid";
  if (value === "valid" || value === "matched" || value === "reviewed" || value === "merged") {
    return "valid";
  }
  if (value === "unreviewed") return "unreviewed";
  return "unreviewed";
}
```

Update the file comment if it only mentions matched/reviewed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- server/modules/parameter-topology/schemaState.test.ts`

Expected: PASS (all cases in the file).

- [ ] **Step 5: Commit**

```bash
git add server/modules/parameter-topology/schemaState.ts server/modules/parameter-topology/schemaState.test.ts
git commit -m "$(cat <<'EOF'
fix: treat merge writeback schema_state merged as valid

EOF
)"
```

---

### Task 2: Persist product enums on merge writeback (TDD)

**Files:**
- Modify: `server/modules/parameter-topology/editService.ts` (~lines 1944–1950)
- Modify: nearest unit/integration test that asserts `upsertBindingRevisionValues` args for locked merge writeback — if none exists, add a focused unit assertion by searching for `applyLockedOverlayWriteback` / `schemaState: "merged"` callers; prefer extending an existing `editService.test.ts` case that reaches the writeback upsert. If the writeback path is only covered by integration tests that check DB `schema_state`, update that expectation from `merged` to `valid`.

**Interfaces:**
- Consumes: `upsertBindingRevisionValues(..., { values: { schemaState, policyState, ... } })`
- Produces: writeback stores `schemaState: "valid"`, `policyState: "not_applicable"`

- [ ] **Step 1: Locate and write/adjust the failing assertion**

Search:

```bash
rg -n 'schemaState: "merged"|schema_state.*merged' server/modules/parameter-topology
```

If an existing test expects `merged`, change expectation to `valid` / `not_applicable` first and confirm RED (implementation still writes `merged`).

If no test covers the writeback values object, add the smallest unit test that mocks `upsertBindingRevisionValues` (follow existing `editService.test.ts` patterns) and asserts the call includes:

```ts
expect(upsertBindingRevisionValues).toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({
    values: expect.objectContaining({
      schemaState: "valid",
      policyState: "not_applicable"
    })
  })
);
```

(Adapt to the real mock style in that file — do not invent a new mocking framework.)

- [ ] **Step 2: Run the chosen test and confirm RED**

Run the specific test file/command discovered in Step 1.

Expected: FAIL while `editService.ts` still writes `"merged"`.

- [ ] **Step 3: Minimal implementation**

In `editService.ts` replace:

```ts
        schemaState: "merged",
        policyState: "merged",
```

with:

```ts
        schemaState: "valid",
        policyState: "not_applicable",
```

- [ ] **Step 4: Run tests GREEN**

Run the same targeted test(s) as Step 2, plus:

`npm test -- server/modules/parameter-topology/schemaState.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/parameter-topology/editService.ts server/modules/parameter-topology/editService.test.ts
# include any other test file touched in Step 1
git commit -m "$(cat <<'EOF'
fix: persist valid schema_state on merge writeback

EOF
)"
```

---

### Task 3: Domain docs + docs:check

**Files:**
- Modify: `docs/design-docs/domain-model.md` (near immutable base vs candidate binding revisions / writeback paragraph)
- Modify: `docs/zh-CN/design-docs/domain-model.md` (matching Chinese sentence)
- Ensure tracked: EN+ZH specs and plans under superpowers (EN needs `git add -f`)

**Interfaces:**
- Produces: durable note that merge writeback stores healthy binding schema as `valid`, and historical `merged` normalizes to `valid` for API/workbench

- [ ] **Step 1: Add EN one-liner**

Near the “Immutable base vs candidate binding revisions” / writeback language, add:

> Merge writeback persists binding-revision `schema_state` as `valid` (historical rows may still store `merged`, which API normalization maps to `valid` so the workbench does not show attention).

- [ ] **Step 2: Add ZH one-liner**

Matching sentence in `docs/zh-CN/design-docs/domain-model.md`.

- [ ] **Step 3: Run docs check**

Run: `npm run docs:check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/design-docs/domain-model.md docs/zh-CN/design-docs/domain-model.md
git add -f docs/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md \
  docs/superpowers/plans/2026-07-24-merged-schema-state-not-attention.md
git add docs/zh-CN/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md \
  docs/zh-CN/superpowers/plans/2026-07-24-merged-schema-state-not-attention.md
git commit -m "$(cat <<'EOF'
docs: note merge writeback schema_state valid mapping

EOF
)"
```

---

### Task 4: Verification gate

- [ ] **Step 1: Targeted server tests**

```bash
npm test -- server/modules/parameter-topology/schemaState.test.ts
# plus the writeback test file(s) from Task 2
```

Expected: PASS.

- [ ] **Step 2: Optional live check (if local API/UI up)**

Confirm Aurora `gpio_int` (`sc8562@6E`) no longer shows「待处理」after API returns `schemaState: "valid"` for the previously `merged` revision (read-path fix alone is enough for existing data).

- [ ] **Step 3: Parent only — open PR when implementation is complete**

Do not open/merge from implementation subagents.

---

## Self-review

1. **Spec coverage:** Read normalize + write persist + no migration + docs note + tests — all have tasks.
2. **Placeholders:** None; exact strings and commands included.
3. **Type consistency:** DTO remains `valid|invalid|unreviewed`; stored `merged` only on historical rows until rewritten.

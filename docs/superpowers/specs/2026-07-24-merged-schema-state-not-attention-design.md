# Merged binding schema state must not show「待处理」— design

> Date: 2026-07-24  
> Status: approved for implementation  
> Chinese: [`docs/zh-CN/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md`](../../zh-CN/superpowers/specs/2026-07-24-merged-schema-state-not-attention-design.md)  
> Branch: `fix/merged-schema-state-not-attention`

## Problem

Locked merge writeback upserts `project_parameter_binding_revisions` with `schema_state = "merged"` (and historically `policy_state = "merged"`). The list API normalizes schema state through `normalizeBindingSchemaState`, which only treats `valid` / `matched` / `reviewed` as healthy and **fails closed** everything else (including `merged`) to `unreviewed`.

The parameter workbench maps `schemaState === "unreviewed"` to `governanceState: "attention"` and shows the「待处理」badge. After a successful merge, operators therefore see a false attention signal that is indistinguishable from true identity-mapping or unreviewed-spec work.

Observed on local Aurora: `sc8562@6E` / `gpio_int` had DB `schema_state=merged` while `/parameter-bindings` returned `schemaState: "unreviewed"` and the table showed「待处理」. Open identity-mapping tasks were empty.

## Goals

- Successful merge writeback must not surface as workbench「待处理」solely because of stored `merged`.
- Existing rows with `schema_state=merged` become healthy via the read path (no mandatory SQL backfill).
- New writebacks persist product schema/policy enums instead of inventing `merged`.
- True `unreviewed`, open identity mapping, and `invalid` / policy `fail` behavior stay unchanged.

## Non-goals

- Changing badge copy or introducing a separate「已合入」governance label.
- Forcing `policyState` to `pass` after merge (keep `not_applicable` unless policy actually ran).
- Database migration / bulk UPDATE of historical `merged` rows.
- Frontend-only badge suppression without fixing API normalization.
- Broader schema-validation product workflow redesign.

## Design

### Read path

In `server/modules/parameter-topology/schemaState.ts`, treat `merged` as a healthy legacy/writeback marker:

- `normalizeBindingSchemaState("merged") === "valid"`
- Keep fail-closed mapping for unknown / null / empty → `unreviewed`
- Keep `invalid` and literal `unreviewed` unchanged

### Write path

In locked merge writeback (`editService` candidate upsert for action `"set"`):

- Persist `schemaState: "valid"` (not `"merged"`)
- Persist `policyState: "not_applicable"` (not `"merged"`), matching current API normalization of unknown policy values and the fact that merge does not re-run policy evaluation here

### Workbench (unchanged)

`resolveGovernanceState` and `ImportanceCell` stay as-is. After normalization returns `valid`, attention only appears for `mappingOpen` or true `unreviewed` / blocked states.

### Data flow

```text
merge writeback
  → DB schema_state = valid (new) | merged (historical)
  → normalizeBindingSchemaState → valid
  → resolveGovernanceState → not attention (unless mappingOpen)
  → UI: no「待处理」badge
```

## Testing

- Unit: `normalizeBindingSchemaState("merged") === "valid"`; existing healthy/legacy/fail-closed cases still pass.
- Writeback / edit tests that assert persisted revision fields: expect `valid` + `not_applicable`, not `merged`.
- Do not weaken tests that prove real `unreviewed` still yields `attention` in `buildDtsWorkbenchRows`.

## Documentation impact (brief)

| Area | Action |
| --- | --- |
| This design pair (EN/ZH) | Update (this change) |
| Domain / FRONTEND if they claim only ingest writes `unreviewed` for attention | Review; add one sentence if needed |
| API contract enum docs | Review; product DTO remains `valid \| invalid \| unreviewed` |
| Exec-plan / tech-debt | No change unless a follow-up backfill is deferred |

## Success criteria

1. API returns `schemaState: "valid"` for bindings whose current revision is stored as `merged` or newly written `valid` after merge.
2. Workbench does not show「待处理」for those rows when mapping tasks are closed and schema is not literally unreviewed/invalid.
3. Targeted server unit tests pass; no regression on true attention/blocked paths.

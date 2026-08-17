# ADR-0016: Cell arrays are governed by column width only

- Status: Accepted
- Date: 2026-08-03
- Plan: `docs/exec-plans/completed/2026-08-03-parameter-spec-editor-fidelity.md`

## Context

A cell-array parameter definition stored four numbers describing its layout: `valueShape.kind`, `valueShape.bits`, `valueShape.groups`, and `valueShape.cellsPerGroup`, with `constraints.cells` mirroring the last one. Authoring all four was mandatory before activation (`assertSpecActivatable`), and the shape editor exposed three numeric inputs for them.

Real DTS cell arrays do not fit that model. A great many have a fixed column count and a variable row count — `ranges`, fitting tables, and multi-group `interrupts` all grow or shrink by rows between boards — and some vary in both. Two facts about the existing code make the mandatory fields worse than merely redundant:

1. **Nothing enforces the row count.** The only per-value gate on the write path is `assertSchemaAllows` (`server/modules/parameter-topology/editService.ts`), which checks that *every group* has exactly `constraints.cells` cells and deliberately does not constrain the number of groups. No code compares a binding's `value.groups.length` against `valueShape.groups`. `groups` was required at activation, consumed by nothing, and — because inference sees a single occurrence — usually wrong the moment it was written.
2. **The runtime already supports an unconstrained width, but authoring could not express it.** `assertSchemaAllows` skips the check entirely when `constraints.cells` is absent, yet activation demanded `cellsPerGroup >= 1`. An operator whose property genuinely varies in width had no option but to invent a number, and that invented number then rejected legitimate writes.

So the enforcement layer was already the right shape, and the authoring layer was asking for facts nobody could supply or use.

## Decision

1. **Column width is the only layout fact governed for cell arrays.** `constraints.cells` remains the single enforcement input: every group must contain exactly that many cells, and the number of groups is never constrained. Row count is not a governed property of a definition.
2. **`valueShape.groups` is no longer authored, required, or exposed.** It is not removed from storage: inference still records the row count it observed, and reads and writes pass it through so no stored data is lost. It carries no authority — activation does not require it, and the shape editor does not show it.
3. **The column width is optional, and "unconstrained" is stated explicitly.** `constraints.cells` now has three distinct states:
   - a positive integer — the width is fixed and enforced;
   - `null` — the operator declared the width variable, so nothing is enforced;
   - the key absent — nobody decided, which stays fail-closed for activation and resolve.

   The explicit `null` is what keeps `assertSpecResolvable` fail-closed while still allowing a genuinely variable-width definition to activate. Silence and a decision must not look alike.
4. **`bits` stays required for cell arrays.** It decides the `/bits/ N <...>` syntax that gets written to the device, so a wrong value produces wrong DTS. It is the one layout number that is load-bearing on the write path.
5. **An inferred draft may widen its sampled layout, but not contradict it.** Activation still refuses to change `kind`, `bits`, or `length` away from what inference recorded, and still refuses to replace an inferred `cellsPerGroup` with a *different* number. Dropping `cellsPerGroup` (declaring the width variable) and changing `groups` are both allowed, because one occurrence cannot prove either fact.
6. **The width is inferred from the example value, not typed.** The shape editor infers `bits` and `cellsPerGroup` from the illustrative example whenever the example changes or the kind becomes a cell kind. Row count is not inferred. When an example's groups disagree in width, inference declines rather than guessing, and the operator is told to leave the field empty.

## Consequences

- `assertSpecActivatable` no longer validates `groups`; `hasCompleteConstraints` accepts an explicit `cells: null` for cell kinds via `readCellWidthDecision`.
- `defaultConstraintsForShape` emits `{ cells: null }` rather than `{}` when no width is known, so create and activate paths state the decision instead of leaving a hole.
- The shape editor drops from three numeric inputs to two (`bits`, `cellsPerGroup`), and `cellsPerGroup` reads 「留空 = 列宽不约束」.
- Existing data passes unchanged: this is a relaxation, and stored `groups` values are preserved.
- A definition whose width is unconstrained accepts any group width on the write path. That is the intended trade: no automatic width check, in exchange for never enforcing an invented one.

## Alternatives considered

- **Manage cell values as free text with no shape at all**: rejected. `constraints.cells` is the only automatic check that catches a real class of error before a value reaches a device, and `scripts/lib/vendorDtSchemaGenerator.ts` consumes it to generate vendor dt-schema. Dropping the shape discards the one working gate and returns nothing.
- **Add a `variableWidth: true` flag to `valueShape`**: rejected. It adds a field to the layer being simplified, and duplicates a decision that belongs where the enforcement reads it. `constraints.cells: null` says the same thing in the place that already matters.
- **Keep `groups` as a required informational field**: rejected. A required field that nothing consumes still blocks activation, and inference from one occurrence makes it wrong for exactly the variable-row properties that motivated this ADR.
- **Enforce row count as well** (for example `minGroups`/`maxGroups`): deferred. No observed error class calls for it, and the properties in question are variable by nature.

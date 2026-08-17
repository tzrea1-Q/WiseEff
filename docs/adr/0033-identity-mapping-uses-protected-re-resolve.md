# Identity mapping mistakes re-resolve in place; there is no inverse undo

Resolving an identity-ambiguity task calls `applyReviewedIdentityMapping`, which rewrites binding identity for that config revision. Reopen is already limited to outcomes that changed no data (`dismissed`, `new_identity`). The remaining failure is "resolved to the wrong candidate." An inverse undo looks symmetric until drafts, submissions, or device operations accumulate against the remapped node — then undo is a second migration, not a toggle.

We decided **not to model an inverse of `applyReviewedIdentityMapping`**. Correction is **protected re-resolve on the same task**: `POST /api/v2/identity-mapping-tasks/:taskId/resolve` with `decision: resolved` and a different `selectedLogicalNodeId` while the task is already `resolved`. The server reapplies mapping (implemented as map prior-selection → previous node, then previous → next candidate) and updates the task evidence. Same-target retries are idempotent.

## Considered Options

- **Inverse remap / undo stack.** Rejected. Bindings are not a stack: later drafts, submission items, and `node_operations` hang off the remapped identity. An undo that ignores them silently orphans workflow rows; an undo that cascades them is a new product, not a correction.
- **Force a new DTS upload as the only remedy.** Rejected as the *only* path. It remains the escape when continuity evidence is missing or downstream usage exists.
- **Reopen a resolved task back to `open`.** Rejected. Reopen is for decisions that did not rewrite bindings. Mixing it with applied mappings would let an Admin "un-decide" without running the downstream gate.

## Gates (already in the resolve path; keep them)

- Continuity evidence must name the prior selection and the previous node; the next id must be in the original candidate list and belong to the same organization, project, and config revision. Otherwise `409` `identity-mapping-migration-required` (explicit migration / new DTS).
- Downstream usage on the affected logical nodes (`parameter_drafts`, `parameter_submission_items`, `node_operations`) blocks re-resolve with the same `409` and a `downstream` count. Clear or migrate those rows first.
- `singleton-cardinality` tasks still reject identity decisions.

## Consequences

- Do not add an undo route, an inverse table, or a reopen path for `resolved`.
- The API contract and mock runtime must describe re-resolve. The mock today throws CONFLICT on a second resolve; that is a defect against this decision, not a product rule.
- Frontend copy that says "use protected re-resolve" must actually offer the candidate picker on a resolved identity-ambiguity task when the gates can pass.

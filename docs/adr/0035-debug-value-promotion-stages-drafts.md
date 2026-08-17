# Proven debug values promote through parameter drafts, never through the reload write path

ADR-0019 forbids a reload run from mutating binding revisions, working configuration, drafts, change requests, or release baselines. Hardware-proven values still have no governed path into the library (TD-063). Distil-to-knowledge (`POST /api/v1/knowledge/distill-from-reload-run`) already copies run evidence into a **knowledge draft**; that is a different act and must stay different — knowledge is not a parameter binding.

We decided that promotion is **a reload-adjacent command that creates `parameter_drafts` for selected targets**, then stops. The engineer submits and reviewers merge through the existing workbench change-request flow. The reload start / deploy / complete paths stay read-only toward the library.

This session does not implement the command. TD-063 stays a design-then-build item; do not write reload → change request in the deploy path.

## Considered Options

- **Write the debug value into the binding revision when the run is `verified`.** Rejected. That is the retired M1 parameter-reload model ADR-0019 exists to prevent.
- **Create a `parameter_change_request` directly from the run, skipping drafts.** Rejected. Change requests are born from a locked draft + candidate revision (ADR-0028, migration `0063`). Inventing a second birth path skips write locks and exact-occurrence identity.
- **Treat distil-to-knowledge as the promotion path.** Rejected. A published knowledge entry does not change DTS. Operators who want the value on device-as-library still need a binding draft.
- **Auto-submit a round for every verified target.** Rejected. Promotion is a proposal. Submit/review permissions and mixed-working-tip coordination stay with the workbench.
- **Allow `restore-baseline` runs to promote.** Rejected. Those values are already the library baseline.

## Eligible runs and targets

| Run | Promote? |
| --- | --- |
| `purpose: ordinary` and `verified` | Yes, selected targets |
| `purpose: ordinary` and `unverifiable` | Yes only with `unverifiableAcknowledged: true` — the platform did not confirm the driver observed the values |
| `contradicted`, `failed`, non-terminal, `purpose: restore-baseline` | No (`409`) |

Each selected target must still address the current binding (same residue-drift rule as restore-baseline): if the node path has moved, refuse that target rather than write the wrong node. The debug value must still conform to the resolved reload value shape.

## Command shape (implementation input)

- New command, not a side effect of deploy. Suggested route: `POST` under the existing DTS reload run resource, e.g. `/api/v1/dts-reload/runs/:runId/promote-to-drafts`.
- Body: `{ bindingIds: string[], unverifiableAcknowledged?: boolean }`. Empty selection → `400`.
- Authz: caller must pass the reload read gate **and** `parameter:edit`. Promotion does not grant submit/review.
- For each accepted target, upsert a binding draft with `action: set` and `targetValue` equal to the stored debug value, through the same `createBindingDraft` / write-lock rules the typed editor uses. Reason (or draft metadata) records `sourceReloadRunId`, baseline value, debug value, and the per-parameter verification outcome.
- Return created/updated draft ids and a workbench deep link. Do **not** create submission rounds or change requests.
- Open draft or in-flight change request on the same binding → `409` for that target (do not stack). Idempotent if a draft already holds the same raw value from this run.
- Audit: `reload-value-promoted-to-draft` (name illustrative) with run id, binding ids, and terminal status. Never an audited library write.
- Tests must keep asserting the reload run's library fingerprint is unchanged (ADR-0019).

## Consequences

- Experiment → library traceability is the draft/CR provenance, not a new value source in `dts_reload_runs`.
- TD-064 (workbench → `/dts-reload` hand-off) is the opposite direction and stays separate.
- Knowledge distillation remains available on every honest terminal, including `failed`; promotion is stricter on purpose.

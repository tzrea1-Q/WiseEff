# Issue #849 Scratch reconnaissance index

Read-only reconnaissance produced on the 2026-09-15 Scratch round (branch `feat/849-parameter-unification`, base `8f03cfa4302aebbe3bc3c37ef2197c082c2a3e2e`). These files are working evidence for the **remaining** work packages, not product documentation and not acceptance results. They were written before implementation and each claim carries a file path and line number.

| File | Covers | Use it for |
| --- | --- | --- |
| `seed-inventory-recon.md` | `src/config/power-management.json` per-item values, the 113 vendor definition inputs and their block mechanism, board occurrence counts, existing seed tooling wiring, current parity tests | PU-00/PU-02/PU-04 seed work |
| `configurationschema-extension-recon.md` | Exhaustive map of every closed subject/selector contract, SQL constraint, trigger, generated artifact, capability revision, DTO and UI branch that a third `configuration-schema` subject kind must touch | PU-01; this is an R3 change needing a threat matrix first |
| `dts-json-source-recon.md` | Project-source format decision, DTS CST / JSON parser and writeback entry points, vendor-YAML-versus-project-YAML distinction, all byte-accepting routes, and the frontend silent fallback | PU-02 |
| `configurationschema-threat-matrix.md` | The R3 threat matrix for the third subject kind: 16 rows (historical replay, admission, identity forgery, selector collisions, subtypes, placement, goldens, concurrency, retirement) plus explicit non-goals and a stated self-review limit | PU-01; read this before touching the closed kind sets |
| `configurationschema-spec-review.md` | Independent adversarial Spec review of the PU-01 threat matrix: verdict **FAIL**, 3 P0 / 6 P1 / 3 P2, including a refutation of the matrix's "under-validate, not mis-validate" claim and a three-slice delivery plan. An implementing agent may not self-approve this document | PU-01; this is the gate that must be closed before Slice B/C |
| `cutover-consumers-recon.md` | Cutover operator seam and P0–P16 availability, classifier dispositions, archive adapter, legacy mapping lookup, the 410-vs-404 contract, self-hosted controller surface, the eleven consumer families, and what is genuinely missing | PU-06/PU-07 |

## Corrections to earlier planning text

- The plan's figure of **"24 dangling overlay targets" is not reproducible**. Two independent measurements found **29** distinct unresolved `&label` overlay targets and **37** missing `&name` references per board. The checked-in seed manifest stores the measured 29 and records the discrepancy. Plan against 29.
- The plan's 125/113/12/117/8 input counts and the 120 business + 56 structural occurrences per board **were reproduced exactly**; see `src/config/seed-reconciliation/manifest.json`.

## Status of the work packages after the 2026-09-15 round

Delivered: the four named coexistence defects, the canonical pending-value draft owner (migration `0144`), the canonical submit/review/apply change-request vertical (migration `0145`), the canonical binding change-history read surface, the DTS/JSON-only format boundary with explicit refusal of YAML/TOML/ENV, the seed reconciliation manifest, and the reviewed real per-project source files for the four current compatibility seeds. Not delivered: PU-01 ConfigurationSchema, the complete demo DTS baselines with the dangling overlay targets resolved, seed publication and initialization, the frontend workflow surface, PU-06 consumer switch, PU-07 archive-rebuild and PU-08 rehearsal.

See [`2026-09-15-parameter-unification-round-report.md`](../2026-09-15-parameter-unification-round-report.md) for per-item results, commands and the explicit failure/skip/risk list.

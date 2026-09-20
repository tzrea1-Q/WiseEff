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
| `capability-v4-threat-matrix.md` | T1.2 R3 threat matrix for catalog-capability/v4 and charging_core NodeType | T1.2 |
| `capability-v4-design.md` | T1.2 implementable design after independent Spec review | T1.2 |
| `capability-v4-acceptance.md` | T1.2 local implementation receipt | T1.2 |
| `t13-complete-successor-threat-matrix.md` | T1.3 R3 threat matrix for complete successor, reviewed sources, B2 materialization | T1.3 |
| `t13-complete-successor-design.md` | T1.3 implementable design after independent Spec review | T1.3 |
| `t13-complete-successor-spec-review.md` | T1.3 independent design Spec review | T1.3 |
| `t13-complete-successor-impl-review.md` | T1.3 independent implementation Standards + Spec review | T1.3 |
| `t13-complete-successor-acceptance.md` | T1.3 local implementation receipt | T1.3 |
| `t24-real-dts-toolchain-threat-matrix.md` | T2.4 R3 threat matrix for real dtc/fdtoverlay, stub persistence, overlay application | T2.4 |
| `t24-real-dts-toolchain-design.md` | T2.4 implementable design after independent Spec review | T2.4 |
| `t24-real-dts-toolchain-spec-review.md` | T2.4 independent design Spec review | T2.4 |
| `t24-real-dts-toolchain-impl-review.md` | T2.4 independent implementation Standards + Spec review | T2.4 |
| `t24-real-dts-toolchain-acceptance.md` | T2.4 local implementation receipt | T2.4 |
| `t21-parameter-ui-threat-matrix.md` | T2.1 R2 threat matrix for canonical parameter UI | T2.1 |
| `t21-parameter-ui-design.md` | T2.1 implementable design after independent Spec review | T2.1 |
| `t21-parameter-ui-spec-review.md` | T2.1 independent design Spec review | T2.1 |
| `t21-parameter-ui-impl-review.md` | T2.1 independent implementation Standards + Spec review | T2.1 |
| `t21-parameter-ui-acceptance.md` | T2.1 local implementation receipt | T2.1 |
| `t22-cgh-catalog-governance-threat-matrix.md` | T2.2-CGH threat matrix | T2.2-CGH |
| `t22-cgh-catalog-governance-design.md` | T2.2-CGH implementable design after Spec FAIL then PASS with P2 | T2.2-CGH |
| `t22-cgh-catalog-governance-spec-review.md` | T2.2-CGH independent design Spec review | T2.2-CGH |
| `t22-cgh-catalog-governance-acceptance.md` | T2.2-CGH local implementation receipt | T2.2-CGH |
| `t22-cgh-catalog-governance-impl-review.md` | T2.2-CGH independent implementation Standards + Spec review | T2.2-CGH |
| `t22-top-topology-consumers-threat-matrix.md` | T2.2-TOP threat matrix | T2.2-TOP |
| `t22-top-topology-consumers-design.md` | T2.2-TOP implementable design after Spec PASS with P2 | T2.2-TOP |
| `t22-top-topology-consumers-spec-review.md` | T2.2-TOP independent design Spec review | T2.2-TOP |
| `t22-top-topology-consumers-acceptance.md` | T2.2-TOP local implementation receipt | T2.2-TOP |
| `t22-top-topology-consumers-classification.md` | T2.2-TOP S12-TOP file×rule classification (80 groups) | T2.2-TOP |
| `t22-top-topology-consumers-impl-review.md` | T2.2-TOP independent implementation Standards + Spec review | T2.2-TOP |
| `t22-prj-project-consumers-threat-matrix.md` | T2.2-PRJ threat matrix | T2.2-PRJ |
| `t22-prj-project-consumers-design.md` | T2.2-PRJ implementable design after Spec PASS with P2 | T2.2-PRJ |
| `t22-prj-project-consumers-spec-review.md` | T2.2-PRJ independent design Spec review | T2.2-PRJ |
| `t22-prj-project-consumers-acceptance.md` | T2.2-PRJ local implementation receipt | T2.2-PRJ |
| `t22-prj-project-consumers-classification.md` | T2.2-PRJ S12-PRJ file×rule classification (88 groups) | T2.2-PRJ |
| `t22-prj-project-consumers-impl-review.md` | T2.2-PRJ independent implementation Standards + Spec review | T2.2-PRJ |
| `t22-fil-file-consumers-threat-matrix.md` | T2.2-FIL threat matrix | T2.2-FIL |
| `t22-fil-file-consumers-design.md` | T2.2-FIL implementable design after Spec PASS with P2 | T2.2-FIL |
| `t22-fil-file-consumers-spec-review.md` | T2.2-FIL independent design Spec review | T2.2-FIL |
| `t22-fil-file-consumers-acceptance.md` | T2.2-FIL local implementation receipt | T2.2-FIL |
| `t22-fil-file-consumers-classification.md` | T2.2-FIL S12-FIL file×rule classification (23 groups) | T2.2-FIL |
| `t22-fil-file-consumers-impl-review.md` | T2.2-FIL independent implementation Standards + Spec review | T2.2-FIL |
| `t22-agt-agent-consumers-threat-matrix.md` | T2.2-AGT threat matrix | T2.2-AGT |
| `t22-agt-agent-consumers-design.md` | T2.2-AGT implementable design after Spec PASS with P2 | T2.2-AGT |
| `t22-agt-agent-consumers-spec-review.md` | T2.2-AGT independent design Spec review | T2.2-AGT |
| `t22-agt-agent-consumers-acceptance.md` | T2.2-AGT local implementation receipt | T2.2-AGT |
| `t22-agt-agent-consumers-classification.md` | T2.2-AGT S12-AGT file×rule classification (7 groups) | T2.2-AGT |
| `t22-agt-agent-consumers-impl-review.md` | T2.2-AGT independent implementation Standards + Spec review | T2.2-AGT |
| `t22-log-log-consumers-threat-matrix.md` | T2.2-LOG threat matrix | T2.2-LOG |
| `t22-log-log-consumers-design.md` | T2.2-LOG implementable design after Spec PASS with P2 | T2.2-LOG |
| `t22-log-log-consumers-spec-review.md` | T2.2-LOG independent design Spec review | T2.2-LOG |
| `t22-log-log-consumers-acceptance.md` | T2.2-LOG local implementation receipt | T2.2-LOG |
| `t22-log-log-consumers-classification.md` | T2.2-LOG S12-LOG file×rule classification (3 groups) | T2.2-LOG |
| `t22-log-log-consumers-impl-review.md` | T2.2-LOG independent implementation Standards + Spec review | T2.2-LOG |
| `t22-dbg-debug-consumers-threat-matrix.md` | T2.2-DBG threat matrix | T2.2-DBG |
| `t22-dbg-debug-consumers-design.md` | T2.2-DBG implementable design after Spec PASS with P2 | T2.2-DBG |
| `t22-dbg-debug-consumers-spec-review.md` | T2.2-DBG independent design Spec review | T2.2-DBG |
| `t22-dbg-debug-consumers-acceptance.md` | T2.2-DBG local implementation receipt | T2.2-DBG |
| `t22-dbg-debug-consumers-classification.md` | T2.2-DBG S12-DBG file×rule classification (5 groups) | T2.2-DBG |
| `t22-dbg-debug-consumers-impl-review.md` | T2.2-DBG independent implementation Standards + Spec review | T2.2-DBG |
| `t22-dts-reload-consumers-threat-matrix.md` | T2.2-DTS threat matrix | T2.2-DTS |
| `t22-dts-reload-consumers-design.md` | T2.2-DTS implementable design after Spec PASS with P2 | T2.2-DTS |
| `t22-dts-reload-consumers-spec-review.md` | T2.2-DTS independent design Spec review | T2.2-DTS |
| `t22-dts-reload-consumers-acceptance.md` | T2.2-DTS local implementation receipt | T2.2-DTS |
| `t22-dts-reload-consumers-classification.md` | T2.2-DTS S12-DTS file×rule classification (12 groups) | T2.2-DTS |
| `t22-dts-reload-consumers-impl-review.md` | T2.2-DTS independent implementation Standards + Spec review | T2.2-DTS |
| `t22-knw-knowledge-consumers-threat-matrix.md` | T2.2-KNW threat matrix | T2.2-KNW |
| `t22-knw-knowledge-consumers-design.md` | T2.2-KNW implementable design after Spec PASS with P2 | T2.2-KNW |
| `t22-knw-knowledge-consumers-spec-review.md` | T2.2-KNW independent design Spec review | T2.2-KNW |
| `t22-knw-knowledge-consumers-acceptance.md` | T2.2-KNW local implementation receipt | T2.2-KNW |
| `t22-knw-knowledge-consumers-classification.md` | T2.2-KNW S12-KNW file×rule classification (15 groups) | T2.2-KNW |
| `t22-knw-knowledge-consumers-impl-review.md` | T2.2-KNW independent implementation Standards + Spec review | T2.2-KNW |
| `t22-mod-module-consumers-threat-matrix.md` | T2.2-MOD threat matrix | T2.2-MOD |
| `t22-mod-module-consumers-design.md` | T2.2-MOD implementable design after Spec PASS with P2 | T2.2-MOD |
| `t22-mod-module-consumers-spec-review.md` | T2.2-MOD independent design Spec review | T2.2-MOD |
| `t22-mod-module-consumers-classification.md` | T2.2-MOD S12-MOD file×rule classification (51 groups) | T2.2-MOD |
| `t22-mod-module-consumers-acceptance.md` | T2.2-MOD local implementation receipt | T2.2-MOD |
| `t22-mod-module-consumers-impl-review.md` | T2.2-MOD independent implementation Standards + Spec review | T2.2-MOD |
| `t22-ops-operations-consumers-threat-matrix.md` | T2.2-OPS threat matrix | T2.2-OPS |
| `t22-ops-operations-consumers-design.md` | T2.2-OPS implementable design after Spec PASS with P2 | T2.2-OPS |
| `t22-ops-operations-consumers-spec-review.md` | T2.2-OPS independent design Spec review | T2.2-OPS |
| `t22-ops-operations-consumers-classification.md` | T2.2-OPS S12-OPS file×rule classification (2 groups) | T2.2-OPS |
| `t22-ops-operations-consumers-acceptance.md` | T2.2-OPS local implementation receipt | T2.2-OPS |
| `t22-ops-operations-consumers-impl-review.md` | T2.2-OPS independent implementation Standards + Spec review | T2.2-OPS |
| `t14-final-legacy-cutover-threat-matrix.md` | T1.4 threat matrix | T1.4 |
| `t14-final-legacy-cutover-design.md` | T1.4 implementable design after Spec re-review PASS with P2 | T1.4 |
| `t14-final-legacy-cutover-spec-review.md` | T1.4 independent design Spec review | T1.4 |
| `t14-final-legacy-cutover-acceptance.md` | T1.4 progress receipt (not complete) | T1.4 |

## Corrections to earlier planning text

- The plan's figure of **"24 dangling overlay targets" is not reproducible**. Two independent measurements found **29** distinct unresolved `&label` overlay targets and **37** missing `&name` references per board. The checked-in seed manifest stores the measured 29 and records the discrepancy. Plan against 29.
- The plan's 125/113/12/117/8 input counts and the 120 business + 56 structural occurrences per board **were reproduced exactly**; see `src/config/seed-reconciliation/manifest.json`.

## Status of the work packages after the 2026-09-15 round

Delivered: the four named coexistence defects, the canonical pending-value draft owner (migration `0144`), the canonical submit/review/apply change-request vertical (migration `0145`), the canonical binding change-history read surface, the DTS/JSON-only format boundary with explicit refusal of YAML/TOML/ENV, the seed reconciliation manifest, and the reviewed real per-project source files for the four current compatibility seeds. Not delivered: PU-01 ConfigurationSchema, the complete demo DTS baselines with the dangling overlay targets resolved, seed publication and initialization, the frontend workflow surface, PU-06 consumer switch, PU-07 archive-rebuild and PU-08 rehearsal.

See [`2026-09-15-parameter-unification-round-report.md`](../2026-09-15-parameter-unification-round-report.md) for per-item results, commands and the explicit failure/skip/risk list.

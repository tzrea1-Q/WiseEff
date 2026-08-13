# Log Analysis Quality Eval Report

- Generated: 2026-08-13T02:09:59.238Z
- Run id: `qe-20260813-020959`
- Kernel: `loop` (deterministic mode)
- Model: `deterministic`
- Judge: `deterministic-rubric-stub`
- Cases: 6 (0 real, 6 synthetic)

## Aggregates

| Scope | Cases | Evidence recall | Evidence precision | Hallucination rate | Root-cause score | Category match | Actions score | Refusal appropriate | Degraded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 6 | 0.500 | 0.467 | 0.000 | 0.300 | 0.800 | 0.000 | 1.000 | 0 |
| realLog: true | 0 | — | — | — | — | — | — | — | — |
| realLog: false (format coverage) | 6 | 0.500 | 0.467 | 0.000 | 0.300 | 0.800 | 0.000 | 1.000 | 0 |

## Baseline gate

- Status: **inactive-pending-real-cases** — quality baseline pending real cases
- Tolerances: root-cause score −0.02, evidence recall −0.05

## Judge calibration

- Human-review sample (deterministic, rate 0.2): `charging-power/synthetic-thermal-foldback-basic` — checklist in `docs/generated/log-analysis-judge-sample.md`
- Judge-human agreement: **no human reviews yet** — commit `eval-cases/logs/reviews/qe-20260813-020959.yaml` from the checklist template to activate this metric.

## Case results

| Case | Real | Source | Degraded | Latency (ms) | Evidence recall | Hallucination | Root-cause | Category | Refusal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| charging-power/synthetic-comm-timeout-kernel-format | no | agent | - | 2 | 0.50 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-device-offline-critical | no | agent | - | 0 | 1.00 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-thermal-foldback-basic | no | agent | - | 1 | 0.00 | 0.00 | 1.00 | match | - |
| charging-power/synthetic-thermal-foldback-question | no | agent | - | 0 | 1.00 | 0.00 | 0.50 | match | - |
| uncategorized/synthetic-json-lines-error-codes | no | agent | - | 0 | 0.00 | 0.00 | 0.00 | miss | - |
| uncategorized/synthetic-nominal-heartbeat-refusal | no | agent | - | 1 | n/a | 0.00 | n/a | n/a | appropriate |

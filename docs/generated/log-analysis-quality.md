# Log Analysis Quality Eval Report

- Generated: 2026-11-18T12:52:23.681Z
- Run id: `qe-20261118-125223`
- Kernel: `loop` (deterministic mode)
- Model: `deterministic`
- Judge: `deterministic-rubric-stub`
- Cases: 9 (0 golden, 3 realistic, 6 synthetic)

## Aggregates

| Scope | Cases | Evidence recall | Evidence precision | Hallucination rate | Root-cause score | Category match | Actions score | Refusal appropriate | Degraded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 9 | 0.571 | 0.690 | 0.000 | 0.000 | 0.714 | 0.000 | 1.000 | 0 |
| golden | 0 | — | — | — | — | — | — | — | — |
| realistic | 3 | 0.250 | 0.750 | 0.000 | 0.000 | 0.500 | 0.000 | 1.000 | 0 |
| synthetic (format coverage) | 6 | 0.700 | 0.667 | 0.000 | 0.000 | 0.800 | 0.000 | 1.000 | 0 |

## Baseline gate

- Status: **inactive-pending-real-cases** — quality baseline pending real cases
- Tolerances: root-cause score −0.02, evidence recall −0.05

## Judge calibration

- Human-review sample (deterministic, rate 0.2): `charging-power/realistic-thermal-foldback-bundle` — checklist in `docs/generated/log-analysis-judge-sample.md`
- Judge-human agreement: **no human reviews yet** — commit `eval-cases/logs/reviews/qe-20261118-125223.yaml` from the checklist template to activate this metric.

## Case results

| Case | Tier | Source | Degraded | Latency (ms) | Evidence recall | Hallucination | Root-cause | Category | Refusal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| charging-power/realistic-thermal-foldback-bundle | realistic | agent | - | 161 | 0.25 | 0.00 | 0.00 | miss | - |
| charging-power/synthetic-comm-timeout-kernel-format | synthetic | agent | - | 8 | 0.50 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-device-offline-critical | synthetic | agent | - | 4 | 1.00 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-thermal-foldback-basic | synthetic | agent | - | 8 | 1.00 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-thermal-foldback-question | synthetic | agent | - | 9 | 1.00 | 0.00 | 0.00 | match | - |
| linux-kernel/realistic-i2c-bus-recovery | realistic | agent | - | 15 | 0.25 | 0.00 | 0.00 | match | - |
| service-jsonl/realistic-healthy-queue | realistic | agent | - | 11 | n/a | 0.00 | n/a | n/a | appropriate |
| uncategorized/synthetic-json-lines-error-codes | synthetic | agent | - | 10 | 0.00 | 0.00 | 0.00 | miss | - |
| uncategorized/synthetic-nominal-heartbeat-refusal | synthetic | agent | - | 5 | n/a | 0.00 | n/a | n/a | appropriate |

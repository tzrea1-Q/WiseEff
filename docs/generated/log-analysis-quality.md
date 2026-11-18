# Log Analysis Quality Eval Report

- Generated: 2026-11-18T13:15:28.975Z
- Run id: `qe-20261118-131528`
- Kernel: `loop` (deterministic mode)
- Model: `deterministic`
- Prompt version: `2026-10-19.loop.procedure.signals.source.3`
- Judge: `deterministic-rubric-stub`

## 中文摘要

共 9 个用例、9 次试验。每个用例计划运行 1 次，层级为 all，标签筛选为 全部。

本次使用确定性模型和评分器，仅用于验证评测流程。

pass@k 表示至少一次通过的用例比例，pass^k 表示每次都通过的用例比例。成本为「中位数 / p95」，缺少完整 token 用量的试验不计入 token 统计。

| 范围 | 用例 | 试验 | 根因均分 | 证据平均召回 | pass@k | pass^k | 步数 | token | 时延（ms） | 降级率（按原因） | 早收敛率 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 9 | 9 | 0.000 | 0.571 | 0.222 | 0.222 | 3 / 3 | 4063 / 4847 | 2 / 28 | 0.000 | 0.000 |
| golden | 0 | 0 | — | — | — | — | — | — | — | — | — |
| realistic | 3 | 3 | 0.000 | 0.250 | 0.333 | 0.333 | 3 / 3 | 3989 / 4847 | 4 / 28 | 0.000 | 0.000 |
| synthetic | 6 | 6 | 0.000 | 0.700 | 0.167 | 0.167 | 3 / 3 | 4071.5 / 4283 | 2 / 4 | 0.000 | 0.000 |
| cascade | 1 | 1 | 0.000 | 0.250 | 0.000 | 0.000 | 3 / 3 | 3941 / 3941 | 3 / 3 | 0.000 | 0.000 |
| distractor | 1 | 1 | 0.000 | 0.250 | 0.000 | 0.000 | 3 / 3 | 4847 / 4847 | 28 / 28 | 0.000 | 0.000 |
| generic-analysis | 1 | 1 | n/a | n/a | 1.000 | 1.000 | 3 / 3 | 3989 / 3989 | 4 / 4 | 0.000 | 0.000 |
| multi-file | 1 | 1 | 0.000 | 0.250 | 0.000 | 0.000 | 3 / 3 | 4847 / 4847 | 28 / 28 | 0.000 | 0.000 |
| no-fault | 1 | 1 | n/a | n/a | 1.000 | 1.000 | 3 / 3 | 3989 / 3989 | 4 / 4 | 0.000 | 0.000 |

## Aggregates

| Scope | Cases | Evidence recall | Evidence precision | Hallucination rate | Root-cause score | Category match | Actions score | Refusal appropriate | Degraded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 9 | 0.571 | 0.690 | 0.000 | 0.000 | 0.714 | 0.000 | 1.000 | 0 |
| golden | 0 | — | — | — | — | — | — | — | — |
| realistic | 3 | 0.250 | 0.750 | 0.000 | 0.000 | 0.500 | 0.000 | 1.000 | 0 |
| synthetic | 6 | 0.700 | 0.667 | 0.000 | 0.000 | 0.800 | 0.000 | 1.000 | 0 |
| cascade | 1 | 0.250 | 0.500 | 0.000 | 0.000 | 1.000 | 0.000 | n/a | 0 |
| distractor | 1 | 0.250 | 1.000 | 0.000 | 0.000 | 0.000 | 0.000 | n/a | 0 |
| generic-analysis | 1 | n/a | n/a | 0.000 | n/a | n/a | n/a | 1.000 | 0 |
| multi-file | 1 | 0.250 | 1.000 | 0.000 | 0.000 | 0.000 | 0.000 | n/a | 0 |
| no-fault | 1 | n/a | n/a | 0.000 | n/a | n/a | n/a | 1.000 | 0 |

## Baseline gate

- Status: **inactive-pending-real-cases** — quality baseline pending real cases
- Tolerances: root-cause score −0.02, evidence recall −0.05

## Judge calibration

- Human-review sample (deterministic, rate 0.2): `charging-power/realistic-thermal-foldback-bundle` — checklist in `docs/generated/log-analysis-judge-sample.md`
- Judge-human agreement: **no human reviews yet** — commit `eval-cases/logs/reviews/qe-20261118-131528.yaml` from the checklist template to activate this metric.

## Case results

| Case | Tier | Trial | Pass | Source | Degraded | Early convergence | Steps | Tokens | Latency (ms) | Evidence recall | Hallucination | Root-cause | Category | Refusal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| charging-power/realistic-thermal-foldback-bundle | realistic | 1 | FAIL | agent | - | - | 3 | 4847 | 28 | 0.25 | 0.00 | 0.00 | miss | - |
| charging-power/synthetic-comm-timeout-kernel-format | synthetic | 1 | FAIL | agent | - | - | 3 | 4063 | 4 | 0.50 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-device-offline-critical | synthetic | 1 | FAIL | agent | - | - | 3 | 4080 | 2 | 1.00 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-thermal-foldback-basic | synthetic | 1 | FAIL | agent | - | - | 3 | 4179 | 2 | 1.00 | 0.00 | 0.00 | match | - |
| charging-power/synthetic-thermal-foldback-question | synthetic | 1 | FAIL | agent | - | - | 3 | 4283 | 2 | 1.00 | 0.00 | 0.00 | match | - |
| linux-kernel/realistic-i2c-bus-recovery | realistic | 1 | FAIL | agent | - | - | 3 | 3941 | 3 | 0.25 | 0.00 | 0.00 | match | - |
| service-jsonl/realistic-healthy-queue | realistic | 1 | PASS | agent | - | - | 3 | 3989 | 4 | n/a | 0.00 | n/a | n/a | appropriate |
| uncategorized/synthetic-json-lines-error-codes | synthetic | 1 | FAIL | agent | - | - | 3 | 3995 | 1 | 0.00 | 0.00 | 0.00 | miss | - |
| uncategorized/synthetic-nominal-heartbeat-refusal | synthetic | 1 | PASS | agent | - | - | 3 | 3906 | 1 | n/a | 0.00 | n/a | n/a | appropriate |

# Log Analysis Behavior Eval Report

- Generated: 2026-08-13T00:59:57.722Z
- Single-shot prompt version: `2026-08-12.1`
- Loop prompt version: `2026-08-13.loop.1`
- Scenarios: 14 (14 passed)
- Meta checks: 4/4 passed

## Scenario Results

| Scenario | Category | Kernel | Source | Degraded | Result |
| --- | --- | --- | --- | --- | --- |
| grounded-normal-conclusion | grounding | single-shot | agent | - | PASS |
| hallucinated-citations-rejected | grounding | single-shot | rules-fallback | token-budget-exhausted | PASS |
| partially-hallucinated-citations-pruned | grounding | single-shot | agent | - | PASS |
| provider-outage-degrades-honestly | degradation | single-shot | rules-fallback | provider-unavailable | PASS |
| budget-exhausted-marked | degradation | single-shot | rules-fallback | token-budget-exhausted | PASS |
| analysis-question-injected-and-answered | analysis-question | single-shot | agent | - | PASS |
| loop-in-budget-convergence | loop-convergence | loop | agent | - | PASS |
| loop-illegal-tool-name-rejected-and-corrected | loop-tool-legality | loop | agent | - | PASS |
| loop-illegal-tool-args-rejected-and-corrected | loop-tool-legality | loop | agent | - | PASS |
| loop-persistent-illegal-calls-degrade-honestly | loop-tool-legality | loop | rules-fallback | token-budget-exhausted | PASS |
| loop-step-limit-early-convergence | loop-convergence | loop | agent | token-budget-exhausted | PASS |
| loop-token-budget-early-convergence | loop-convergence | loop | agent | token-budget-exhausted | PASS |
| loop-honest-refusal-on-insufficient-evidence | loop-honesty | loop | agent | - | PASS |
| loop-multi-step-grounding-enforced | loop-grounding | loop | agent | - | PASS |

## Meta Checks

- **meta-hallucinated-citation-detector**: PASS — Harness correctly flags evidence citing nonexistent lines
- **meta-silent-degradation-detector**: PASS — Harness correctly flags degraded output missing its degraded reason
- **meta-loop-overconfident-convergence-detector**: PASS — Harness correctly flags overconfident early convergence
- **meta-loop-silent-illegal-tool-detector**: PASS — Harness correctly flags a silently accepted illegal tool call

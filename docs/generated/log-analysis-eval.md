# Log Analysis Behavior Eval Report

- Generated: 2026-08-12T20:59:32.615Z
- Prompt version: `2026-08-12.1`
- Scenarios: 6 (6 passed)
- Meta checks: 2/2 passed

## Scenario Results

| Scenario | Category | Source | Degraded | Result |
| --- | --- | --- | --- | --- |
| grounded-normal-conclusion | grounding | agent | - | PASS |
| hallucinated-citations-rejected | grounding | rules-fallback | token-budget-exhausted | PASS |
| partially-hallucinated-citations-pruned | grounding | agent | - | PASS |
| provider-outage-degrades-honestly | degradation | rules-fallback | provider-unavailable | PASS |
| budget-exhausted-marked | degradation | rules-fallback | token-budget-exhausted | PASS |
| analysis-question-injected-and-answered | analysis-question | agent | - | PASS |

## Meta Checks

- **meta-hallucinated-citation-detector**: PASS — Harness correctly flags evidence citing nonexistent lines
- **meta-silent-degradation-detector**: PASS — Harness correctly flags degraded output missing its degraded reason

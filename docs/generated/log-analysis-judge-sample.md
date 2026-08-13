# Log Analysis Judge Review Sample

- Run id: `qe-20260813-020959`
- Judge: `deterministic-rubric-stub`
- Sampling: deterministic by case-id hash, rate 0.2 (minimum 1) — 1 of 5 judged case(s) selected
- Review record convention: commit the completed template below as `eval-cases/logs/reviews/qe-20260813-020959.yaml`; the next quality run then reports judge-human agreement.

## Sampled cases

| Case | Agent conclusion (truncated) | Judge root-cause score | Category | Actions score | Judge reasoning |
| --- | --- | --- | --- | --- | --- |
| charging-power/synthetic-thermal-foldback-basic | Charging behavior is consistent with thermal foldback protection reducing charge output. | 1.00 | match | 0.00 | deterministic rubric: root-cause coverage 1.00, actions coverage 0.00, category matched |

## Review template

Score each case on the same 0..1 rubric the judge uses (root-cause coverage of the
expert annotation). `humanCategoryMatch` and `notes` are optional but valuable.

```yaml
runId: qe-20260813-020959
reviewer: <your-name>
reviewedAt: <YYYY-MM-DD>
cases:
  - id: charging-power/synthetic-thermal-foldback-basic
    humanRootCauseScore: # 0..1 (judge said 1.00)
    humanCategoryMatch: # true/false (judge said true)
    notes: ""
```


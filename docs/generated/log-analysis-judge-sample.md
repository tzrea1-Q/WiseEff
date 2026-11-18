# Log Analysis Judge Review Sample

- Run id: `qe-20261118-125223`
- Judge: `deterministic-rubric-stub`
- Sampling: deterministic by case-id hash, rate 0.2 (minimum 1) — 1 of 7 judged case(s) selected
- Review record convention: commit the completed template below as `eval-cases/logs/reviews/qe-20261118-125223.yaml`; the next quality run then reports judge-human agreement.

## Sampled cases

| Case | Agent conclusion (truncated) | Judge root-cause score | Category | Actions score | Judge reasoning |
| --- | --- | --- | --- | --- | --- |
| charging-power/realistic-thermal-foldback-bundle | 控制器通信出现超时或重试。 针对问题“Why did charge current fall even though USB-C remained attached?”，引用的日志提供了相关线索。 | 0.00 | miss | 0.00 | deterministic rubric: root-cause coverage 0.00, actions coverage 0.00, category missed |

## Review template

Score each case on the same 0..1 rubric the judge uses (root-cause coverage of the
expert annotation). `humanCategoryMatch` and `notes` are optional but valuable.

```yaml
runId: qe-20261118-125223
reviewer: <your-name>
reviewedAt: <YYYY-MM-DD>
cases:
  - id: charging-power/realistic-thermal-foldback-bundle
    humanRootCauseScore: # 0..1 (judge said 0.00)
    humanCategoryMatch: # true/false (judge said false)
    notes: ""
```


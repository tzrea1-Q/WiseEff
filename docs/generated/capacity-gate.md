## M6.6 Capacity Gate Evidence

- Date: 2026-06-04T11:03:57.132Z
- Status: `failed`
- Target URL: `http://127.0.0.1:8787`
- Environment: `self-hosted-target`
- Profile: `pilot-smoke`
- Duration: `2m`
- Virtual users: `10`
- Safe writes enabled: `false`

### Threshold Results

| Metric | Observed | Threshold |
| --- | --- | --- |
| p95 latency | pending | <= 750ms |
| error rate | pending | <= 0.01 |
| throughput | pending | >= 5 rps |
| CPU utilization | pending | <= 80% |
| memory utilization | pending | <= 85% |
| database connections | pending | <= 40 |
| queue backlog | pending | <= 25 |
| object-store probe | pending | required |

### Artifacts

- k6 summary: `test-results/capacity/k6-summary.json`
- metrics snapshot: `test-results/capacity/metrics-snapshot.json`

### Blockers

- Target URL must be a non-local http(s) URL for capacity evidence.

### Pending Evidence

- p95 latency evidence is pending.
- error rate evidence is pending.
- throughput evidence is pending.
- CPU utilization evidence is pending.
- memory utilization evidence is pending.
- database connection evidence is pending.
- queue backlog evidence is pending.
- object-store probe evidence is pending.

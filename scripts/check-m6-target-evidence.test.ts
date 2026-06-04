import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  evaluateM6TargetEvidence,
  renderM6TargetEvidenceMarkdown,
  type M6TargetEvidenceInput
} from "./check-m6-target-evidence";

const activePlans = [
  "2026-06-02-wiseeff-m6-2-identity-user-governance.md",
  "2026-06-02-wiseeff-m6-3-self-hosted-storage-backup.md",
  "2026-06-02-wiseeff-m6-4-durable-queue.md",
  "2026-06-02-wiseeff-m6-5-observability-operations.md",
  "2026-06-02-wiseeff-m6-6-release-rollback-capacity-gate.md"
];

const targetEvidence: M6TargetEvidenceInput["evidence"] = {
  identity: `## M6.2 Identity Evidence

- Status: \`passed\`
- Evidence scope: \`target self-hosted OIDC\`
- Issuer: \`https://id.example.test/realms/wiseeff\`
- API base URL: \`https://wiseeff-target.example.test\`
- Audience: \`wiseeff-api\`

### Checks

| Check | Status | HTTP | Detail |
| --- | --- | --- | --- |
| OIDC discovery/JWKS | passed | 200 | issuer and jwks_uri discovered; signing keys=1 |
| /api/v1/me | passed | 200 | admin context returned |
| wrong issuer | passed | 401 | rejected |
| wrong audience | passed | 401 | rejected |
| expired token | passed | 401 | rejected |
| browser token acquisition/refresh/logout | passed | n/a | target browser runtime evidence recorded |
`,
  localIdentity: `## M6.2 Identity Evidence

- Status: \`passed\`
- Evidence scope: \`local OIDC implementation drill\`
`,
  backupRestore: `# M6 Backup Restore Evidence

Status: \`passed\`

- Missing fields: _none_
- Unsafe fields: _none_
- Validation errors: _none_

## Summary

- Environment: \`target-non-customer\`
- Object checksum validated: \`true\`
- Database table counts validated: \`true\`
- Missing log objects: \`0\`
- Queue: \`polling\` / \`skipped\`
- Queue snapshot: \`n/a\`
- Queue checkpoint validated: \`false\`

## Restore targets:

- \`postgres://wiseeff_restore@localhost:5432/wiseeff_restore\`
- \`s3://wiseeff-restore/m6-drill/\`
`,
  queue: `## M6.4 Durable Queue Readiness Evidence

- Status: \`passed\`
- Base URL: \`https://wiseeff-target.example.test\`

### Result

- Detail: Durable queue transport and PostgreSQL job state are ready.

### Ready Body Summary

\`\`\`json
{
  "dependencies": {
    "durableQueue": {
      "ok": true,
      "status": "ready",
      "transport": {
        "ok": true,
        "status": "ready"
      },
      "database": {
        "ok": true,
        "status": "ready"
      }
    }
  }
}
\`\`\`
`,
  observability: `## M6.5 Observability Evidence

- Status: \`passed\`
- Evidence scope: \`target self-hosted observability\`
- Target environment: \`self-hosted-staging\`
- Config check: \`passed\`
- Prometheus target scrape: \`passed\`
- Alertmanager routing: \`passed\`
- Grafana dashboard import: \`passed\`

### Proof

- Prometheus query or scrape evidence: \`up{job="wiseeff-api"} == 1\`
- Alert route proof: \`ops-evidence/alertmanager-route-2026-06-04.md\`
- Grafana dashboard proof: \`ops-evidence/grafana-dashboard-2026-06-04.png\`
`,
  rollback: `## M6.6 Rollback Rehearsal Evidence

- Status: \`passed\`
- Environment: \`self-hosted-target\`
- Release version: \`v0.1.0\`
- Candidate artifact: \`registry.local/wiseeff:abc123\`
- Previous artifact: \`registry.local/wiseeff:previous\`
- Approval owner: \`ops-lead\`
- Maintenance window: \`2026-06-04T20:00:00Z/2026-06-04T20:30:00Z\`

### Rollback Steps

| Step | Status |
| --- | --- |
| stop writes | passed |
| queue drain | passed |
| artifact rollback | passed |
| database restore | skipped_by_scope |
| object-store restore | skipped_by_scope |
| post-rollback smoke | passed |

### Artifacts

- Backup/restore evidence: \`docs/generated/m6-backup-restore-evidence.md\`
- Post-rollback smoke evidence: \`ops-evidence/post-rollback-smoke.md\`
- Queue evidence: \`docs/generated/m6-queue-readiness-evidence.md\`
- Notes: \`ops-evidence/rollback-notes.md\`
`,
  capacity: `## M6.6 Capacity Gate Evidence

- Status: \`passed\`
- Target URL: \`https://wiseeff-target.example.test\`
- Environment: \`self-hosted-target\`
- Profile: \`pilot-smoke\`
- Duration: \`2m\`
- Virtual users: \`10\`
- Safe writes enabled: \`false\`

### Threshold Results

| Metric | Observed | Threshold |
| --- | --- | --- |
| p95 latency | 320ms | <= 750ms |
| error rate | 0 | <= 0.01 |
| throughput | 12 rps | >= 5 rps |
| CPU utilization | 45% | <= 80% |
| memory utilization | 62% | <= 85% |
| database connections | 12 | <= 40 |
| queue backlog | 0 | <= 25 |
| object-store probe | passed | required |

### Artifacts

- k6 summary: \`test-results/capacity/k6-summary.json\`
- metrics snapshot: \`test-results/capacity/metrics-snapshot.json\`
`,
  release: `## M6.6 Self-Hosted Release Gate Evidence

- Status: \`passed\`
- Branch: \`codex/m6-target-evidence-closure\`
- Commit: \`abcdef1234567890\`
- Version: \`v0.1.0\`
- Dirty worktree: \`false\`
- Target environment: \`self-hosted-target\`
- Artifact: \`registry.local/wiseeff:abc123\`
- Environment fingerprint: \`sha256:abcdef\`
- Synthetic acceptance mode: \`target-non-hdc\`
- HDC status: \`skipped_by_scope\`
- HDC evidence: \`n/a\`

### Migration Set

- \`0011_m6_user_governance.sql\`

### Evidence Paths

- Backup evidence: \`docs/generated/m6-backup-restore-evidence.md\`
- Identity evidence: \`docs/generated/m6-identity-evidence.md\`
- Rollback plan: \`docs/runbooks/release-rollback.md\`
- Rollback rehearsal: \`docs/generated/m6-rollback-rehearsal-evidence.md\`
- Target synthetic acceptance: \`docs/generated/acceptance-browser-evidence.md\`
- Capacity gate: \`docs/generated/capacity-gate.md\`
- Queue evidence: \`docs/generated/m6-queue-readiness-evidence.md\`
- Observability evidence: \`docs/generated/m6-observability-evidence.md\`

### Command Gates

| Command | Status | Detail |
| --- | --- | --- |
| docs:check | passed | ok |
| contract:check | passed | ok |
| test:all | passed | ok |
| build | passed | ok |
| acceptance:coverage | passed | ok |
| acceptance:operations | passed | ok |
| acceptance:evidence | passed | ok |
| selfhost:check | passed | ok |
| identity:check | passed | ok |
| git diff --check | passed | ok |

| Dependency | Status |
| --- | --- |
| self-hosted config | passed |
| backup/restore | passed |
| identity readiness | passed |
| rollback readiness | passed |
| capacity readiness | passed |
| target synthetic readiness | passed |
| queue readiness | passed |
| observability | passed |
`
};

describe("M6 target evidence completion gate", () => {
  it("keeps local OIDC evidence separate from target identity readiness", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        identity: `## M6.2 Identity Evidence

- Status: \`failed\`
- Evidence scope: \`target self-hosted OIDC\`
`,
        localIdentity: `## M6.2 Identity Evidence

- Status: \`passed\`
- Evidence scope: \`local OIDC implementation drill (temporary issuer/JWKS; not target Keycloak evidence)\`
`
      }
    });

    const identity = result.phases.find((phase) => phase.id === "M6.2");

    expect(result.status).toBe("failed");
    expect(identity).toMatchObject({
      evidenceStatus: "pending",
      planLocation: "active",
      completionAllowed: false
    });
    expect(identity?.pending).toContain("Target OIDC identity evidence is pending.");
    expect(identity?.notes).toContain("Local OIDC drill is present but does not satisfy target identity readiness.");
  });

  it("does not accept target identity evidence without required target OIDC checks", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        identity: `## M6.2 Identity Evidence

- Status: \`passed\`
- Evidence scope: \`target self-hosted OIDC\`
`
      }
    });

    const identity = result.phases.find((phase) => phase.id === "M6.2");

    expect(identity).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(identity?.pending).toContain("Target OIDC identity evidence is pending.");
  });

  it("does not accept local API URLs as target identity evidence", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        identity: `## M6.2 Identity Evidence

- Status: \`passed\`
- Evidence scope: \`target self-hosted OIDC\`
- Issuer: \`https://id.example.test/realms/wiseeff\`
- API base URL: \`http://127.0.0.1:8787\`
- Audience: \`wiseeff-api\`

### Checks

| Check | Status | HTTP | Detail |
| --- | --- | --- | --- |
| OIDC discovery/JWKS | passed | 200 | issuer and jwks_uri discovered; signing keys=1 |
| /api/v1/me | passed | 200 | admin context returned |
| wrong issuer | passed | 401 | rejected |
| wrong audience | passed | 401 | rejected |
| expired token | passed | 401 | rejected |
| browser token acquisition/refresh/logout | passed | n/a | target browser runtime evidence recorded |
`
      }
    });

    const identity = result.phases.find((phase) => phase.id === "M6.2");

    expect(identity).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(identity?.pending).toContain("Target OIDC identity evidence is pending.");
  });

  it("blocks a plan moved to completed before target evidence passes", () => {
    const result = evaluateM6TargetEvidence({
      activePlans: activePlans.filter((plan) => !plan.includes("m6-3")),
      completedPlans: ["2026-06-02-wiseeff-m6-3-self-hosted-storage-backup.md"],
      evidence: {
        ...targetEvidence,
        backupRestore: `# M6 Backup Restore Evidence

Status: \`passed\`

- Environment: \`local-non-customer\`
`
      }
    });

    const backup = result.phases.find((phase) => phase.id === "M6.3");

    expect(result.status).toBe("failed");
    expect(backup?.blockers).toContain("M6.3 plan is in completed before target evidence passed.");
    expect(backup?.pending).toContain("Target backup/restore evidence is pending.");
  });

  it("does not accept backup restore evidence without validation summaries and restore targets", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        backupRestore: `# M6 Backup Restore Evidence

Status: \`passed\`

- Environment: \`target-non-customer\`
`
      }
    });

    const backup = result.phases.find((phase) => phase.id === "M6.3");

    expect(backup).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(backup?.pending).toContain("Target backup/restore evidence is pending.");
  });

  it("does not accept backup restore evidence with failed object or database validation", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        backupRestore: `# M6 Backup Restore Evidence

Status: \`passed\`

- Missing fields: _none_
- Unsafe fields: _none_
- Validation errors: _none_

## Summary

- Environment: \`target-non-customer\`
- Object checksum validated: \`false\`
- Database table counts validated: \`true\`
- Missing log objects: \`0\`
- Queue: \`polling\` / \`skipped\`
- Queue snapshot: \`n/a\`
- Queue checkpoint validated: \`false\`

## Restore targets:

- \`postgres://wiseeff_restore@localhost:5432/wiseeff_restore\`
- \`s3://wiseeff-restore/m6-drill/\`
`
      }
    });

    const backup = result.phases.find((phase) => phase.id === "M6.3");

    expect(backup).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(backup?.pending).toContain("Target backup/restore evidence is pending.");
  });

  it("does not accept durable queue evidence without ready-body transport and database proof", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        queue: `## M6.4 Durable Queue Readiness Evidence

- Status: \`passed\`
- Base URL: \`https://wiseeff-target.example.test\`
`
      }
    });

    const queue = result.phases.find((phase) => phase.id === "M6.4");

    expect(queue).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(queue?.pending).toContain("Target durable queue evidence is pending.");
  });

  it("does not accept wildcard or IPv6 loopback URLs as target evidence", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        queue: targetEvidence.queue?.replace(
          "- Base URL: `https://wiseeff-target.example.test`",
          "- Base URL: `http://[::1]:8787`"
        ),
        capacity: targetEvidence.capacity?.replace(
          "- Target URL: `https://wiseeff-target.example.test`",
          "- Target URL: `http://0.0.0.0:8787`"
        )
      }
    });

    const queue = result.phases.find((phase) => phase.id === "M6.4");
    const release = result.phases.find((phase) => phase.id === "M6.6");

    expect(queue).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(release).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(queue?.pending).toContain("Target durable queue evidence is pending.");
    expect(release?.pending).toContain("Target release, rollback, capacity, and synthetic acceptance evidence is pending.");
  });

  it("does not accept durable queue evidence when transport or database is not ready", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        queue: `## M6.4 Durable Queue Readiness Evidence

- Status: \`passed\`
- Base URL: \`https://wiseeff-target.example.test\`

### Result

- Detail: Durable queue transport and PostgreSQL job state are ready.

### Ready Body Summary

\`\`\`json
{
  "dependencies": {
    "durableQueue": {
      "ok": true,
      "status": "ready",
      "transport": {
        "ok": false,
        "status": "failed"
      },
      "database": {
        "ok": true,
        "status": "ready"
      }
    }
  }
}
\`\`\`
`
      }
    });

    const queue = result.phases.find((phase) => phase.id === "M6.4");

    expect(queue).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(queue?.pending).toContain("Target durable queue evidence is pending.");
  });

  it("passes only when every M6.2-M6.6 phase has target evidence and completed plans", () => {
    const result = evaluateM6TargetEvidence({
      activePlans: [],
      completedPlans: activePlans,
      evidence: targetEvidence
    });

    expect(result).toMatchObject({
      status: "passed",
      blockers: [],
      pending: []
    });
    expect(result.phases.every((phase) => phase.completionAllowed && phase.planLocation === "completed")).toBe(true);
  });

  it("does not accept observability target evidence without scope, config, and proof references", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        observability: `## M6.5 Observability Evidence

- Status: \`passed\`
- Prometheus target scrape: \`passed\`
- Alertmanager routing: \`passed\`
- Grafana dashboard import: \`passed\`
`
      }
    });

    const observability = result.phases.find((phase) => phase.id === "M6.5");

    expect(result.status).toBe("failed");
    expect(observability).toMatchObject({
      evidenceStatus: "pending",
      planLocation: "active",
      completionAllowed: false
    });
    expect(observability?.pending).toContain(
      "Target observability scrape, alert routing, and dashboard evidence is pending."
    );
  });

  it("does not accept placeholder observability target environment labels", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        observability: `## M6.5 Observability Evidence

- Status: \`passed\`
- Evidence scope: \`target self-hosted observability\`
- Target environment: \`target-not-configured\`
- Config check: \`passed\`
- Prometheus target scrape: \`passed\`
- Alertmanager routing: \`passed\`
- Grafana dashboard import: \`passed\`

### Proof

- Prometheus query or scrape evidence: \`up{job="wiseeff-api"} == 1\`
- Alert route proof: \`ops-evidence/alertmanager-route-2026-06-04.md\`
- Grafana dashboard proof: \`ops-evidence/grafana-dashboard-2026-06-04.png\`
`
      }
    });

    const observability = result.phases.find((phase) => phase.id === "M6.5");

    expect(observability).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(observability?.pending).toContain(
      "Target observability scrape, alert routing, and dashboard evidence is pending."
    );
  });

  it("does not accept rollback evidence without required rehearsal steps and artifact references", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        rollback: `## M6.6 Rollback Rehearsal Evidence

- Status: \`passed\`
`
      }
    });

    const release = result.phases.find((phase) => phase.id === "M6.6");

    expect(release).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(release?.pending).toContain("Target release, rollback, capacity, and synthetic acceptance evidence is pending.");
  });

  it("does not accept capacity evidence with pending target metrics", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        capacity: `## M6.6 Capacity Gate Evidence

- Status: \`passed\`
- Target URL: \`https://wiseeff-target.example.test\`
- Environment: \`self-hosted-target\`

### Threshold Results

| Metric | Observed | Threshold |
| --- | --- | --- |
| p95 latency | pending | <= 750ms |
| error rate | 0 | <= 0.01 |
| throughput | 12 rps | >= 5 rps |
| CPU utilization | 45% | <= 80% |
| memory utilization | 62% | <= 85% |
| database connections | 12 | <= 40 |
| queue backlog | 0 | <= 25 |
| object-store probe | passed | required |
`
      }
    });

    const release = result.phases.find((phase) => phase.id === "M6.6");

    expect(release).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(release?.pending).toContain("Target release, rollback, capacity, and synthetic acceptance evidence is pending.");
  });

  it("does not accept release evidence without command gates and target evidence paths", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        release: `## M6.6 Self-Hosted Release Gate Evidence

- Status: \`passed\`
- Target environment: \`self-hosted-target\`

| Dependency | Status |
| --- | --- |
| self-hosted config | passed |
| backup/restore | passed |
| identity readiness | passed |
| rollback readiness | passed |
| capacity readiness | passed |
| target synthetic readiness | passed |
| queue readiness | passed |
| observability | passed |
`
      }
    });

    const release = result.phases.find((phase) => phase.id === "M6.6");

    expect(release).toMatchObject({
      evidenceStatus: "pending",
      completionAllowed: false
    });
    expect(release?.pending).toContain("Target release, rollback, capacity, and synthetic acceptance evidence is pending.");
  });

  it("renders a redacted operator summary", () => {
    const result = evaluateM6TargetEvidence({
      activePlans,
      completedPlans: [],
      evidence: {
        ...targetEvidence,
        queue: `## M6.4 Durable Queue Readiness Evidence

- Status: \`passed\`
- Base URL: \`https://wiseeff-target.example.test?token=secret\`
`
      }
    });
    const markdown = renderM6TargetEvidenceMarkdown({
      date: "2026-06-04T00:00:00.000Z",
      result
    });

    expect(markdown).toContain("## M6 Target Evidence Summary");
    expect(markdown).toContain("| M6.2 | passed | active | yes |");
    expect(markdown).toContain("token=<redacted>");
    expect(markdown).not.toContain("token=secret");
  });

  it("exposes the M6 target evidence gate as a package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "m6:target-evidence": "tsx scripts/check-m6-target-evidence.ts"
    });
  });
});

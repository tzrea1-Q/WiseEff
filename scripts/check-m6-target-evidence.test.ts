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
`,
  localIdentity: `## M6.2 Identity Evidence

- Status: \`passed\`
- Evidence scope: \`local OIDC implementation drill\`
`,
  backupRestore: `# M6 Backup Restore Evidence

Status: \`passed\`

- Environment: \`target-non-customer\`
`,
  queue: `## M6.4 Durable Queue Readiness Evidence

- Status: \`passed\`
- Base URL: \`https://wiseeff-target.example.test\`
`,
  observability: `## M6.5 Observability Evidence

- Status: \`passed\`
- Prometheus target scrape: \`passed\`
- Alertmanager routing: \`passed\`
- Grafana dashboard import: \`passed\`
`,
  rollback: `## M6.6 Rollback Rehearsal Evidence

- Status: \`passed\`
`,
  capacity: `## M6.6 Capacity Gate Evidence

- Status: \`passed\`
`,
  release: `## M6.6 Self-Hosted Release Gate Evidence

- Status: \`passed\`

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

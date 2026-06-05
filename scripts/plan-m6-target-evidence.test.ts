import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildM6TargetEvidencePlan,
  loadM6TargetEvidencePlanEnv,
  renderM6TargetEvidencePlanMarkdown
} from "./plan-m6-target-evidence";

describe("M6 target evidence execution plan", () => {
  it("orders M6.2 through M6.6 target evidence commands with audit-ready evidence paths", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "https://wiseeff.example.test?token=secret",
        AUTH_OIDC_ISSUER: "https://id.example.test/realms/wiseeff",
        AUTH_OIDC_AUDIENCE: "wiseeff-api",
        M6_IDENTITY_AUTHORIZATION: "Bearer abc.def.ghi",
        M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION: "Bearer wrong.issuer.token",
        M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION: "Bearer wrong.audience.token",
        M6_IDENTITY_EXPIRED_AUTHORIZATION: "Bearer expired.token",
        M6_IDENTITY_USER_GOVERNANCE_EVIDENCE: "passed",
        RESTORE_DATABASE_URL: "postgres://restore.example.test/wiseeff_restore",
        RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
        RESTORE_OBJECT_STORAGE_PREFIX: "m6-restore/",
        BACKUP_DATABASE_TARGET: "file:///var/backups/wiseeff/postgres/wiseeff.dump",
        BACKUP_OBJECT_STORAGE_TARGET: "file:///var/backups/wiseeff/object-store/",
        REDIS_URL: "redis://redis.internal:6379",
        BACKUP_REDIS_SNAPSHOT_TARGET: "file:///var/backups/wiseeff/redis.rdb",
        BACKUP_REDIS_CHECKPOINT_VALIDATED: "true",
        M6_SELFHOSTED_SMOKE_AUTHORIZATION: "Bearer smoke.token",
        M6_IDENTITY_BROWSER_RUNTIME: "passed",
        M6_OBSERVABILITY_TARGET_ENVIRONMENT: "self-hosted-staging",
        M6_OBSERVABILITY_CONFIG_STATUS: "passed",
        M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE: "passed",
        M6_OBSERVABILITY_ALERTMANAGER_ROUTING: "passed",
        M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT: "passed",
        M6_OBSERVABILITY_PROMETHEUS_QUERY: "prometheus://wiseeff-up",
        M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE: "alertmanager://route/wiseeff-ready",
        M6_OBSERVABILITY_GRAFANA_EVIDENCE: "grafana://dashboards/wiseeff-overview",
        WISEEFF_CAPACITY_TARGET_URL: "https://wiseeff.example.test",
        WISEEFF_CAPACITY_AUTHORIZATION: "Bearer capacity.token",
        M6_TARGET_CAPACITY_OBSERVED_P95_MS: "420",
        M6_TARGET_CAPACITY_OBSERVED_ERROR_RATE: "0",
        M6_TARGET_CAPACITY_OBSERVED_RPS: "9",
        M6_TARGET_CAPACITY_OBSERVED_CPU: "42",
        M6_TARGET_CAPACITY_OBSERVED_MEMORY: "51",
        M6_TARGET_CAPACITY_OBSERVED_DB_CONNECTIONS: "12",
        M6_TARGET_CAPACITY_OBSERVED_QUEUE_BACKLOG: "0",
        M6_TARGET_CAPACITY_OBJECT_STORE_PROBE: "passed",
        M6_TARGET_ROLLBACK_ENVIRONMENT: "self-hosted-staging",
        M6_TARGET_ROLLBACK_RELEASE_VERSION: "m6.6-rc.1",
        M6_TARGET_ROLLBACK_CANDIDATE_ARTIFACT: "registry.local/wiseeff:candidate",
        M6_TARGET_ROLLBACK_PREVIOUS_ARTIFACT: "registry.local/wiseeff:stable",
        M6_TARGET_ROLLBACK_APPROVAL_OWNER: "ops-admin",
        M6_TARGET_ROLLBACK_MAINTENANCE_WINDOW: "2026-06-04T10:00:00Z/2026-06-04T11:00:00Z",
        M6_TARGET_ROLLBACK_STOP_WRITES: "passed",
        M6_TARGET_ROLLBACK_QUEUE_DRAIN: "passed",
        M6_TARGET_ROLLBACK_ARTIFACT_ROLLBACK: "passed",
        M6_TARGET_ROLLBACK_DATABASE_RESTORE: "passed",
        M6_TARGET_ROLLBACK_OBJECT_STORE_RESTORE: "passed",
        M6_TARGET_ROLLBACK_POST_ROLLBACK_SMOKE: "passed",
        M6_TARGET_ROLLBACK_BACKUP_EVIDENCE: "docs/generated/m6-backup-restore-evidence.md",
        M6_TARGET_ROLLBACK_SMOKE_EVIDENCE: "docs/generated/selfhost-smoke.md",
        M6_TARGET_ROLLBACK_NOTES: "docs/generated/rollback-notes.md",
        M6_TARGET_SYNTHETIC_EVIDENCE_PATH: "docs/generated/acceptance-browser-evidence.md",
        M6_TARGET_RELEASE_ENVIRONMENT: "self-hosted-staging",
        M6_TARGET_RELEASE_ARTIFACT_REF: "registry.local/wiseeff:m6.6-rc.1",
        M6_TARGET_RELEASE_ENV_FINGERPRINT: "sha256:target-env",
        M6_TARGET_RELEASE_IDENTITY_READINESS: "passed",
        M6_TARGET_RELEASE_BACKUP_RESTORE_READINESS: "passed",
        M6_TARGET_RELEASE_ROLLBACK_READINESS: "passed",
        M6_TARGET_RELEASE_CAPACITY_READINESS: "passed",
        M6_TARGET_RELEASE_SYNTHETIC_READINESS: "passed",
        M6_TARGET_RELEASE_QUEUE_READINESS: "passed",
        M6_TARGET_RELEASE_OBSERVABILITY_READINESS: "passed",
        M6_TARGET_RELEASE_CAPACITY_EVIDENCE_PATH: "docs/generated/capacity-gate.md",
        M6_TARGET_RELEASE_QUEUE_EVIDENCE_PATH: "docs/generated/m6-queue-readiness-evidence.md",
        M6_TARGET_RELEASE_OBSERVABILITY_EVIDENCE_PATH: "docs/generated/m6-observability-evidence.md"
      }
    });

    expect(plan.status).toBe("ready");
    expect(plan.steps.map((step) => step.phase)).toEqual(["M6.2", "M6.3", "M6.4", "M6.5", "M6.6"]);
    expect(plan.steps[0].commands).toContain("npm run identity:check");
    expect(plan.steps[1].commands).toEqual(["npm run restore:drill", "npm run backup:drill", "npm run backup:check"]);
    expect(plan.steps[1].requiredInputs).toEqual(
      expect.arrayContaining([
        "REDIS_URL",
        "BACKUP_REDIS_SNAPSHOT_TARGET",
        "BACKUP_REDIS_CHECKPOINT_VALIDATED=true"
      ])
    );
    expect(plan.steps[2].commands).toContain("npm run queue:check -- --base-url https://wiseeff.example.test");
    expect(plan.steps[3].commands).toEqual([
      "npm run observability:check",
      "npm run observability:target-evidence"
    ]);
    expect(plan.steps[4].commands).toContain("npm run m6:target-evidence");
    expect(plan.steps[4].commands.join("\n")).toContain('--authorization "Bearer capacity.token"');
    expect(plan.steps[4].commands.join("\n")).toContain("--observed-p95-ms 420");
    expect(plan.steps[4].commands.join("\n")).toContain('--release-version "m6.6-rc.1"');
    expect(plan.steps[4].commands.join("\n")).toContain('--candidate-artifact "registry.local/wiseeff:candidate"');
    expect(plan.steps[4].commands.join("\n")).toContain("--database-restore passed");
    expect(plan.steps[4].commands.join("\n")).toContain("--object-store-restore passed");
    expect(plan.steps[4].commands.join("\n")).toContain('--backup-evidence "docs/generated/m6-backup-restore-evidence.md"');
    expect(plan.steps[4].commands.join("\n")).toContain('--target-synthetic-evidence "docs/generated/acceptance-browser-evidence.md"');
    expect(plan.steps[4].commands.join("\n")).toContain("--identity-readiness passed");
    expect(plan.steps[4].commands.join("\n")).toContain('--capacity-evidence "docs/generated/capacity-gate.md"');
    expect(plan.steps.flatMap((step) => step.evidencePaths)).toEqual(
      expect.arrayContaining([
        "docs/generated/m6-identity-evidence.md",
        "docs/generated/m6-backup-restore-evidence.md",
        "docs/generated/m6-queue-readiness-evidence.md",
        "docs/generated/m6-observability-config-evidence.md",
        "docs/generated/m6-observability-evidence.md",
        "docs/generated/m6-rollback-rehearsal-evidence.md",
        "docs/generated/capacity-gate.md",
        "docs/generated/m6-release-readiness.md",
        "docs/generated/m6-target-evidence-summary.md"
      ])
    );
  });

  it("blocks target-looking plans until every execution proof input is configured", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "https://wiseeff.example.test",
        AUTH_OIDC_ISSUER: "https://id.example.test/realms/wiseeff",
        AUTH_OIDC_AUDIENCE: "wiseeff-api",
        M6_IDENTITY_AUTHORIZATION: "Bearer abc.def.ghi",
        M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION: "Bearer wrong.issuer.token",
        M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION: "Bearer wrong.audience.token",
        M6_IDENTITY_EXPIRED_AUTHORIZATION: "Bearer expired.token",
        RESTORE_DATABASE_URL: "postgres://restore.example.test/wiseeff_restore",
        RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
        RESTORE_OBJECT_STORAGE_PREFIX: "m6-restore/",
        WISEEFF_CAPACITY_TARGET_URL: "https://wiseeff.example.test"
      }
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "M6.2 requires M6_IDENTITY_USER_GOVERNANCE_EVIDENCE=passed.",
        "M6.2 requires M6_IDENTITY_BROWSER_RUNTIME=passed.",
        "M6.3 missing BACKUP_DATABASE_TARGET.",
        "M6.3 missing BACKUP_OBJECT_STORAGE_TARGET.",
        "M6.3 missing REDIS_URL.",
        "M6.3 missing BACKUP_REDIS_SNAPSHOT_TARGET.",
        "M6.3 requires BACKUP_REDIS_CHECKPOINT_VALIDATED=true.",
        "M6.4 missing M6_SELFHOSTED_SMOKE_AUTHORIZATION or WISEEFF_SMOKE_AUTHORIZATION.",
        "M6.5 requires M6_OBSERVABILITY_TARGET_ENVIRONMENT.",
        "M6.5 requires M6_OBSERVABILITY_CONFIG_STATUS=passed.",
        "M6.5 requires M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE=passed.",
        "M6.5 requires M6_OBSERVABILITY_ALERTMANAGER_ROUTING=passed.",
        "M6.5 requires M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT=passed.",
        "M6.5 missing M6_OBSERVABILITY_PROMETHEUS_QUERY.",
        "M6.5 missing M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE.",
        "M6.5 missing M6_OBSERVABILITY_GRAFANA_EVIDENCE."
      ])
    );
  });

  it("requires target user-governance operation evidence for M6.2 execution readiness", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "https://wiseeff.example.test",
        AUTH_OIDC_ISSUER: "https://id.example.test/realms/wiseeff",
        AUTH_OIDC_AUDIENCE: "wiseeff-api",
        M6_IDENTITY_AUTHORIZATION: "Bearer abc.def.ghi",
        M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION: "Bearer wrong.issuer.token",
        M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION: "Bearer wrong.audience.token",
        M6_IDENTITY_EXPIRED_AUTHORIZATION: "Bearer expired.token",
        M6_IDENTITY_BROWSER_RUNTIME: "passed"
      }
    });
    const identityStep = plan.steps.find((step) => step.phase === "M6.2");

    expect(plan.blockers).toContain("M6.2 requires M6_IDENTITY_USER_GOVERNANCE_EVIDENCE=passed.");
    expect(identityStep?.requiredInputs).toContain(
      "M6_IDENTITY_USER_GOVERNANCE_EVIDENCE=passed after target PERM-USER-MGMT-001 UI/API/DB/audit proof"
    );
    expect(identityStep?.commands).toEqual(
      expect.arrayContaining([
        "npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime",
        "npm run acceptance:evidence"
      ])
    );
    expect(identityStep?.evidencePaths).toEqual(
      expect.arrayContaining([
        "docs/generated/acceptance-operation-evidence.md",
        "docs/generated/acceptance-operation-evidence/index.json"
      ])
    );
    expect(identityStep?.successCriteria).toContain(
      "PERM-USER-MGMT-001 records target UI, API, DB, and audit evidence for Admin mutation and non-Admin rejection."
    );
  });

  it("blocks M6.6 until release rollback capacity and synthetic inputs are executable", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "https://wiseeff.example.test",
        AUTH_OIDC_ISSUER: "https://id.example.test/realms/wiseeff",
        AUTH_OIDC_AUDIENCE: "wiseeff-api",
        M6_IDENTITY_AUTHORIZATION: "Bearer abc.def.ghi",
        M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION: "Bearer wrong.issuer.token",
        M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION: "Bearer wrong.audience.token",
        M6_IDENTITY_EXPIRED_AUTHORIZATION: "Bearer expired.token",
        M6_IDENTITY_BROWSER_RUNTIME: "passed",
        M6_IDENTITY_USER_GOVERNANCE_EVIDENCE: "passed",
        RESTORE_DATABASE_URL: "postgres://restore.example.test/wiseeff_restore",
        RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
        RESTORE_OBJECT_STORAGE_PREFIX: "m6-restore/",
        BACKUP_DATABASE_TARGET: "file:///var/backups/wiseeff/postgres/wiseeff.dump",
        BACKUP_OBJECT_STORAGE_TARGET: "file:///var/backups/wiseeff/object-store/",
        REDIS_URL: "redis://redis.internal:6379",
        BACKUP_REDIS_SNAPSHOT_TARGET: "file:///var/backups/wiseeff/redis.rdb",
        BACKUP_REDIS_CHECKPOINT_VALIDATED: "true",
        M6_SELFHOSTED_SMOKE_AUTHORIZATION: "Bearer smoke.token",
        M6_OBSERVABILITY_TARGET_ENVIRONMENT: "self-hosted-staging",
        M6_OBSERVABILITY_CONFIG_STATUS: "passed",
        M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE: "passed",
        M6_OBSERVABILITY_ALERTMANAGER_ROUTING: "passed",
        M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT: "passed",
        M6_OBSERVABILITY_PROMETHEUS_QUERY: "prometheus://wiseeff-up",
        M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE: "alertmanager://route/wiseeff-ready",
        M6_OBSERVABILITY_GRAFANA_EVIDENCE: "grafana://dashboards/wiseeff-overview",
        WISEEFF_CAPACITY_TARGET_URL: "https://wiseeff.example.test"
      }
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "M6.6 missing WISEEFF_CAPACITY_AUTHORIZATION.",
        "M6.6 missing M6_TARGET_CAPACITY_OBSERVED_P95_MS.",
        "M6.6 missing M6_TARGET_CAPACITY_OBSERVED_ERROR_RATE.",
        "M6.6 missing M6_TARGET_CAPACITY_OBSERVED_RPS.",
        "M6.6 missing M6_TARGET_CAPACITY_OBSERVED_CPU.",
        "M6.6 missing M6_TARGET_CAPACITY_OBSERVED_MEMORY.",
        "M6.6 missing M6_TARGET_CAPACITY_OBSERVED_DB_CONNECTIONS.",
        "M6.6 missing M6_TARGET_CAPACITY_OBSERVED_QUEUE_BACKLOG.",
        "M6.6 requires M6_TARGET_CAPACITY_OBJECT_STORE_PROBE=passed.",
        "M6.6 requires M6_TARGET_ROLLBACK_ENVIRONMENT to identify a target, staging, pilot, or self-hosted environment.",
        "M6.6 missing M6_TARGET_ROLLBACK_RELEASE_VERSION.",
        "M6.6 missing M6_TARGET_ROLLBACK_CANDIDATE_ARTIFACT.",
        "M6.6 missing M6_TARGET_ROLLBACK_PREVIOUS_ARTIFACT.",
        "M6.6 missing M6_TARGET_ROLLBACK_APPROVAL_OWNER.",
        "M6.6 missing M6_TARGET_ROLLBACK_MAINTENANCE_WINDOW.",
        "M6.6 requires M6_TARGET_ROLLBACK_STOP_WRITES=passed.",
        "M6.6 requires M6_TARGET_ROLLBACK_QUEUE_DRAIN=passed.",
        "M6.6 requires M6_TARGET_ROLLBACK_ARTIFACT_ROLLBACK=passed.",
        "M6.6 requires M6_TARGET_ROLLBACK_DATABASE_RESTORE=passed.",
        "M6.6 requires M6_TARGET_ROLLBACK_OBJECT_STORE_RESTORE=passed.",
        "M6.6 requires M6_TARGET_ROLLBACK_POST_ROLLBACK_SMOKE=passed.",
        "M6.6 missing M6_TARGET_ROLLBACK_BACKUP_EVIDENCE.",
        "M6.6 missing M6_TARGET_ROLLBACK_SMOKE_EVIDENCE.",
        "M6.6 missing M6_TARGET_ROLLBACK_NOTES.",
        "M6.6 missing M6_TARGET_SYNTHETIC_EVIDENCE_PATH.",
        "M6.6 requires M6_TARGET_RELEASE_ENVIRONMENT to identify a target, staging, pilot, or self-hosted environment.",
        "M6.6 missing M6_TARGET_RELEASE_ARTIFACT_REF.",
        "M6.6 missing M6_TARGET_RELEASE_ENV_FINGERPRINT.",
        "M6.6 requires M6_TARGET_RELEASE_IDENTITY_READINESS=passed.",
        "M6.6 requires M6_TARGET_RELEASE_BACKUP_RESTORE_READINESS=passed.",
        "M6.6 requires M6_TARGET_RELEASE_ROLLBACK_READINESS=passed.",
        "M6.6 requires M6_TARGET_RELEASE_CAPACITY_READINESS=passed.",
        "M6.6 requires M6_TARGET_RELEASE_SYNTHETIC_READINESS=passed.",
        "M6.6 requires M6_TARGET_RELEASE_QUEUE_READINESS=passed.",
        "M6.6 requires M6_TARGET_RELEASE_OBSERVABILITY_READINESS=passed.",
        "M6.6 missing M6_TARGET_RELEASE_CAPACITY_EVIDENCE_PATH.",
        "M6.6 missing M6_TARGET_RELEASE_QUEUE_EVIDENCE_PATH.",
        "M6.6 missing M6_TARGET_RELEASE_OBSERVABILITY_EVIDENCE_PATH."
      ])
    );
  });

  it("keeps local evidence separate from target evidence and reports missing target inputs", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        AUTH_OIDC_ISSUER: "",
        AUTH_OIDC_AUDIENCE: "",
        M6_IDENTITY_AUTHORIZATION: "",
        RESTORE_DATABASE_URL: "",
        RESTORE_OBJECT_STORAGE_BUCKET: "",
        RESTORE_OBJECT_STORAGE_PREFIX: ""
      }
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "M6.2 missing AUTH_OIDC_ISSUER.",
        "M6.2 missing AUTH_OIDC_AUDIENCE.",
        "M6.2 missing M6_IDENTITY_AUTHORIZATION.",
        "M6.3 missing RESTORE_DATABASE_URL.",
        "M6.3 missing RESTORE_OBJECT_STORAGE_BUCKET.",
        "M6.3 missing RESTORE_OBJECT_STORAGE_PREFIX.",
        "M6.4 requires a non-local WISEEFF_API_BASE_URL or --base-url target.",
        "M6.6 missing WISEEFF_CAPACITY_TARGET_URL or WISEEFF_API_BASE_URL."
      ])
    );
    expect(plan.steps[0].evidencePaths).not.toContain("docs/generated/m6-local-oidc-identity-evidence.md");
    expect(plan.steps[0].notes).toContain(
      "docs/generated/m6-local-oidc-identity-evidence.md is local implementation proof only and is not accepted as target evidence."
    );
  });

  it("does not accept wildcard or IPv6 loopback URLs as target execution endpoints", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "http://0.0.0.0:8787",
        WISEEFF_CAPACITY_TARGET_URL: "http://[::1]:8787"
      }
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "M6.4 requires a non-local WISEEFF_API_BASE_URL or --base-url target.",
        "M6.6 missing WISEEFF_CAPACITY_TARGET_URL or WISEEFF_API_BASE_URL."
      ])
    );
  });

  it("renders placeholders instead of local URLs in blocked target commands", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        VITE_WISEEFF_API_BASE_URL: "http://localhost:5173"
      }
    });
    const commands = plan.steps.flatMap((step) => step.commands).join("\n");

    expect(plan.status).toBe("blocked");
    expect(commands).toContain("npm run queue:check -- --base-url <target-url>");
    expect(commands).toContain('npm run capacity:gate -- --target-url "<target-url>"');
    expect(commands).not.toContain("127.0.0.1");
    expect(commands).not.toContain("localhost");
  });

  it("renders a redacted operator runbook", () => {
    const plan = buildM6TargetEvidencePlan({
      env: {
        WISEEFF_API_BASE_URL: "https://wiseeff.example.test?token=secret",
        VITE_WISEEFF_API_BASE_URL:
          "https://wiseeff.example.test?access_token=browser-token&refresh_token=refresh-secret&id_token=id-secret",
        AUTH_OIDC_ISSUER: "https://id.example.test/realms/wiseeff?client_secret=abc123",
        AUTH_OIDC_AUDIENCE: "wiseeff-api",
        M6_IDENTITY_AUTHORIZATION: "Bearer abc.def.ghi",
        M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION: "Bearer wrong.issuer.token",
        M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION: "Bearer wrong.audience.token",
        M6_IDENTITY_EXPIRED_AUTHORIZATION: "Bearer expired.token",
        RESTORE_DATABASE_URL: "postgres://wiseeff:db-secret@restore.example.test/wiseeff_restore",
        RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
        RESTORE_OBJECT_STORAGE_PREFIX: "m6-restore/",
        BACKUP_DATABASE_TARGET: "postgres://backup.example.test/wiseeff?aws_access_key_id=aws-key-id",
        BACKUP_OBJECT_STORAGE_TARGET: "s3://wiseeff-backup/m6?access_key=minio-key&private_key=minio-private",
        REDIS_URL: "redis://redis.internal:6379?password=redis-secret",
        BACKUP_REDIS_SNAPSHOT_TARGET: "file:///var/backups/wiseeff/redis.rdb?token=redis-snapshot-secret",
        BACKUP_REDIS_CHECKPOINT_VALIDATED: "true",
        M6_SELFHOSTED_SMOKE_AUTHORIZATION: "Bearer smoke.secret",
        M6_IDENTITY_BROWSER_RUNTIME: "passed",
        M6_IDENTITY_USER_GOVERNANCE_EVIDENCE: "passed",
        M6_OBSERVABILITY_TARGET_ENVIRONMENT: "self-hosted-staging",
        M6_OBSERVABILITY_CONFIG_STATUS: "passed",
        M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE: "passed",
        M6_OBSERVABILITY_ALERTMANAGER_ROUTING: "passed",
        M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT: "passed",
        M6_OBSERVABILITY_PROMETHEUS_QUERY: "https://prometheus.example.test?token=prom-secret",
        M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE: "https://alertmanager.example.test?api_key=alert-secret",
        M6_OBSERVABILITY_GRAFANA_EVIDENCE: "https://grafana.example.test/d/wiseeff?token=grafana-secret",
        WISEEFF_CAPACITY_TARGET_URL: "https://wiseeff.example.test?api_key=plain&accessKeyId=camel-key-id",
        WISEEFF_CAPACITY_AUTHORIZATION: "Bearer capacity.secret",
        M6_TARGET_CAPACITY_OBSERVED_P95_MS: "420",
        M6_TARGET_CAPACITY_OBSERVED_ERROR_RATE: "0",
        M6_TARGET_CAPACITY_OBSERVED_RPS: "9",
        M6_TARGET_CAPACITY_OBSERVED_CPU: "42",
        M6_TARGET_CAPACITY_OBSERVED_MEMORY: "51",
        M6_TARGET_CAPACITY_OBSERVED_DB_CONNECTIONS: "12",
        M6_TARGET_CAPACITY_OBSERVED_QUEUE_BACKLOG: "0",
        M6_TARGET_CAPACITY_OBJECT_STORE_PROBE: "passed",
        M6_TARGET_ROLLBACK_ENVIRONMENT: "self-hosted-staging",
        M6_TARGET_ROLLBACK_RELEASE_VERSION: "m6.6-rc.1",
        M6_TARGET_ROLLBACK_CANDIDATE_ARTIFACT: "registry.local/wiseeff:candidate?token=rollback-candidate-secret",
        M6_TARGET_ROLLBACK_PREVIOUS_ARTIFACT: "registry.local/wiseeff:stable?token=rollback-previous-secret",
        M6_TARGET_ROLLBACK_APPROVAL_OWNER: "ops-admin",
        M6_TARGET_ROLLBACK_MAINTENANCE_WINDOW: "2026-06-04T10:00:00Z/2026-06-04T11:00:00Z",
        M6_TARGET_ROLLBACK_STOP_WRITES: "passed",
        M6_TARGET_ROLLBACK_QUEUE_DRAIN: "passed",
        M6_TARGET_ROLLBACK_ARTIFACT_ROLLBACK: "passed",
        M6_TARGET_ROLLBACK_DATABASE_RESTORE: "passed",
        M6_TARGET_ROLLBACK_OBJECT_STORE_RESTORE: "passed",
        M6_TARGET_ROLLBACK_POST_ROLLBACK_SMOKE: "passed",
        M6_TARGET_ROLLBACK_BACKUP_EVIDENCE: "https://evidence.example.test/backup?token=backup-evidence-secret",
        M6_TARGET_ROLLBACK_SMOKE_EVIDENCE: "https://evidence.example.test/smoke?token=smoke-evidence-secret",
        M6_TARGET_ROLLBACK_NOTES: "https://evidence.example.test/rollback?token=rollback-notes-secret",
        M6_TARGET_SYNTHETIC_EVIDENCE_PATH: "https://evidence.example.test/synthetic?token=synthetic-secret",
        M6_TARGET_RELEASE_ENVIRONMENT: "self-hosted-staging",
        M6_TARGET_RELEASE_ARTIFACT_REF: "registry.local/wiseeff:m6.6-rc.1?token=release-artifact-secret",
        M6_TARGET_RELEASE_ENV_FINGERPRINT: "sha256:target-env",
        M6_TARGET_RELEASE_IDENTITY_READINESS: "passed",
        M6_TARGET_RELEASE_BACKUP_RESTORE_READINESS: "passed",
        M6_TARGET_RELEASE_ROLLBACK_READINESS: "passed",
        M6_TARGET_RELEASE_CAPACITY_READINESS: "passed",
        M6_TARGET_RELEASE_SYNTHETIC_READINESS: "passed",
        M6_TARGET_RELEASE_QUEUE_READINESS: "passed",
        M6_TARGET_RELEASE_OBSERVABILITY_READINESS: "passed",
        M6_TARGET_RELEASE_CAPACITY_EVIDENCE_PATH: "https://evidence.example.test/capacity?token=capacity-evidence-secret",
        M6_TARGET_RELEASE_QUEUE_EVIDENCE_PATH: "https://evidence.example.test/queue?token=queue-evidence-secret",
        M6_TARGET_RELEASE_OBSERVABILITY_EVIDENCE_PATH: "https://evidence.example.test/observability?token=observability-evidence-secret"
      }
    });
    const markdown = renderM6TargetEvidencePlanMarkdown({
      date: "2026-06-04T00:00:00.000Z",
      plan
    });

    expect(markdown).toContain("## M6 Target Evidence Execution Plan");
    expect(markdown).toContain("Status: `ready`");
    expect(markdown).toContain("token=<redacted>");
    expect(markdown).toContain("client_secret=<redacted>");
    expect(markdown).toContain("api_key=<redacted>");
    expect(markdown).toContain("access_token=<redacted>");
    expect(markdown).toContain("refresh_token=<redacted>");
    expect(markdown).toContain("id_token=<redacted>");
    expect(markdown).toContain("access_key=<redacted>");
    expect(markdown).toContain("private_key=<redacted>");
    expect(markdown).toContain("aws_access_key_id=<redacted>");
    expect(markdown).toContain("accessKeyId=<redacted>");
    expect(markdown).toContain('registry.local/wiseeff:candidate?token=<redacted>"');
    expect(markdown).toContain('https://evidence.example.test/rollback?token=<redacted>"');
    expect(markdown).not.toContain("abc.def.ghi");
    expect(markdown).not.toContain("plain");
    expect(markdown).not.toContain("db-secret");
    expect(markdown).not.toContain("browser-token");
    expect(markdown).not.toContain("refresh-secret");
    expect(markdown).not.toContain("id-secret");
    expect(markdown).not.toContain("minio-key");
    expect(markdown).not.toContain("minio-private");
    expect(markdown).not.toContain("aws-key-id");
    expect(markdown).not.toContain("camel-key-id");
    expect(markdown).not.toContain("redis-secret");
    expect(markdown).not.toContain("redis-snapshot-secret");
    expect(markdown).not.toContain("smoke.secret");
    expect(markdown).not.toContain("prom-secret");
    expect(markdown).not.toContain("alert-secret");
    expect(markdown).not.toContain("grafana-secret");
    expect(markdown).not.toContain("capacity.secret");
    expect(markdown).not.toContain("rollback-candidate-secret");
    expect(markdown).not.toContain("rollback-previous-secret");
    expect(markdown).not.toContain("backup-evidence-secret");
    expect(markdown).not.toContain("smoke-evidence-secret");
    expect(markdown).not.toContain("rollback-notes-secret");
    expect(markdown).not.toContain("synthetic-secret");
    expect(markdown).not.toContain("release-artifact-secret");
    expect(markdown).not.toContain("capacity-evidence-secret");
    expect(markdown).not.toContain("queue-evidence-secret");
    expect(markdown).not.toContain("observability-evidence-secret");
    expect(markdown).toContain("postgres://<redacted>@restore.example.test/wiseeff_restore");
    expect(markdown).not.toContain("secret`");
  });

  it("exposes the target evidence plan as a package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "m6:target-plan": "tsx -- scripts/plan-m6-target-evidence.ts"
    });
  });

  it("loads target inputs from an env file without leaking process secrets into the plan", () => {
    const env = loadM6TargetEvidencePlanEnv({
      args: ["--env-file", "target.env"],
      processEnv: {
        WISEEFF_API_BASE_URL: "https://process.example.test",
        SHOULD_NOT_COPY: "secret"
      },
      readFile: (filePath) => {
        expect(filePath).toBe("target.env");
        return [
          "WISEEFF_API_BASE_URL=https://target.example.test",
          "AUTH_OIDC_ISSUER=https://id.example.test/realms/wiseeff",
          "AUTH_OIDC_AUDIENCE=wiseeff-api",
          "M6_IDENTITY_AUTHORIZATION=Bearer from.file",
          "RESTORE_DATABASE_URL=postgres://restore.example.test/wiseeff_restore",
          "RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore",
          "RESTORE_OBJECT_STORAGE_PREFIX=m6-restore/"
        ].join("\n");
      },
      exists: () => true
    });

    expect(env.WISEEFF_API_BASE_URL).toBe("https://target.example.test");
    expect(env.SHOULD_NOT_COPY).toBeUndefined();
  });

  it("treats a positional env filename as the target evidence env file", () => {
    const env = loadM6TargetEvidencePlanEnv({
      args: ["target.env"],
      processEnv: {
        WISEEFF_API_BASE_URL: "https://process.example.test"
      },
      readFile: (filePath) => {
        expect(filePath).toBe("target.env");
        return "WISEEFF_API_BASE_URL=https://target.example.test";
      },
      exists: (filePath) => filePath === "target.env"
    });

    expect(env.WISEEFF_API_BASE_URL).toBe("https://target.example.test");
  });

  it("accepts target-env-file as a runtime-safe alias for env file loading", () => {
    const env = loadM6TargetEvidencePlanEnv({
      args: ["--target-env-file=target.env"],
      processEnv: {
        WISEEFF_API_BASE_URL: "https://process.example.test"
      },
      readFile: (filePath) => {
        expect(filePath).toBe("target.env");
        return "WISEEFF_API_BASE_URL=https://target.example.test";
      },
      exists: (filePath) => filePath === "target.env"
    });

    expect(env.WISEEFF_API_BASE_URL).toBe("https://target.example.test");
  });
});

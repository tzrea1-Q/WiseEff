import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateBackupDrillEvidence, redactBackupDrillEvidence, renderBackupDrillMarkdown } from "./check-backup-drill";

describe("M6.3 backup drill evidence checker", () => {
  it("passes complete self-hosted PostgreSQL, object-store, and conditional Redis evidence", () => {
    const result = evaluateBackupDrillEvidence({
      providerDecision: {
        selectedProvider: "rustfs",
        decisionRecordPath: "ops/self-hosted/storage/provider-decision.md"
      },
      environment: {
        label: "local-non-customer",
        branch: "codex/m6-3-self-hosted-storage-backup",
        commit: "abc123"
      },
      objectStore: {
        endpoint: "https://storage.example.test",
        bucket: "wiseeff-backup",
        healthPrefix: "wiseeff-health/",
        tlsPolicy: "required",
        pathStyle: true,
        backupTarget: "file:///backups/wiseeff/objects",
        restoreTarget: "s3://wiseeff-restore/m6-restore/",
        objectCount: 12,
        checksumValidated: true
      },
      database: {
        backupCommand: "pg_dump --format=custom",
        backupTarget: "file:///backups/wiseeff/postgres.dump",
        restoreTarget: "postgres://wiseeff_restore@localhost:5432/wiseeff_restore",
        tableCountsValidated: true
      },
      queue: {
        status: "conditional",
        reason: "Redis durable queue is introduced in M6.4."
      },
      restore: {
        startedAt: "2026-06-02T00:00:00.000Z",
        completedAt: "2026-06-02T00:10:00.000Z",
        isolatedTargets: ["postgres://wiseeff_restore@localhost:5432/wiseeff_restore", "s3://wiseeff-restore/m6-restore/"],
        sampledLogReferences: 5,
        missingLogObjects: 0
      },
      redaction: {
        checked: true,
        secretsRedacted: true
      }
    });

    expect(result).toEqual({
      status: "passed",
      missingFields: [],
      unsafeFields: [],
      validationErrors: []
    });
  });

  it("fails when provider decision, backup targets, restore targets, or redaction proof are missing", () => {
    const result = evaluateBackupDrillEvidence({
      providerDecision: {
        selectedProvider: "",
        decisionRecordPath: ""
      },
      environment: {
        label: "target",
        branch: "codex/m6-3",
        commit: "abc123"
      },
      objectStore: {
        endpoint: "not-a-url",
        bucket: "",
        healthPrefix: "",
        tlsPolicy: "optional",
        pathStyle: true,
        backupTarget: "",
        restoreTarget: "s3://live-production/wiseeff/",
        objectCount: 0,
        checksumValidated: false
      },
      database: {
        backupCommand: "",
        backupTarget: "",
        restoreTarget: "postgres://wiseeff@localhost:5432/wiseeff",
        tableCountsValidated: false
      },
      queue: {
        status: "failed"
      },
      restore: {
        startedAt: "",
        completedAt: "",
        isolatedTargets: [],
        sampledLogReferences: 1,
        missingLogObjects: 1
      },
      redaction: {
        checked: false,
        secretsRedacted: false
      }
    });

    expect(result.status).toBe("failed");
    expect(result.missingFields).toEqual(
      expect.arrayContaining([
        "providerDecision.selectedProvider",
        "providerDecision.decisionRecordPath",
        "objectStore.bucket",
        "objectStore.healthPrefix",
        "objectStore.backupTarget",
        "database.backupCommand",
        "database.backupTarget",
        "restore.startedAt",
        "restore.completedAt",
        "restore.isolatedTargets"
      ])
    );
    expect(result.unsafeFields).toEqual(
      expect.arrayContaining([
        "objectStore.restoreTarget",
        "database.restoreTarget"
      ])
    );
    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        "objectStore.endpoint must be a valid http(s) URL.",
        "objectStore.checksumValidated must be true.",
        "database.tableCountsValidated must be true.",
        "restore.missingLogObjects must be 0.",
        "redaction.checked must be true.",
        "redaction.secretsRedacted must be true.",
        "queue.reason is required when queue.status is conditional or failed."
      ])
    );
  });

  it("redacts credentials and signed URLs before writing evidence", () => {
    const redacted = redactBackupDrillEvidence({
      objectStore: {
        endpoint: "https://key:secret@storage.example.test?X-Amz-Signature=abc123",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "super-secret"
      },
      database: {
        restoreTarget: "postgres://wiseeff:secret@localhost:5432/wiseeff_restore"
      },
      notes: "Authorization: Bearer token123 password=hidden"
    });

    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(JSON.stringify(redacted)).not.toContain("token123");
    expect(JSON.stringify(redacted)).not.toContain("password=hidden");
    expect(JSON.stringify(redacted)).not.toContain("X-Amz-Signature=abc123");
    expect(JSON.stringify(redacted)).toContain("[redacted]");
  });

  it("fails when a recorded backup or restore command exits non-zero", () => {
    const result = evaluateBackupDrillEvidence({
      providerDecision: {
        selectedProvider: "rustfs",
        decisionRecordPath: "ops/self-hosted/storage/provider-decision.md"
      },
      environment: {
        label: "target-non-customer",
        branch: "codex/m6-3-self-hosted-storage-backup",
        commit: "abc123"
      },
      objectStore: {
        endpoint: "https://storage.example.test",
        bucket: "wiseeff-prod",
        healthPrefix: ".health/",
        tlsPolicy: "required",
        pathStyle: true,
        backupTarget: "file:///backups/wiseeff/objects",
        restoreTarget: "s3://wiseeff-restore/m6-restore/",
        objectCount: 12,
        checksumValidated: true
      },
      database: {
        backupCommand: "pg_dump --format=custom",
        backupTarget: "file:///backups/wiseeff/postgres.dump",
        restoreTarget: "postgres://wiseeff_restore@localhost:5432/wiseeff_restore",
        tableCountsValidated: true
      },
      queue: {
        status: "conditional",
        reason: "Redis durable queue is introduced in M6.4."
      },
      restore: {
        startedAt: "2026-06-02T00:00:00.000Z",
        completedAt: "2026-06-02T00:10:00.000Z",
        isolatedTargets: ["postgres://wiseeff_restore@localhost:5432/wiseeff_restore", "s3://wiseeff-restore/m6-restore/"],
        sampledLogReferences: 5,
        missingLogObjects: 0
      },
      redaction: {
        checked: true,
        secretsRedacted: true
      },
      commands: [
        { name: "database-backup", command: "pg_dump --format=custom", exitCode: 0 },
        { name: "object-store-backup", command: "s3-export", exitCode: 2 }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.validationErrors).toContain("commands.object-store-backup exited with 2.");
  });

  it("renders a human-readable evidence summary", () => {
    const markdown = renderBackupDrillMarkdown({
      status: "passed",
      missingFields: [],
      unsafeFields: [],
      validationErrors: []
    });

    expect(markdown).toContain("# M6 Backup Restore Evidence");
    expect(markdown).toContain("Status: `passed`");
  });

  it("renders provider, environment, and isolated restore target details when evidence is supplied", () => {
    const markdown = renderBackupDrillMarkdown(
      {
        status: "passed",
        missingFields: [],
        unsafeFields: [],
        validationErrors: []
      },
      {
        providerDecision: {
          selectedProvider: "rustfs",
          decisionRecordPath: "ops/self-hosted/storage/provider-decision.md"
        },
        environment: {
          label: "local-non-customer",
          branch: "codex/m6-3",
          commit: "abc123"
        },
        objectStore: {
          endpoint: "https://storage.example.test",
          bucket: "wiseeff-prod",
          healthPrefix: ".health/",
          tlsPolicy: "required",
          pathStyle: true,
          backupTarget: "file:///backups/objects",
          restoreTarget: "s3://wiseeff-restore/m6-drill/",
          objectCount: 0,
          checksumValidated: true
        },
        database: {
          backupCommand: "pg_dump --format=custom",
          backupTarget: "file:///backups/db.dump",
          restoreTarget: "postgres://wiseeff_restore@localhost:5432/wiseeff_restore",
          tableCountsValidated: true
        },
        queue: {
          status: "conditional",
          reason: "Redis durable queue is introduced in M6.4."
        },
        restore: {
          startedAt: "2026-06-02T00:00:00.000Z",
          completedAt: "2026-06-02T00:10:00.000Z",
          isolatedTargets: ["postgres://wiseeff_restore@localhost:5432/wiseeff_restore", "s3://wiseeff-restore/m6-drill/"],
          sampledLogReferences: 0,
          missingLogObjects: 0
        },
        redaction: {
          checked: true,
          secretsRedacted: true
        }
      }
    );

    expect(markdown).toContain("Provider: `rustfs`");
    expect(markdown).toContain("Environment: `local-non-customer`");
    expect(markdown).toContain("Restore targets:");
    expect(markdown).toContain("s3://wiseeff-restore/m6-drill/");
    expect(markdown).toContain("Queue: `conditional`");
  });

  it("requires package scripts for backup, restore, and evidence checks", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "backup:drill": "tsx scripts/run-backup-drill.ts",
      "restore:drill": "tsx scripts/run-restore-drill.ts",
      "backup:check": "tsx scripts/check-backup-drill.ts"
    });
  });
});

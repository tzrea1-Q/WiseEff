import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBackupDrillEvidence, buildBackupDrillEvidenceFromEnv, parseBackupDrillArgs, writeBackupDrillEvidence } from "./run-backup-drill";

describe("M6.3 backup drill runner helpers", () => {
  it("builds redacted evidence with command exit statuses and polling queue status", () => {
    const evidence = buildBackupDrillEvidence({
      providerDecisionPath: "ops/self-hosted/storage/provider-decision.md",
      selectedProvider: "rustfs",
      environmentLabel: "local-drill",
      branch: "codex/m6-3",
      commit: "abc123",
      objectStoreEndpoint: "https://key:secret@storage.example.test?X-Amz-Signature=abc",
      objectStoreBucket: "wiseeff-prod",
      objectStoreHealthPrefix: ".health/",
      objectStoreBackupTarget: "file:///backups/objects",
      objectStoreRestoreTarget: "s3://wiseeff-restore/m6-drill/",
      databaseBackupCommand: "pg_dump --format=custom",
      databaseBackupTarget: "file:///backups/db.dump",
      databaseRestoreTarget: "postgres://wiseeff_restore:secret@localhost:5432/wiseeff_restore",
      commandResults: [
        { name: "database-backup", command: "pg_dump --format=custom", exitCode: 0 },
        { name: "object-store-backup", command: "s3-export", exitCode: 0 }
      ],
      redisAvailable: false
    });

    expect(evidence.queue).toEqual({
      mode: "polling",
      status: "conditional",
      reason: "Redis durable queue is not enabled for this drill."
    });
    expect(evidence.commands).toEqual([
      { name: "database-backup", command: "pg_dump --format=custom", exitCode: 0 },
      { name: "object-store-backup", command: "s3-export", exitCode: 0 }
    ]);
    expect(JSON.stringify(evidence)).not.toContain("key:secret");
    expect(JSON.stringify(evidence)).not.toContain(":secret@");
    expect(JSON.stringify(evidence)).not.toContain("X-Amz-Signature=abc");
  });

  it("builds durable queue evidence with Redis persistence metadata", () => {
    const evidence = buildBackupDrillEvidence({
      providerDecisionPath: "ops/self-hosted/storage/provider-decision.md",
      selectedProvider: "rustfs",
      environmentLabel: "target-drill",
      branch: "codex/m6-3",
      commit: "abc123",
      objectStoreEndpoint: "https://storage.example.test",
      objectStoreBucket: "wiseeff-prod",
      objectStoreHealthPrefix: ".health/",
      objectStoreBackupTarget: "file:///backups/objects",
      objectStoreRestoreTarget: "s3://wiseeff-restore/m6-drill/",
      databaseBackupCommand: "pg_dump --format=custom",
      databaseBackupTarget: "file:///backups/db.dump",
      databaseRestoreTarget: "postgres://wiseeff_restore@localhost:5432/wiseeff_restore",
      commandResults: [],
      redisAvailable: true,
      redisSnapshotTarget: "file:///backups/wiseeff/redis.rdb",
      redisCheckpointValidated: true
    });

    expect(evidence.queue).toEqual({
      mode: "durable",
      status: "captured",
      persistence: {
        snapshotTarget: "file:///backups/wiseeff/redis.rdb",
        checkpointValidated: true
      }
    });
  });

  it("writes JSON and Markdown evidence artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-backup-drill-"));
    try {
      const paths = writeBackupDrillEvidence({
        outputDir: root,
        evidence: buildBackupDrillEvidence({
          providerDecisionPath: "ops/self-hosted/storage/provider-decision.md",
          selectedProvider: "rustfs",
          environmentLabel: "local-drill",
          branch: "codex/m6-3",
          commit: "abc123",
          objectStoreEndpoint: "https://storage.example.test",
          objectStoreBucket: "wiseeff-prod",
          objectStoreHealthPrefix: ".health/",
          objectStoreBackupTarget: "file:///backups/objects",
          objectStoreRestoreTarget: "s3://wiseeff-restore/m6-drill/",
          databaseBackupCommand: "pg_dump --format=custom",
          databaseBackupTarget: "file:///backups/db.dump",
          databaseRestoreTarget: "postgres://wiseeff_restore@localhost:5432/wiseeff_restore",
          commandResults: [],
          redisAvailable: false
        })
      });

      expect(readFileSync(paths.jsonPath, "utf8")).toContain("\"providerDecision\"");
      expect(readFileSync(paths.markdownPath, "utf8")).toContain("# M6 Backup Restore Evidence");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads backup drill evidence inputs from dotenv content without shell source", () => {
    const evidence = buildBackupDrillEvidenceFromEnv({
      OBJECT_STORAGE_PROVIDER: "s3-compatible",
      BACKUP_DRILL_ENVIRONMENT: "wsl-lab",
      GIT_BRANCH: "codex/m6",
      GIT_COMMIT: "abc123",
      OBJECT_STORAGE_ENDPOINT: "http://minio:9000",
      OBJECT_STORAGE_BUCKET: "wiseeff-prod",
      OBJECT_STORAGE_HEALTH_PREFIX: ".health/",
      BACKUP_OBJECT_STORAGE_TARGET: "file:///backups/objects",
      RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
      RESTORE_OBJECT_STORAGE_PREFIX: "m6-drill/",
      BACKUP_DATABASE_COMMAND: "pg_dump --format=custom",
      BACKUP_DATABASE_TARGET: "file:///backups/db.dump",
      RESTORE_DATABASE_URL: "postgres://wiseeff_restore:secret@postgres:5432/wiseeff_restore",
      REDIS_URL: "redis://redis:6379",
      BACKUP_REDIS_SNAPSHOT_TARGET: "file:///backups/redis.rdb",
      BACKUP_REDIS_CHECKPOINT_VALIDATED: "true",
      M6_SELFHOSTED_SMOKE_AUTHORIZATION: "Bearer token with spaces"
    });

    expect(evidence).toMatchObject({
      environment: {
        label: "wsl-lab"
      },
      objectStore: {
        endpoint: "http://minio:9000",
        restoreTarget: "s3://wiseeff-restore/m6-drill/"
      }
    });
    expect(evidence.queue).toEqual({
      mode: "durable",
      status: "captured",
      persistence: {
        snapshotTarget: "file:///backups/redis.rdb",
        checkpointValidated: true
      }
    });
    expect(JSON.stringify(evidence)).not.toContain("Bearer token with spaces");
  });

  it("supports target-env-file aliases that do not conflict with Node flags", () => {
    const fileSystem = {
      existsSync: (filePath: string) => filePath === "target.env",
      readFileSync: () =>
        [
          "OBJECT_STORAGE_ENDPOINT=http://minio:9000",
          "OBJECT_STORAGE_BUCKET=wiseeff-prod",
          "BACKUP_DATABASE_TARGET=file:///backups/db.dump",
          "M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer token with spaces"
        ].join("\n")
    };

    expect(
      parseBackupDrillArgs(["--target-env-file=target.env"], {
        fileSystem,
        processEnv: {}
      })
    ).toMatchObject({
      OBJECT_STORAGE_ENDPOINT: "http://minio:9000"
    });
    expect(
      parseBackupDrillArgs([], {
        fileSystem,
        processEnv: { npm_config_target_env_file: "target.env" }
      })
    ).toMatchObject({
      OBJECT_STORAGE_BUCKET: "wiseeff-prod"
    });
    expect(
      parseBackupDrillArgs(["target.env"], {
        fileSystem,
        processEnv: { npm_config_target_env_file: "true" }
      })
    ).toMatchObject({
      M6_SELFHOSTED_SMOKE_AUTHORIZATION: "Bearer token with spaces"
    });
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBackupDrillEvidence, writeBackupDrillEvidence } from "./run-backup-drill";

describe("M6.3 backup drill runner helpers", () => {
  it("builds redacted evidence with command exit statuses and conditional Redis status", () => {
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
      status: "conditional",
      reason: "Redis durable queue is introduced in M6.4."
    });
    expect(evidence.commands).toEqual([
      { name: "database-backup", command: "pg_dump --format=custom", exitCode: 0 },
      { name: "object-store-backup", command: "s3-export", exitCode: 0 }
    ]);
    expect(JSON.stringify(evidence)).not.toContain("key:secret");
    expect(JSON.stringify(evidence)).not.toContain(":secret@");
    expect(JSON.stringify(evidence)).not.toContain("X-Amz-Signature=abc");
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
});

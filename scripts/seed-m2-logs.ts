import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const organizationId = "org-chargelab";
const projectId = "aurora";
const seedUserId = "u-xu-yun";
const completedLogId = "log-aurora-charging-foldback";
const completedFileObjectId = "log-file-aurora-charging-foldback";
const completedRunId = "run-aurora-charging-foldback";
const completedReportId = "report-aurora-charging-foldback";
const completedJobId = "job-aurora-charging-foldback";
const failedLogId = "log-aurora-unsupported";
const failedFileObjectId = "log-file-aurora-unsupported";

function checksum(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function seedM2Logs(db: Database): Promise<void> {
  const fixturePath = path.join(root, "test-fixtures", "logs", "charging-foldback.log");
  const unsupportedPath = path.join(root, "test-fixtures", "logs", "unsupported.bin");
  const logBytes = await readFile(fixturePath);
  const unsupportedBytes = await readFile(unsupportedPath);
  const rawLines = logBytes.toString("utf8").trimEnd().split(/\r?\n/);
  const logChecksum = checksum(logBytes);
  const unsupportedChecksum = checksum(unsupportedBytes);

  await db.transaction(async (tx) => {
    await tx.query(
      `
      insert into log_file_objects (
        id,
        organization_id,
        project_id,
        storage_key,
        file_name,
        content_type,
        file_size_bytes,
        checksum_sha256,
        uploaded_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (id) do update set
        storage_key = excluded.storage_key,
        file_name = excluded.file_name,
        content_type = excluded.content_type,
        file_size_bytes = excluded.file_size_bytes,
        checksum_sha256 = excluded.checksum_sha256,
        uploaded_by_user_id = excluded.uploaded_by_user_id
      `,
      [
        completedFileObjectId,
        organizationId,
        projectId,
        `${organizationId}/${logChecksum}-charging-foldback.log`,
        "charging-foldback.log",
        "text/plain",
        logBytes.byteLength,
        logChecksum,
        seedUserId
      ]
    );

    await tx.query(
      `
      insert into log_file_objects (
        id,
        organization_id,
        project_id,
        storage_key,
        file_name,
        content_type,
        file_size_bytes,
        checksum_sha256,
        uploaded_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (id) do update set
        storage_key = excluded.storage_key,
        file_name = excluded.file_name,
        content_type = excluded.content_type,
        file_size_bytes = excluded.file_size_bytes,
        checksum_sha256 = excluded.checksum_sha256,
        uploaded_by_user_id = excluded.uploaded_by_user_id
      `,
      [
        failedFileObjectId,
        organizationId,
        projectId,
        `${organizationId}/${unsupportedChecksum}-unsupported.bin`,
        "unsupported.bin",
        "application/octet-stream",
        unsupportedBytes.byteLength,
        unsupportedChecksum,
        seedUserId
      ]
    );

    await tx.query(
      `
      insert into log_records (
        id,
        organization_id,
        project_id,
        file_object_id,
        file_name,
        source,
        status,
        archive_state,
        analysis_question,
        related_parameter_id,
        submitted_by_user_id,
        captured_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, 'upload', 'complete', 'active', $6, $7, $8, $9, $9)
      on conflict (id) do update set
        file_object_id = excluded.file_object_id,
        file_name = excluded.file_name,
        source = excluded.source,
        status = excluded.status,
        archive_state = excluded.archive_state,
        analysis_question = excluded.analysis_question,
        related_parameter_id = excluded.related_parameter_id,
        submitted_by_user_id = excluded.submitted_by_user_id,
        failure_reason = null,
        updated_at = excluded.updated_at
      `,
      [
        completedLogId,
        organizationId,
        projectId,
        completedFileObjectId,
        "charging-foldback.log",
        "Why did fast charging fold back?",
        "aurora-fast-charge-current",
        seedUserId,
        "2026-05-25T10:03:29.500Z"
      ]
    );

    await tx.query(
      `
      insert into log_analysis_runs (
        id,
        organization_id,
        log_record_id,
        status,
        current_stage,
        progress,
        started_at,
        completed_at,
        updated_at
      )
      values ($1, $2, $3, 'complete', 'report', 100, $4, $5, $5)
      on conflict (id) do update set
        log_record_id = excluded.log_record_id,
        status = excluded.status,
        current_stage = excluded.current_stage,
        progress = excluded.progress,
        error_message = null,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
      `,
      [completedRunId, organizationId, completedLogId, "2026-05-25T10:03:30.000Z", "2026-05-25T10:03:34.000Z"]
    );

    await tx.query(
      `
      update log_records
      set current_run_id = $1,
        updated_at = $2
      where id = $3
      `,
      [completedRunId, "2026-05-25T10:03:34.000Z", completedLogId]
    );

    for (const [stage, progress, message] of [
      ["parse", 25, "Parsed 5 log lines."],
      ["pattern", 50, "Detected thermal warning and current derate pattern."],
      ["rootcause", 80, "Correlated warnings with BMS thermal foldback error."],
      ["report", 100, "Generated charging foldback report."]
    ] as const) {
      await tx.query(
        `
        insert into log_analysis_stages (
          id,
          organization_id,
          run_id,
          stage,
          status,
          progress,
          message,
          started_at,
          completed_at
        )
        values ($1, $2, $3, $4, 'complete', $5, $6, $7, $8)
        on conflict (run_id, stage) do update set
          status = excluded.status,
          progress = excluded.progress,
          message = excluded.message,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at
        `,
        [
          `${completedRunId}-${stage}`,
          organizationId,
          completedRunId,
          stage,
          progress,
          message,
          "2026-05-25T10:03:30.000Z",
          "2026-05-25T10:03:34.000Z"
        ]
      );
    }

    await tx.query(
      `
      insert into log_analysis_reports (
        id,
        organization_id,
        log_record_id,
        run_id,
        confidence,
        conclusion,
        impact,
        severity,
        suggested_actions,
        raw_lines
      )
      values ($1, $2, $3, $4, 0.91, $5, $6, 'Warning', $7::jsonb, $8::jsonb)
      on conflict (id) do update set
        confidence = excluded.confidence,
        conclusion = excluded.conclusion,
        impact = excluded.impact,
        severity = excluded.severity,
        suggested_actions = excluded.suggested_actions,
        raw_lines = excluded.raw_lines
      `,
      [
        completedReportId,
        organizationId,
        completedLogId,
        completedRunId,
        "Fast charge current was reduced by thermal foldback protection.",
        "Charging remains stable, but the pack exceeded the fast-charge thermal threshold.",
        JSON.stringify([
          "Inspect pack cooling airflow before the next fast-charge validation.",
          "Review battery temperature threshold calibration.",
          "Compare requested and actual charge current during thermal ramps."
        ]),
        JSON.stringify(rawLines)
      ]
    );

    await tx.query(
      `
      insert into log_evidence (
        id,
        organization_id,
        log_record_id,
        run_id,
        stage,
        line_numbers,
        inference,
        suggested_action,
        rule_hit
      )
      values ($1, $2, $3, $4, 'rootcause', $5, $6, $7, $8)
      on conflict (id) do update set
        stage = excluded.stage,
        line_numbers = excluded.line_numbers,
        inference = excluded.inference,
        suggested_action = excluded.suggested_action,
        rule_hit = excluded.rule_hit
      `,
      [
        "evidence-aurora-thermal-foldback",
        organizationId,
        completedLogId,
        completedRunId,
        [2, 3, 4],
        "Battery temperature crossed threshold, requested current was derated, and BMS emitted E_THERMAL_FOLDBACK.",
        "Validate thermal limits and cooling before increasing charge current.",
        "thermal_foldback"
      ]
    );

    await tx.query(
      `
      insert into jobs (
        id,
        organization_id,
        kind,
        target_type,
        target_id,
        status,
        progress,
        current_stage,
        updated_at
      )
      values ($1, $2, 'log-analysis', 'log-analysis-run', $3, 'complete', 100, 'report', $4)
      on conflict (id) do update set
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        status = excluded.status,
        progress = excluded.progress,
        current_stage = excluded.current_stage,
        error_message = null,
        updated_at = excluded.updated_at
      `,
      [completedJobId, organizationId, completedRunId, "2026-05-25T10:03:34.000Z"]
    );

    await tx.query(
      `
      insert into log_records (
        id,
        organization_id,
        project_id,
        file_object_id,
        file_name,
        source,
        status,
        archive_state,
        failure_reason,
        submitted_by_user_id,
        captured_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, 'upload', 'failed', 'active', $6, $7, $8, $8)
      on conflict (id) do update set
        file_object_id = excluded.file_object_id,
        file_name = excluded.file_name,
        source = excluded.source,
        status = excluded.status,
        archive_state = excluded.archive_state,
        current_run_id = null,
        analysis_question = null,
        related_parameter_id = null,
        failure_reason = excluded.failure_reason,
        submitted_by_user_id = excluded.submitted_by_user_id,
        updated_at = excluded.updated_at
      `,
      [
        failedLogId,
        organizationId,
        projectId,
        failedFileObjectId,
        "unsupported.bin",
        "Unsupported log format: .bin files are not accepted in M2.",
        seedUserId,
        "2026-05-25T10:04:00.000Z"
      ]
    );

  });
}

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed M2 log data.");
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  await seedM2Logs(db);

  console.log("Seeded M2 log data.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

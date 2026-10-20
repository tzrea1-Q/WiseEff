import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import { getSourceSnapshotLimits, indexSourceArchive, sourceChunks, type SourceSnapshotLimits } from "./sourceArchive";
import { createSourceStatementBudget, extractSourceStatementsCooperatively, getSourceStatementLimits, type SourceStatementLimits } from "./sourceStatements";

type SourceIndexWorkerOptions = { db: Database; objectStore: ObjectStore; limits?: SourceSnapshotLimits; statementLimits?: SourceStatementLimits };
type Claim = { id: string; organization_id: string; storage_key: string; file_name: string; index_attempt_id: string; statement_patterns: string[] };
class SourceIndexCancelled extends Error {}

export async function processNextSourceIndexJob(options: SourceIndexWorkerOptions): Promise<"processed" | "idle"> {
  const { db, objectStore } = options;
  const limits = options.limits ?? getSourceSnapshotLimits();
  const statementLimits = options.statementLimits ?? getSourceStatementLimits();
  const claimed = await db.query<Claim>(`
    update log_source_snapshots set status = 'indexing', index_attempt_id = $1, updated_at = now()
    where id = (
      select id from log_source_snapshots
      where status = 'queued' or (status = 'indexing' and updated_at < now() - interval '5 minutes')
      order by created_at limit 1 for update skip locked
    ) returning id, organization_id, storage_key, file_name, index_attempt_id, statement_patterns
  `, [randomUUID()]);
  const snapshot = claimed.rows[0];
  if (!snapshot) return "idle";
  let directory: string | undefined;
  const withClaim = async (fn: (tx: Database) => Promise<void>) => db.transaction(async (tx) => {
    const current = await tx.query(`select id from log_source_snapshots where id = $1 and organization_id = $2
      and status = 'indexing' and index_attempt_id = $3 for update`, [snapshot.id, snapshot.organization_id, snapshot.index_attempt_id]);
    if (!current.rows.length) throw new SourceIndexCancelled();
    await fn(tx);
  });
  try {
    if (!objectStore.getStream) throw new Error("源码索引需要支持流式读取的对象存储。");
    await withClaim(async (tx) => {
      await tx.query("delete from log_source_files where snapshot_id = $1 and organization_id = $2", [snapshot.id, snapshot.organization_id]);
      await tx.query(`update log_source_snapshots set files_processed = 0, files_total = 0, file_count = 0,
        skipped_count = 0, skipped_files = '[]'::jsonb, statement_count = 0, statements_truncated = false,
        error = null, updated_at = now() where id = $1 and organization_id = $2`, [snapshot.id, snapshot.organization_id]);
    });
    directory = await mkdtemp(join(tmpdir(), "wiseeff-source-index-"));
    const archivePath = join(directory, "archive");
    let compressedBytes = 0;
    await pipeline(await objectStore.getStream(snapshot.storage_key), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        compressedBytes += chunk.length;
        callback(compressedBytes > limits.maxCompressedBytes ? new Error("源码压缩上传大小超过上限") : null, chunk);
      }
    }), createWriteStream(archivePath, { flags: "wx", mode: 0o600 }));
    let statementCount = 0, statementsTruncated = false;
    const statementBudget = createSourceStatementBudget();
    const summary = await indexSourceArchive({
      archivePath, fileName: snapshot.file_name, limits,
      onFile: async (file) => {
        const extracted = await extractSourceStatementsCooperatively({ path: file.path, text: file.text, patterns: snapshot.statement_patterns,
          maxStatements: Math.min(statementLimits.maxPerFile, statementLimits.maxPerSnapshot - statementCount) }, {
          budget: statementBudget,
          onCheckpoint: async () => {
            const current = await db.query(`update log_source_snapshots set updated_at=now()
              where id=$1 and organization_id=$2 and status='indexing' and index_attempt_id=$3 returning id`,
            [snapshot.id, snapshot.organization_id, snapshot.index_attempt_id]);
            if (!current.rows.length) throw new SourceIndexCancelled();
          }
        });
        statementsTruncated ||= extracted.truncated;
        await withClaim(async (tx) => {
          const fileId = randomUUID();
          await tx.query(`insert into log_source_files (id, organization_id, snapshot_id, path, size_bytes, sha256, line_count, language)
            values ($1,$2,$3,$4,$5,$6,$7,$8)`, [fileId, snapshot.organization_id, snapshot.id, file.path, file.sizeBytes, file.sha256, file.lineCount, file.language]);
          let chunkOrdinal = 0;
          for (const chunk of sourceChunks(file.text)) {
            await tx.query(`insert into log_source_chunks (id, organization_id, snapshot_id, file_id, start_line, end_line, content, chunk_ordinal)
              values ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), snapshot.organization_id, snapshot.id, fileId, chunk.startLine, chunk.endLine, chunk.content, chunkOrdinal++]);
          }
          for (const statement of extracted.statements) {
            await tx.query(`insert into log_source_statements (id,organization_id,snapshot_id,file_id,path,line,function_name,raw_call,skeleton,match_key)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), snapshot.organization_id, snapshot.id, fileId,
              statement.path, statement.line, statement.functionName, statement.rawCall, statement.skeleton, statement.matchKey]);
          }
          statementCount += extracted.statements.length;
        });
      },
      onProgress: (progress) => withClaim(async (tx) => {
        await tx.query(`update log_source_snapshots set files_processed=$3, files_total=$4, file_count=$5,
          skipped_count=$6, skipped_files=$7::jsonb, updated_at=now() where id=$1 and organization_id=$2`,
        [snapshot.id, snapshot.organization_id, progress.filesProcessed, progress.filesTotal, progress.fileCount, progress.skippedCount, JSON.stringify(progress.skippedFiles)]);
      })
    });
    await withClaim(async (tx) => {
      await tx.query(`update log_source_snapshots set status='ready', files_processed=$3, files_total=$4,
        file_count=$5, skipped_count=$6, skipped_files=$7::jsonb, statement_count=$8, statements_truncated=$9,
        error=null, updated_at=now() where id=$1 and organization_id=$2`,
      [snapshot.id, snapshot.organization_id, summary.filesProcessed, summary.filesTotal, summary.fileCount, summary.skippedCount, JSON.stringify(summary.skippedFiles), statementCount, statementsTruncated]);
    });
  } catch (error) {
    if (!(error instanceof SourceIndexCancelled)) {
      await db.transaction(async (tx) => {
        // The attempt token prevents a stale worker from reviving an archived or reclaimed snapshot.
        const failed = await tx.query(`update log_source_snapshots set status='failed', file_count=0, error=$4, updated_at=now()
          where id=$1 and organization_id=$2 and status='indexing' and index_attempt_id=$3 returning id`,
        [snapshot.id, snapshot.organization_id, snapshot.index_attempt_id, (error instanceof Error ? error.message : String(error)).slice(0, 2000)]);
        if (failed.rows.length) await tx.query("delete from log_source_files where snapshot_id=$1 and organization_id=$2", [snapshot.id, snapshot.organization_id]);
      });
    }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  return "processed";
}

export function startSourceIndexWorkerLoop(options: SourceIndexWorkerOptions, intervalMs = 1000): () => void {
  let stopped = false, running = false;
  const tick = () => {
    if (stopped || running) return;
    running = true;
    void processNextSourceIndexJob(options).catch(() => undefined).finally(() => { running = false; });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => { stopped = true; clearInterval(timer); };
}

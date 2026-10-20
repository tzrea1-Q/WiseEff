import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { loadLogBundleLimits } from "../../config/env";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createLocalObjectStore } from "./objectStore";
import { getLogRecord, uploadLogFile } from "./service";
import { loadLogFiles } from "./filesRepository";
import { readStoredLogRange } from "./fileReader";
import { processLogAnalysisJobById } from "./worker";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";

const available = await isTestDatabaseAvailable();

function capArchive(cap: number) {
  // Two headers plus the tar end marker; all payloads remain block aligned.
  const fileBytes = Math.floor((cap - 2048) / 2048) * 1024;
  const archive = Buffer.alloc(cap);
  const normalLine = "INFO device=large-bundle status=healthy".padEnd(1023, " ") + "\n";
  for (let index = 0; index < 2; index++) {
    const start = index * (fileBytes + 512), header = archive.subarray(start, start + 512);
    header.write(`device-${index}.log`, 0, 100); header.write("0000644\0", 100);
    header.write(`${fileBytes.toString(8).padStart(11, "0")}\0`, 124); header.fill(32, 148, 156);
    header.write("0", 156); header.write("ustar\0", 257);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
    const payload = archive.subarray(start + 512, start + 512 + fileBytes);
    payload.fill(normalLine);
    payload.write(`ERROR STREAM_PROBE_EOF file=${index}`.padEnd(1023, " ") + "\n", fileBytes - 1024);
  }
  return { archive, fileBytes, lastContentLine: fileBytes / 1024 };
}

describe.skipIf(!available)("configured-cap bundles through the PostgreSQL worker", () => {
  it("completes a cap-sized upload, persists offsets and grounds evidence beyond the raw preview", async () => {
    const ephemeral = await createEphemeralTestDatabase("logbig");
    const db = createPostgresDatabase(ephemeral.url);
    const root = await mkdtemp(join(tmpdir(), "wiseeff-log-big-"));
    const store = createLocalObjectStore(root);
    const auth = makeTestAuthContext({ organizationId: "log-big-org", userId: "log-big-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze"] });
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }] });
      const limits = loadLogBundleLimits(process.env);
      const cap = Math.min(limits.maxCompressedBytes, limits.maxUnpackedBytes, limits.maxFileBytes * 2 + 2048);
      const { archive, fileBytes, lastContentLine } = capArchive(cap);
      expect(archive.byteLength).toBe(cap);
      expect(lastContentLine).toBeGreaterThan(400);
      const uploaded = await uploadLogFile(db, store, auth, { fileName: "configured-cap.tar", contentType: "application/x-tar", bytes: archive });
      expect(uploaded.job).not.toBeNull();
      expect(uploaded.log.files).toHaveLength(2);
      // A worker read of a complete text object would fail this check. Offset
      // indexes use bounded reads; content uses streaming/range reads exclusively.
      const textKeys = new Set((await loadLogFiles(db, auth.organization.id, uploaded.log.id)).map((file) => file.objectKey));
      const objectStore = { ...store, async get(key: string) {
        expect(textKeys.has(key), "Worker must not buffer a complete log file").toBe(false);
        return store.get(key);
      } };
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "read_line_range", args: { file: "device-1.log", startLine: lastContentLine - 1, endLine: lastContentLine + 1 } } },
        { content: { action: "final", conclusion: "Failure at the end of the second file", impact: "Device", severity: "Warning", confidence: 0.8,
          suggestedActions: ["Inspect the final error"], evidence: [{ filePath: "device-1.log", lineNumbers: [lastContentLine],
            inference: "End-of-file failure", suggestedAction: "Inspect the device" }] } }
      ]);
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id,
        analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: "scripted-large-bundle", maxSteps: 3, tokenBudget: 100_000 }) }))
        .toEqual({ status: "processed" });
      expect(model.calls[1].at(-1)?.content).toContain("STREAM_PROBE_EOF file=1");
      const report = await getLogRecord(db, auth, uploaded.log.id);
      expect(report.status).toBe("complete");
      expect(report.evidence).toMatchObject([{ filePath: "device-1.log", lineNumbers: [lastContentLine] }]);
      expect(report.rawLines?.join("\n")).not.toContain("STREAM_PROBE_EOF");
      const files = await loadLogFiles(db, auth.organization.id, uploaded.log.id);
      expect(files).toHaveLength(2);
      for (const file of files) {
        expect(file.sizeBytes).toBe(fileBytes);
        // Only the file requested by the model needs an index; the prefilter
        // scans every file directly without eagerly building viewer indexes.
        expect(file.lineIndexKey).toEqual(file.path === "device-1.log" ? expect.any(String) : null);
        expect(file.lineCount).toBe(lastContentLine);
        expect(await readStoredLogRange(objectStore, file, lastContentLine, lastContentLine + 1)).toEqual([
          { lineNumber: lastContentLine, content: `ERROR STREAM_PROBE_EOF file=${file.path === "device-0.log" ? 0 : 1}`.padEnd(1023, " ") }
        ]);
      }
    } finally { await db.close(); await ephemeral.drop(); await rm(root, { recursive: true, force: true }); }
  }, 180_000);
});

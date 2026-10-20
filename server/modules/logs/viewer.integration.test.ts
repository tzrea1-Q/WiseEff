import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { logLineRangeResponseSchema } from "../contracts/dtoSchemas/logs";
import type { LogLineRangeDto, LogRecordDto } from "./types";
import { resolveRouteBodyLimit } from "../../app";
import { loadLogFiles } from "./filesRepository";

const available = await isTestDatabaseAvailable();
const auth = (organizationId = "viewer-org") => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`,
  roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload"] });

describe.skipIf(!available)("indexed log viewer over PostgreSQL", () => {
  it("assigns JSON a bounded transport envelope below multipart's configured envelope", () => {
    const jsonLimit = resolveRouteBodyLimit({ method: "POST", path: "/api/v1/log-files", contentType: "application/json" });
    const multipartLimit = resolveRouteBodyLimit({ method: "POST", path: "/api/v1/log-files", contentType: "multipart/form-data" });
    expect(jsonLimit).toBe(Math.ceil(32 * 1024 * 1024 * 4 / 3) + 4 * 1024 * 1024);
    expect(multipartLimit).toBeGreaterThan(jsonLimit);
  });
  it("reads bounded UTF-8 windows with CRLF, final lines and converted UTF-16, and enforces record access", async () => {
    const ephemeral = await createEphemeralTestDatabase("logviewer");
    const db = createPostgresDatabase(ephemeral.url);
    const objectStore = createMemoryObjectStore();
    try {
      for (const id of ["viewer-org", "other-viewer-org"]) await seedCoreGraph(db, {
        organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }]
      });
      let currentAuth = auth();
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => currentAuth });
      const server = createHttpServer(router);
      const zip = new JSZip();
      const expected = Array.from({ length: 405 }, (_, index) => `INFO line ${index + 1} café 日志`);
      zip.file("device/crlf.log", expected.join("\r\n"));
      const utf16Text = "INFO café\r\nERROR 日志\r\nINFO final";
      zip.file("device/le.log", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16Text, "utf16le")]));
      zip.file("device/be.log", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16Text, "utf16le").swap16()]));
      const boundaries: Array<{ file: string; lines: string[]; newline: string; encoding?: "le" | "be" }> = [
        { file: "app.log", lines: Array.from({ length: 43 }, (_, i) => `INFO app ${i + 1}`), newline: "\n" },
        { file: "kernel.log", lines: Array.from({ length: 92 }, (_, i) => `INFO kernel ${i + 1}`), newline: "\r\n" },
        { file: "block.log", lines: Array.from({ length: 256 }, (_, i) => `INFO block ${i + 1}`), newline: "\r\n" },
        { file: "empty.log", lines: [], newline: "\n" },
        { file: "blank.log", lines: ["INFO real", ""], newline: "\n" },
        { file: "le-final.log", lines: ["INFO café", "ERROR 日志", "INFO final"], newline: "\r\n", encoding: "le" },
        { file: "be-final.log", lines: ["INFO café", "ERROR 日志", "INFO final"], newline: "\r\n", encoding: "be" }
      ];
      for (const { file, lines, newline, encoding } of boundaries) {
        const text = lines.length ? lines.join(newline) + newline : "";
        const bytes = Buffer.from(text, encoding ? "utf16le" : "utf8");
        zip.file(file, !encoding ? bytes : encoding === "le" ? Buffer.concat([Buffer.from([0xff, 0xfe]), bytes])
          : Buffer.concat([Buffer.from([0xfe, 0xff]), bytes.swap16()]));
      }
      zip.file("ignored.bin", Buffer.from([0, 1, 2]));
      const upload = await requestJson<{ log: LogRecordDto }>(server, "/api/v1/log-files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "viewer.zip", contentType: "application/zip",
          contentBase64: (await zip.generateAsync({ type: "nodebuffer" })).toString("base64") })
      });
      expect(upload.status).toBe(201);
      const base = `/api/v1/logs/${upload.body.log.id}/lines`;
      const read = (file: string, startLine: number, endLine: number) => requestJson<{ item: LogLineRangeDto }>(server,
        `${base}?${new URLSearchParams({ file, startLine: String(startLine), endLine: String(endLine) })}`);
      const first = await read("device/crlf.log", 1, 400);
      expect(first.status).toBe(200);
      expect(logLineRangeResponseSchema.safeParse(first.body).success).toBe(true);
      expect(first.body.item).toEqual({ file: "device/crlf.log", startLine: 1, endLine: 400, totalLines: 405,
        lines: expected.slice(0, 400).map((content, index) => ({ lineNumber: index + 1, content })) });
      expect((await read("device/crlf.log", 400, 799)).body.item).toEqual({
        file: "device/crlf.log", startLine: 400, endLine: 405, totalLines: 405,
        lines: expected.slice(399).map((content, index) => ({ lineNumber: index + 400, content }))
      });
      expect((await read("device/crlf.log", 405, 405)).body.item.lines).toEqual([{ lineNumber: 405, content: expected[404] }]);
      for (const file of ["device/le.log", "device/be.log"]) {
        expect((await read(file, 1, 3)).body.item).toEqual({ file, startLine: 1, endLine: 3, totalLines: 3,
          lines: ["INFO café", "ERROR 日志", "INFO final"].map((content, index) => ({ lineNumber: index + 1, content })) });
        expect((await read(file, 3, 4)).body.item.lines).toEqual([{ lineNumber: 3, content: "INFO final" }]);
      }
      for (const { file, lines } of boundaries) {
        expect(upload.body.log.files?.find((item) => item.path === file)?.lineCount).toBe(lines.length);
        const response = await read(file, 1, 400);
        expect(response.status).toBe(200);
        expect(logLineRangeResponseSchema.safeParse(response.body).success).toBe(true);
        expect(response.body.item).toEqual({ file, startLine: 1, endLine: lines.length, totalLines: lines.length,
          lines: lines.map((content, i) => ({ lineNumber: i + 1, content })) });
        if (lines.length) expect((await read(file, lines.length + 1, lines.length + 1)).status).toBe(400);
      }
      // Rebuild an index written before the EOF fix, including the persisted count.
      const app = (await loadLogFiles(db, currentAuth.organization.id, upload.body.log.id)).find((file) => file.path === "app.log")!;
      const legacyBytes = Buffer.alloc(24);
      legacyBytes.writeUInt32LE(256, 0); legacyBytes.writeUInt32LE(44, 4);
      legacyBytes.writeDoubleLE(app.sizeBytes, 8);
      const legacyIndex = await objectStore.put({ organizationId: currentAuth.organization.id, fileName: "legacy-index.bin",
        contentType: "application/octet-stream", bytes: legacyBytes });
      await db.query("update log_files set line_index_key=$1, line_count=44 where record_id=$2 and path='app.log'", [legacyIndex.storageKey, upload.body.log.id]);
      expect((await read("app.log", 43, 44)).body.item).toMatchObject({ endLine: 43, totalLines: 43, lines: [{ lineNumber: 43, content: "INFO app 43" }] });
      const repaired = (await loadLogFiles(db, currentAuth.organization.id, upload.body.log.id)).find((file) => file.path === "app.log")!;
      expect(repaired.lineCount).toBe(43);
      expect(repaired.lineIndexKey).not.toBe(legacyIndex.storageKey);
      for (const [start, end] of [[0, 1], [-1, 1], [1, 401], [2, 1], [1.5, 2], [406, 406], [1, Number.MAX_SAFE_INTEGER + 1]]) {
        expect((await read("device/crlf.log", start, end)).status).toBe(400);
      }
      expect((await requestJson(server, base)).status).toBe(400);
      for (const file of ["missing.log", "../device/crlf.log", "ignored.bin"]) expect((await read(file, 1, 1)).status).toBe(404);
      currentAuth = { ...auth(), permissions: ["logs:upload"] };
      expect((await read("device/crlf.log", 1, 1)).status).toBe(403);
      currentAuth = auth("other-viewer-org");
      expect((await read("device/crlf.log", 1, 1)).status).toBe(404);
      currentAuth = { ...auth("other-viewer-org"), user: auth().user };
      expect((await read("device/crlf.log", 1, 1)).status).toBe(403);
      currentAuth = auth();
      const legacy = await requestJson<{ log: LogRecordDto }>(server, "/api/v1/log-files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "legacy.log", contentType: "text/plain", contentBase64: Buffer.from("INFO first\r\nERROR last").toString("base64") })
      });
      await db.query("delete from log_files where record_id=$1", [legacy.body.log.id]);
      const restored = await requestJson<{ item: LogLineRangeDto }>(server, `/api/v1/logs/${legacy.body.log.id}/lines?file=legacy.log&startLine=2&endLine=2`);
      expect(restored.body.item.lines).toEqual([{ lineNumber: 2, content: "ERROR last" }]);
      expect((await db.query("select line_index_key from log_files where record_id=$1", [legacy.body.log.id])).rows)
        .toEqual([{ line_index_key: expect.any(String) }]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});

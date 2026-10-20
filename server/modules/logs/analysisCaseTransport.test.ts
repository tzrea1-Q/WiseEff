import { describe, expect, it } from "vitest";
import { request } from "node:http";
import { createWiseEffServer, resolveRouteBodyLimit } from "../../app";

describe("analysis-case HTTP input bounds", () => {
  it("admits bounded case bytes and metadata, and bounds multipart imports and expectation edits", () => {
    const base = "/api/v1/log-skills/skill/analysis-cases";
    const encodedBundle = Buffer.alloc(10 * 1024 * 1024).toString("base64");
    for (const path of [base, `${base}/`, base.replace("/analysis-cases", "//analysis-cases")]) {
      const cap = resolveRouteBodyLimit({ method: "POST", path, contentType: "application/json" });
      expect(Number.isFinite(cap)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify({ files: [{ fileName: "sample.log", contentBase64: encodedBundle }], expectations: {} }))).toBeLessThan(cap);
      expect(cap).toBeLessThan(17 * 1024 * 1024);
    }
    expect(resolveRouteBodyLimit({ method: "POST", path: `${base}/import`, contentType: "multipart/form-data" })).toBe(440 * 1024 * 1024 + 64 * 1024);
    expect(() => resolveRouteBodyLimit({ method: "POST", path: `${base}/import`, contentType: "application/json" })).toThrow("multipart/form-data");
    expect(resolveRouteBodyLimit({ method: "PATCH", path: `${base}/case-id` })).toBe(2 * 1024 * 1024);
    expect(resolveRouteBodyLimit({ method: "POST", path: `${base}/extra` })).toBe(Infinity);
  });

  it("rejects oversized expectation bodies before route validation", async () => {
    const server = createWiseEffServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const upload = request({ host: "127.0.0.1", port: address.port, method: "PATCH", path: "/api/v1/log-skills/skill/analysis-cases/case-id",
          headers: { "Content-Type": "application/json", "Content-Length": 2 * 1024 * 1024 + 1, Connection: "close" } }, (response) => {
          response.resume(); response.on("end", () => resolve(response.statusCode));
        });
        upload.on("error", reject); upload.end();
      });
      expect(status).toBe(413);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

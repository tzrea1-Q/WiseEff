import { describe, expect, it } from "vitest";
import { resolveRouteBodyLimit } from "../../app";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { makeTestAuthContext } from "../../testing/authContext";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { createLogBodySchema, createLogFileBodySchema, logSkillRecommendationRequestSchema } from "./schemas";

describe("recommendation structural validation", () => {
  it.each([
    ["too many files", { files: Array(50_000).fill(0) }],
    ["too many lines", { files: [{ path: "kernel.log", head: Array(50_000).fill(0) }] }],
    ["invalid files", { files: Array(200).fill(0) }],
    ["invalid lines", { files: [{ path: "kernel.log", head: Array(64).fill(0) }] }],
    ["non-array files", { files: {} }],
    ["non-array heads", { files: [{ path: "kernel.log", head: {} }] }],
    ["empty paths", { files: [{ path: "", head: [] }] }],
    ["control characters", { files: [{ path: "kernel\u0000.log", head: [] }] }],
    ["oversized paths", { files: [{ path: "x".repeat(1025), head: [] }] }],
    ["oversized strings", { files: [{ path: "kernel.log", head: ["x".repeat(2049)] }] }],
    ["oversized UTF-8 lines", { files: [{ path: "kernel.log", head: ["界".repeat(683)] }] }],
    ["unexpected fields", { files: [{ path: "kernel.log", head: [], extra: true }] }]
  ])("rejects %s through the route with one issue", async (_name, body) => {
    const router = createRouter();
    registerLogRoutes(router, { getCurrentAuthContext: () => makeTestAuthContext({ permissions: ["logs:upload"] }) });
    const started = performance.now();
    const response = await requestJson<{ error: { code: string; details: { issues: unknown[] } } }>(
      createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit }), "/api/v1/log-skills/recommend",
      { method: "POST", body: JSON.stringify(body) }
    );
    expect(response.status).toBe(400);
    expect(response.body.error.details.issues).toHaveLength(1);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("does not inspect elements past the first violation", () => {
    const files = [null, 0], head = [null, 0];
    for (const [entries, body] of [[files, { files }], [head, { files: [{ path: "kernel.log", head }] }]] as const) {
      Object.defineProperty(entries, 1, { get() { throw new Error("Element after the violation was inspected"); } });
      const parsed = logSkillRecommendationRequestSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues).toHaveLength(1);
    }
  });

  it("accepts the documented file, line and UTF-8 boundaries", () => {
    const body = { files: Array.from({ length: 200 }, () => ({
      path: "界".repeat(1024), head: Array(64).fill("界".repeat(682) + "ab")
    })) };
    expect(logSkillRecommendationRequestSchema.safeParse(body).success).toBe(true);
  });
});

describe("upload recommendation selectors", () => {
  it.each([
    ["file upload", createLogFileBodySchema, { fileName: "kernel.log", contentType: "text/plain", contentBase64: "YQ==" }],
    ["stored upload", createLogBodySchema, { fileObjectId: "file-1", fileName: "kernel.log" }]
  ] as const)("rejects large selectors without echoing their contents for %s", (_name, schema, input) => {
    expect(schema.parse({ ...input, skillSelection: "generic" }).skillSelection).toBe("generic");
    for (const skillSelection of [Array(50_000).fill(0), { nested: Array(50_000).fill(0) }, "x".repeat(50_000)]) {
      const parsed = schema.safeParse({ ...input, skillSelection });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toHaveLength(1);
        expect(JSON.stringify(parsed.error.issues).length).toBeLessThan(256);
      }
    }
  });
});

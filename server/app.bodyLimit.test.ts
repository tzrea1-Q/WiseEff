import { describe, expect, it, vi } from "vitest";
import { resolveRouteBodyLimit } from "./app";
import { createRouter } from "./shared/http/router";
import { createHttpServer, DEFAULT_MAX_REQUEST_BODY_BYTES } from "./shared/http/server";
import { requestJson } from "./test/testClient";

const samplePath = "/api/v1/log-skills/skill-1/sample";
const sampleBodyLimit = Math.ceil(2 * 1024 * 1024 * 4 / 3) + 4 + 64 * 1024;

describe("skill sample transport body limit", () => {
  it("bounds only sample PUTs, including the router's slash aliases", () => {
    for (const path of [samplePath, `${samplePath}/`, "//api//v1//log-skills//skill-1//sample//"])
      expect(resolveRouteBodyLimit({ method: "PUT", path })).toBe(sampleBodyLimit);
    for (const input of [
      { method: "GET", path: samplePath }, { method: "POST", path: samplePath }, { method: "DELETE", path: samplePath },
      { method: "PUT", path: `${samplePath}/extra` }, { method: "PUT", path: "/api/v1/log-skills/sample" },
      { method: "PUT", path: "/api/v1/log-domains/skill-1/sample" }
    ]) expect(resolveRouteBodyLimit(input)).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
  });

  it("admits a 2 MiB JSON sample and rejects an oversized body with 413 before the handler", async () => {
    const router = createRouter();
    const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    router.put(samplePath, handler);
    const server = createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit });
    const valid = JSON.stringify({ fileName: "样例.log", contentBase64: Buffer.alloc(2 * 1024 * 1024, 65).toString("base64") });
    expect(Buffer.byteLength(valid)).toBeLessThan(sampleBodyLimit);
    expect((await requestJson(server, samplePath, { method: "PUT", body: valid })).status).toBe(200);
    handler.mockClear();
    const oversized = JSON.stringify({ fileName: "sample.log", contentBase64: "A".repeat(sampleBodyLimit + 1) });
    expect(await requestJson(server, samplePath, { method: "PUT", body: oversized })).toMatchObject({
      status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE", details: { maxBytes: sampleBodyLimit } } }
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

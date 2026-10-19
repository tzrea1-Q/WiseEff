import { describe, expect, it, vi } from "vitest";
import { LOG_SKILL_PREVIEW_HTTP_BODY_LIMIT_BYTES, resolveRouteBodyLimit, LOG_PARSE_TEST_HTTP_BODY_LIMIT_BYTES } from "./app";
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

describe("parse-test transport body limit", () => {
  const path = "/api/v1/log-skills/skill-1/parse-tests";
  const aliases = [path, `${path}/`, "/api//v1//log-skills//skill-1//parse-tests//"];
  it("bounds POST bodies and their slash aliases without changing other routes", () => {
    for (const path of aliases) expect(resolveRouteBodyLimit({ method: "POST", path })).toBe(8 * 1024 * 1024);
    for (const input of [{ method: "GET", path }, { method: "PUT", path }, { method: "POST", path: `${path}/extra` }])
      expect(resolveRouteBodyLimit(input)).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
  });

  it.each(aliases)("rejects oversized declared and chunked bodies before %s reaches the handler", async (alias) => {
    const router = createRouter();
    const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    router.post(path, handler);
    const server = createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit });
    const body = JSON.stringify({ spec: { procedure: "x".repeat(LOG_PARSE_TEST_HTTP_BODY_LIMIT_BYTES) } });
    expect(await requestJson(server, alias, { method: "POST", body })).toMatchObject({
      status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE", details: { maxBytes: LOG_PARSE_TEST_HTTP_BODY_LIMIT_BYTES } } }
    });
    const chunked = new ReadableStream({ start(controller) {
      for (let offset = 0; offset < body.length; offset += 64 * 1024) controller.enqueue(new TextEncoder().encode(body.slice(offset, offset + 64 * 1024)));
      controller.close();
    } });
    expect(await requestJson(server, alias, { method: "POST", body: chunked, duplex: "half" } as RequestInit)).toMatchObject({
      status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE" } }
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("skill authoring preview transport body limit", () => {
  it.each(["parse", "extractor", "format"])("bounds only %s-preview POSTs, including slash aliases", (kind) => {
    const path = `/api/v1/log-skills/skill-1/${kind}-preview`;
    for (const alias of [path, `${path}/`, `/api//v1//log-skills//skill-1//${kind}-preview//`]) {
      expect(resolveRouteBodyLimit({ method: "POST", path: alias })).toBe(LOG_SKILL_PREVIEW_HTTP_BODY_LIMIT_BYTES);
    }
    for (const input of [
      { method: "PUT", path }, { method: "GET", path }, { method: "POST", path: `${path}/extra` },
      { method: "POST", path: `/api/v1/log-skills/${kind}-preview` }
    ]) expect(resolveRouteBodyLimit(input)).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
  });

  it.each(["parse", "extractor", "format"])("admits escaped samples and rejects oversized %s-preview aliases before the handler", async (kind) => {
    const router = createRouter();
    const path = `/api/v1/log-skills/skill-1/${kind}-preview`;
    const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    router.post(path, handler);
    const server = createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit });
    const valid = JSON.stringify({ sampleText: "\u0001".repeat(1024 * 1024) });
    expect(Buffer.byteLength(valid)).toBeLessThan(LOG_SKILL_PREVIEW_HTTP_BODY_LIMIT_BYTES);
    expect((await requestJson(server, path, { method: "POST", body: valid })).status).toBe(200);
    handler.mockClear();
    const oversized = "x".repeat(LOG_SKILL_PREVIEW_HTTP_BODY_LIMIT_BYTES + 1);
    for (const alias of [path, `${path}/`, `/api//v1//log-skills//skill-1//${kind}-preview//`]) {
      expect(await requestJson(server, alias, { method: "POST", body: oversized })).toMatchObject({
        status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE", details: { maxBytes: LOG_SKILL_PREVIEW_HTTP_BODY_LIMIT_BYTES } } }
      });
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

import { request, type IncomingMessage, type Server } from "node:http";
import { json } from "node:stream/consumers";
import { describe, expect, it, vi } from "vitest";
import { createWiseEffServer, LOG_FILE_PREVIEW_HTTP_BODY_LIMIT_BYTES, LOG_SIGNAL_PREVIEW_HTTP_BODY_LIMIT_BYTES, LOG_SKILL_PREVIEW_HTTP_BODY_LIMIT_BYTES, resolveRouteBodyLimit, LOG_PARSE_TEST_HTTP_BODY_LIMIT_BYTES } from "./app";
import { MAX_FILE_GLOB_LENGTH, MAX_FILE_ROLE_LENGTH, MAX_SKILL_FILE_GLOBS } from "../src/domain/logs/fileApplicability";
import { createRouter } from "./shared/http/router";
import { createHttpServer, DEFAULT_MAX_REQUEST_BODY_BYTES } from "./shared/http/server";
import { requestJson } from "./test/testClient";

const samplePath = "/api/v1/log-skills/skill-1/sample";
const sampleBodyLimit = Math.ceil(2 * 1024 * 1024 * 4 / 3) + 4 + 64 * 1024;

async function requestDeclaredOversize(server: Server, path: string, method: string, bytes: number, authorization?: string) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port: address.port, path, method,
        headers: { "Content-Type": "application/json", "Content-Length": bytes, Connection: "close",
          ...(authorization ? { Authorization: authorization } : {}) } }, resolve);
      outgoing.on("error", reject);
      // The declared length must be rejected before collecting or parsing this malformed prefix.
      outgoing.end("{");
    });
    return { status: response.statusCode, body: await json(response) };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("integration credential pre-body route gate", () => {
  const authorization = "Bearer wie_forbidden-route";

  it.each([
    ["/api/v1/log-domains", "application/json", "{"],
    ["/api/v1/log-skills/skill-1/analysis-cases/import", "application/json", "{}"],
    ["/api/v1/log-skills/skill-1/analysis-cases/import", "multipart/form-data", "malformed multipart"]
  ])("rejects %s (%s) before parsing or consuming its stream", async (path, contentType, body) => {
    const server = createWiseEffServer();
    const read = vi.fn(() => { throw new Error("Forbidden request body was consumed"); });
    server.prependListener("request", (incoming) => { incoming[Symbol.asyncIterator] = read; });
    expect(await requestJson(server, path, { method: "POST", headers: { Authorization: authorization, "Content-Type": contentType }, body }))
      .toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects an oversized declaration and malformed prefix before size validation or body consumption", async () => {
    const server = createWiseEffServer();
    const read = vi.fn(() => { throw new Error("Forbidden request body was consumed"); });
    server.prependListener("request", (incoming) => { incoming[Symbol.asyncIterator] = read; });
    expect(await requestDeclaredOversize(server, samplePath, "PUT", sampleBodyLimit + 1, authorization))
      .toMatchObject({ status: 403, body: { error: { code: "FORBIDDEN" } } });
    expect(read).not.toHaveBeenCalled();
  });

  it("continues parsing allowlisted upload bodies", async () => {
    expect(await requestJson(createWiseEffServer(), "/api/v1/log-files", {
      method: "POST", headers: { Authorization: authorization, "Content-Type": "multipart/form-data" }, body: "malformed multipart"
    })).toMatchObject({ status: 400, body: { error: { code: "VALIDATION_FAILED", message: "Multipart boundary is required." } } });
  });
});

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
    expect(await requestDeclaredOversize(server, samplePath, "PUT", sampleBodyLimit + 1)).toMatchObject({
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

describe("skill signal preview transport body limit", () => {
  const previewPath = "/api/v1/log-skills/skill-1/signals-preview";

  it("bounds only signal preview POSTs, including slash aliases", () => {
    for (const path of [previewPath, `${previewPath}/`, "//api//v1//log-skills//skill-1//signals-preview//"])
      expect(resolveRouteBodyLimit({ method: "POST", path })).toBe(LOG_SIGNAL_PREVIEW_HTTP_BODY_LIMIT_BYTES);
    for (const input of [
      { method: "GET", path: previewPath }, { method: "PUT", path: previewPath },
      { method: "POST", path: `${previewPath}/extra` }, { method: "POST", path: "/api/v1/log-skills/signals-preview" }
    ]) expect(resolveRouteBodyLimit(input)).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
  });

  it("rejects an oversized malformed JSON body with 413 before parsing or invoking the handler", async () => {
    const router = createRouter();
    const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    router.post(previewPath, handler);
    const server = createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit });
    expect((await requestJson(server, previewPath, { method: "POST", body: '{"signalRules":{}}' })).status).toBe(200);
    handler.mockClear();
    expect(await requestDeclaredOversize(server, previewPath, "POST", LOG_SIGNAL_PREVIEW_HTTP_BODY_LIMIT_BYTES + 1))
      .toMatchObject({ status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE", details: { maxBytes: LOG_SIGNAL_PREVIEW_HTTP_BODY_LIMIT_BYTES } } } });
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

describe("skill file preview transport body limit", () => {
  const previewPath = "/api/v1/log-skills/skill-1/files/preview";

  it("bounds preview POSTs and slash aliases without changing other routes", () => {
    for (const path of [previewPath, `${previewPath}/`, "//api//v1//log-skills//skill-1//files//preview//"])
      expect(resolveRouteBodyLimit({ method: "POST", path })).toBe(LOG_FILE_PREVIEW_HTTP_BODY_LIMIT_BYTES);
    for (const input of [{ method: "GET", path: previewPath }, { method: "PUT", path: previewPath },
      { method: "POST", path: `${previewPath}/extra` }, { method: "POST", path: "/api/v1/log-skills/files/preview" }])
      expect(resolveRouteBodyLimit(input)).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
  });

  it("admits the maximum escaped configuration and rejects oversize before JSON parsing or authentication", async () => {
    const router = createRouter();
    const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    router.post(previewPath, handler);
    const server = createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit });
    const valid = JSON.stringify({ files: Array.from({ length: MAX_SKILL_FILE_GLOBS }, () => ({
      glob: "a".repeat(MAX_FILE_GLOB_LENGTH), role: "充".repeat(MAX_FILE_ROLE_LENGTH)
    })) }).replace(/[a充]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    expect(Buffer.byteLength(valid)).toBeLessThan(LOG_FILE_PREVIEW_HTTP_BODY_LIMIT_BYTES);
    expect((await requestJson(server, previewPath, { method: "POST", body: valid })).status).toBe(200);
    handler.mockClear();
    expect(await requestDeclaredOversize(server, previewPath, "POST", LOG_FILE_PREVIEW_HTTP_BODY_LIMIT_BYTES + 1))
      .toMatchObject({ status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE", details: { maxBytes: LOG_FILE_PREVIEW_HTTP_BODY_LIMIT_BYTES } } } });
    expect((await requestJson(server, previewPath, { method: "POST", body: "{".repeat(LOG_FILE_PREVIEW_HTTP_BODY_LIMIT_BYTES + 1) })).status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });
});

import { request, type IncomingMessage, type Server } from "node:http";
import { json } from "node:stream/consumers";
import { describe, expect, it, vi } from "vitest";
import { LOG_SIGNAL_PREVIEW_HTTP_BODY_LIMIT_BYTES, resolveRouteBodyLimit } from "./app";
import { createRouter } from "./shared/http/router";
import { createHttpServer, DEFAULT_MAX_REQUEST_BODY_BYTES } from "./shared/http/server";
import { requestJson } from "./test/testClient";

const samplePath = "/api/v1/log-skills/skill-1/sample";
const sampleBodyLimit = Math.ceil(2 * 1024 * 1024 * 4 / 3) + 4 + 64 * 1024;

async function requestDeclaredOversize(server: Server, path: string, method: string, bytes: number) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port: address.port, path, method,
        headers: { "Content-Type": "application/json", "Content-Length": bytes, Connection: "close" } }, resolve);
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

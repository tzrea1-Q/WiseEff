import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createTracingBoundary, type TraceExporter } from "./observability/tracing";
import { createObjectStoreFromEnv } from "./objectStoreFactory";

describe("createObjectStoreFromEnv", () => {
  it("forwards byte ranges through the runtime wrapper", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "wiseeff-range-factory-"));
    try {
      const store = createObjectStoreFromEnv({ OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: rootDir });
      const object = await store.put({ organizationId: "org", fileName: "test.log", contentType: "text/plain", bytes: Buffer.from("first\nsecond\nthird") });
      const chunks = [];
      for await (const chunk of await store.getStream!(object.storageKey, { start: 6, end: 11 })) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe("second");
    } finally { await rm(rootDir, { recursive: true, force: true }); }
  });
  it("preserves and traces streaming reads through the runtime wrapper", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "wiseeff-stream-factory-"));
    const spans: Parameters<TraceExporter>[0][] = [];
    try {
      const objectStore = createObjectStoreFromEnv({ OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: rootDir }, {
        tracing: createTracingBoundary({ enabled: true, serviceName: "wiseeff-worker", exporter: (span) => { spans.push(span); } })
      });
      const bytes = Buffer.from("streamed factory bytes");
      const stored = await objectStore.put({ organizationId: "org-factory", fileName: "source.tgz", contentType: "application/gzip", bytes });
      expect(objectStore.getStream).toBeTypeOf("function");
      const chunks: Buffer[] = [];
      for await (const chunk of await objectStore.getStream!(stored.storageKey)) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks)).toEqual(bytes);
      expect(spans.map((span) => ({ name: span.name, ...span.attributes }))).toEqual([
        { name: "object_store.operation", operation: "put", mode: "local", service: "wiseeff-worker" },
        { name: "object_store.operation", operation: "getStream", mode: "local", service: "wiseeff-worker" }
      ]);
      expect(JSON.stringify(spans)).not.toContain(stored.storageKey);
    } finally { await rm(rootDir, { recursive: true, force: true }); }
  });
  it("preserves bounded reads through the production tracing wrapper", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "wiseeff-object-store-factory-"));
    const spans: Parameters<TraceExporter>[0][] = [];
    try {
      const objectStore = createObjectStoreFromEnv(
        {
          OBJECT_STORE_MODE: "local",
          OBJECT_STORE_ROOT: rootDir
        },
        {
          tracing: createTracingBoundary({
            enabled: true,
            serviceName: "wiseeff-api",
            exporter: (span) => {
              spans.push(span);
            }
          })
        }
      );
      const bytes = Buffer.from("bounded factory bytes", "utf8");
      const stored = await objectStore.put({
        organizationId: "org-factory",
        fileName: "bounded.log",
        contentType: "text/plain",
        bytes
      });

      await expect(objectStore.getBounded!(stored.storageKey, bytes.byteLength)).resolves.toEqual(bytes);
      expect(spans.map((span) => span.attributes.operation)).toEqual(["put", "getBounded"]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("constructs an S3 object store with the HTTP transport helper", async () => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const objectStore = createObjectStoreFromEnv({
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORE_ROOT: ".wiseeff-object-store",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      fetchImpl: async (input, init) => {
        requests.push({ input, init });
        if (init?.method === "GET") {
          return new Response("wiseeff-s3-health", { status: 200 });
        }
        return new Response(null, { status: 200 });
      }
    });

    await expect(objectStore.checkHealth()).resolves.toEqual({ ok: true, status: "ready" });
    expect(requests.map((request) => request.init?.method)).toEqual(["HEAD", "PUT", "HEAD", "GET", "DELETE"]);
    expect(String(requests[0].input)).toBe("https://storage.example.com/wiseeff-pilot");
    expect(String(requests[1].input)).toMatch(/^https:\/\/storage\.example\.com\/wiseeff-pilot\/\.health\/.+\.txt$/);
    expect(String(requests[2].input)).toBe(String(requests[1].input));
    expect(String(requests[3].input)).toBe(String(requests[1].input));
    expect(String(requests[4].input)).toBe(String(requests[1].input));
  });

  it("exports low-cardinality object store spans without storage keys or credentials", async () => {
    const spans: Parameters<TraceExporter>[0][] = [];
    const objectStore = createObjectStoreFromEnv(
      {
        OBJECT_STORE_MODE: "s3",
        OBJECT_STORE_ROOT: ".wiseeff-object-store",
        OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
        OBJECT_STORAGE_BUCKET: "secret-bucket",
        OBJECT_STORAGE_ACCESS_KEY_ID: "key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
        fetchImpl: async (_input, init) => new Response(init?.method === "GET" ? "wiseeff-s3-health" : null, { status: 200 })
      },
      {
        tracing: createTracingBoundary({
          enabled: true,
          serviceName: "wiseeff-api",
          exporter: (span) => {
            spans.push(span);
          }
        })
      }
    );

    const stored = await objectStore.put({
      organizationId: "org-secret",
      fileName: "customer-fault.log",
      contentType: "text/plain",
      bytes: Buffer.from("private log", "utf8")
    });
    await objectStore.get(stored.storageKey);
    const stream = await objectStore.getStream!(stored.storageKey);
    const streamed: Buffer[] = [];
    for await (const chunk of stream) streamed.push(chunk as Buffer);
    expect(Buffer.concat(streamed).toString()).toBe("wiseeff-s3-health");
    await objectStore.checkHealth();

    expect(spans.map((span) => span.attributes.operation)).toEqual(["put", "get", "getStream", "checkHealth"]);
    expect(spans.map((span) => span.attributes.mode)).toEqual(["s3", "s3", "s3", "s3"]);
    expect(spans.every((span) => span.name === "object_store.operation")).toBe(true);
    expect(JSON.stringify(spans)).not.toContain("secret-bucket");
    expect(JSON.stringify(spans)).not.toContain("org-secret");
    expect(JSON.stringify(spans)).not.toContain("customer-fault");
    expect(JSON.stringify(spans)).not.toContain(stored.storageKey);
    expect(JSON.stringify(spans)).not.toContain("secret");
  });
});

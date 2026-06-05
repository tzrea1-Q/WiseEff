import { describe, expect, it } from "vitest";

import { createTracingBoundary, type TraceExporter } from "./observability/tracing";
import { createObjectStoreFromEnv } from "./objectStoreFactory";

describe("createObjectStoreFromEnv", () => {
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
    await objectStore.checkHealth();

    expect(spans.map((span) => span.attributes.operation)).toEqual(["put", "get", "checkHealth"]);
    expect(spans.map((span) => span.attributes.mode)).toEqual(["s3", "s3", "s3"]);
    expect(spans.every((span) => span.name === "object_store.operation")).toBe(true);
    expect(JSON.stringify(spans)).not.toContain("secret-bucket");
    expect(JSON.stringify(spans)).not.toContain("org-secret");
    expect(JSON.stringify(spans)).not.toContain("customer-fault");
    expect(JSON.stringify(spans)).not.toContain(stored.storageKey);
    expect(JSON.stringify(spans)).not.toContain("secret");
  });
});

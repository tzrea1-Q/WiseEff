import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createHttpObjectStorageTransport,
  createS3ObjectStore,
  type ObjectStorageTransport
} from "./s3ObjectStore";

function createTransport(overrides: Partial<ObjectStorageTransport> = {}) {
  return {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => Buffer.from("wiseeff-s3-health", "utf8")),
    head: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...overrides
  };
}

function createStore(transport: ObjectStorageTransport = createTransport()) {
  return createS3ObjectStore({
    endpoint: "https://storage.example.com",
    bucket: "wiseeff-pilot",
    accessKeyId: "key",
    secretAccessKey: "secret",
    region: "ap-southeast-1",
    transport
  });
}

describe("createS3ObjectStore", () => {
  it("stores objects under organization-scoped keys with checksum metadata", async () => {
    const transport = createTransport();
    const bytes = Buffer.from("fault", "utf8");
    const expectedChecksum = createHash("sha256").update(bytes).digest("hex");

    const stored = await createStore(transport).put({
      organizationId: "org-1",
      fileName: "fault.log",
      contentType: "text/plain",
      bytes
    });

    expect(stored).toEqual({
      storageKey: `org-1/${expectedChecksum}-fault.log`,
      fileName: "fault.log",
      contentType: "text/plain",
      fileSizeBytes: bytes.byteLength,
      checksumSha256: expectedChecksum,
      retentionClass: "pilot-default",
      encryptionMode: "provider-managed"
    });
    expect(transport.put).toHaveBeenCalledWith({
      bucket: "wiseeff-pilot",
      key: stored.storageKey,
      bytes,
      contentType: "text/plain",
      metadata: {
        checksumSha256: expectedChecksum,
        fileSizeBytes: String(bytes.byteLength),
        contentType: "text/plain",
        retentionClass: "pilot-default",
        encryptionMode: "provider-managed"
      }
    });
  });

  it("delegates reads to the transport", async () => {
    const bytes = Buffer.from("from object storage", "utf8");
    const transport = createTransport({
      get: vi.fn(async () => bytes)
    });

    await expect(createStore(transport).get("org-1/checksum-fault.log")).resolves.toEqual(bytes);

    expect(transport.get).toHaveBeenCalledWith({
      bucket: "wiseeff-pilot",
      key: "org-1/checksum-fault.log"
    });
  });

  it("reports ready when the bucket head check succeeds", async () => {
    await expect(createStore().checkHealth()).resolves.toEqual({ ok: true, status: "ready" });
  });

  it("runs a write, read, metadata, and delete compatibility probe for readiness", async () => {
    const probeBytes = Buffer.from("wiseeff-s3-health", "utf8");
    const transport = createTransport({
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => probeBytes),
      head: vi.fn(async (input: { bucket: string; key?: string }) =>
        input.key
          ? {
              ok: true,
              metadata: {
                checksumSha256: createHash("sha256").update(probeBytes).digest("hex"),
                contentType: "text/plain"
              }
            }
          : undefined
      ),
      delete: vi.fn(async () => undefined)
    } as unknown as ObjectStorageTransport);

    await expect(createStore(transport).checkHealth()).resolves.toEqual({ ok: true, status: "ready" });

    expect(transport.put).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "wiseeff-pilot",
        contentType: "text/plain",
        metadata: expect.objectContaining({
          purpose: "health-probe"
        })
      })
    );
    expect(transport.get).toHaveBeenCalledWith(expect.objectContaining({ bucket: "wiseeff-pilot" }));
    expect(transport.head).toHaveBeenCalledWith(expect.objectContaining({ bucket: "wiseeff-pilot", key: expect.any(String) }));
    expect(transport.delete).toHaveBeenCalledWith(expect.objectContaining({ bucket: "wiseeff-pilot", key: expect.any(String) }));
  });

  it("reports failed readiness when the compatibility probe returns a checksum mismatch", async () => {
    const transport = createTransport({
      get: vi.fn(async () => Buffer.from("tampered", "utf8"))
    });

    await expect(createStore(transport).checkHealth()).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "Object storage bucket wiseeff-pilot is not ready: health probe read-back mismatch"
    });
  });

  it("reports failed readiness with actionable messages", async () => {
    const transport = createTransport({
      head: vi.fn(async () => ({ ok: false, error: "bucket missing" }))
    });

    await expect(createStore(transport).checkHealth()).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "Object storage bucket wiseeff-pilot is not ready: bucket missing"
    });
  });

  it.each(["../fault.log", "..\\fault.log", "/tmp/fault.log", "C:\\temp\\fault.log"])(
    "rejects unsafe file name %s",
    async (fileName) => {
      await expect(
        createStore().put({
          organizationId: "org-1",
          fileName,
          contentType: "text/plain",
          bytes: Buffer.from("fault", "utf8")
        })
      ).rejects.toThrow("Unsafe file name");
    }
  );

  it.each(["../org", "..\\org", "/org", "C:\\org"])("rejects unsafe organization id %s", async (organizationId) => {
    await expect(
      createStore().put({
        organizationId,
        fileName: "fault.log",
        contentType: "text/plain",
        bytes: Buffer.from("fault", "utf8")
      })
    ).rejects.toThrow("Unsafe organization id");
  });

  it.each([
    "../outside.log",
    "org-a/../org-b/file.log",
    "org-a/./file.log",
    "org-a//file.log",
    "org-a\\file.log",
    "/outside.log",
    "C:\\outside.log"
  ])(
    "rejects unsafe storage key %s",
    async (storageKey) => {
      await expect(createStore().get(storageKey)).rejects.toThrow("Unsafe storage key");
    }
  );
});

describe("createHttpObjectStorageTransport", () => {
  it("uses S3-compatible path-style URLs, metadata headers, and SigV4 authorization for HEAD, GET, PUT, and DELETE requests", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(init?.method === "GET" ? "stored bytes" : null, { status: 200 });
    });
    const transport = createHttpObjectStorageTransport({
      endpoint: "https://storage.example.com/root/",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
      fetchImpl
    });

    await transport.head({ bucket: "wiseeff-pilot" });
    await transport.head({ bucket: "wiseeff-pilot", key: "org-1/file.log" });
    await expect(transport.get({ bucket: "wiseeff-pilot", key: "org-1/file.log" })).resolves.toEqual(
      Buffer.from("stored bytes", "utf8")
    );
    await transport.put({
      bucket: "wiseeff-pilot",
      key: "org-1/file.log",
      bytes: Buffer.from("stored bytes", "utf8"),
      contentType: "text/plain",
      metadata: {
        checksumSha256: "checksum",
        retentionClass: "pilot-default"
      }
    });
    await transport.delete({ bucket: "wiseeff-pilot", key: "org-1/file.log" });

    expect(calls.map((call) => String(call.input))).toEqual([
      "https://storage.example.com/root/wiseeff-pilot",
      "https://storage.example.com/root/wiseeff-pilot/org-1/file.log",
      "https://storage.example.com/root/wiseeff-pilot/org-1/file.log",
      "https://storage.example.com/root/wiseeff-pilot/org-1/file.log",
      "https://storage.example.com/root/wiseeff-pilot/org-1/file.log"
    ]);
    expect(calls.map((call) => call.init?.method)).toEqual(["HEAD", "HEAD", "GET", "PUT", "DELETE"]);
    expect(calls[2].init?.headers).toMatchObject({
      "x-amz-content-sha256": expect.any(String),
      "x-amz-date": expect.any(String)
    });
    expect(calls[3].init?.headers).toMatchObject({
      "content-type": "text/plain",
      "x-amz-content-sha256": expect.any(String),
      "x-amz-date": expect.any(String),
      "x-amz-meta-checksum-sha256": "checksum",
      "x-amz-meta-retention-class": "pilot-default"
    });
    expect(calls[3].init?.headers).toHaveProperty("authorization", expect.stringContaining("AWS4-HMAC-SHA256"));
  });

  it("includes content and metadata headers in the SigV4 signed headers for PUT requests", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(null, { status: 200 });
    });
    const transport = createHttpObjectStorageTransport({
      endpoint: "https://storage.example.com",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
      fetchImpl
    });
    const bytes = Buffer.from("stored bytes", "utf8");

    await transport.put({
      bucket: "wiseeff-pilot",
      key: "org-1/file.log",
      bytes,
      contentType: "text/plain",
      metadata: {
        checksumSha256: "checksum",
        retentionClass: "pilot-default"
      }
    });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-amz-content-sha256"]).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-checksum-sha256;x-amz-meta-retention-class"
    );
  });

  it.each([
    ["HEAD", async (transport: ObjectStorageTransport) => transport.head({ bucket: "wiseeff-pilot" })],
    ["GET", async (transport: ObjectStorageTransport) => transport.get({ bucket: "wiseeff-pilot", key: "org-1/file.log" })],
    [
      "PUT",
      async (transport: ObjectStorageTransport) =>
        transport.put({
          bucket: "wiseeff-pilot",
          key: "org-1/file.log",
          bytes: Buffer.from("stored bytes", "utf8"),
          contentType: "text/plain",
          metadata: {}
        })
    ]
  ])("returns actionable errors for non-2xx %s responses", async (_method, operation) => {
    const transport = createHttpObjectStorageTransport({
      endpoint: "https://storage.example.com",
      accessKeyId: "key",
      secretAccessKey: "secret",
      fetchImpl: vi.fn(async () => new Response("denied", { status: 403, statusText: "Forbidden" }))
    });

    await expect(operation(transport)).rejects.toThrow("Object storage HTTP request failed with 403 Forbidden: denied");
  });

  it("is used by default when no fake transport is provided", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      new Response(init?.method === "GET" ? "wiseeff-s3-health" : null, { status: 200 })
    );
    const store = createS3ObjectStore({
      endpoint: "https://storage.example.com",
      bucket: "wiseeff-pilot",
      accessKeyId: "key",
      secretAccessKey: "secret",
      transport: undefined,
      fetchImpl
    });

    await expect(store.checkHealth()).resolves.toEqual({ ok: true, status: "ready" });
    expect(fetchImpl).toHaveBeenCalledWith("https://storage.example.com/wiseeff-pilot", expect.objectContaining({ method: "HEAD" }));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("https://storage.example.com/wiseeff-pilot/.health/"), expect.objectContaining({ method: "PUT" }));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("https://storage.example.com/wiseeff-pilot/.health/"), expect.objectContaining({ method: "GET" }));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("https://storage.example.com/wiseeff-pilot/.health/"), expect.objectContaining({ method: "DELETE" }));
  });
});

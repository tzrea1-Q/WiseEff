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
    get: vi.fn(async () => Buffer.from("stored bytes", "utf8")),
    head: vi.fn(async () => undefined),
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
  it("uses endpoint, bucket, and key for HEAD, GET, and PUT requests", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(init?.method === "GET" ? "stored bytes" : null, { status: 200 });
    });
    const transport = createHttpObjectStorageTransport({
      endpoint: "https://storage.example.com/root/",
      accessKeyId: "key",
      secretAccessKey: "secret",
      fetchImpl
    });

    await transport.head({ bucket: "wiseeff-pilot" });
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

    expect(calls.map((call) => String(call.input))).toEqual([
      "https://storage.example.com/root/wiseeff-pilot",
      "https://storage.example.com/root/wiseeff-pilot/org-1/file.log",
      "https://storage.example.com/root/wiseeff-pilot/org-1/file.log"
    ]);
    expect(calls.map((call) => call.init?.method)).toEqual(["HEAD", "GET", "PUT"]);
    expect(calls[2].init?.headers).toMatchObject({
      "content-type": "text/plain",
      "x-wiseeff-access-key-id": "key",
      "x-wiseeff-meta-checksum-sha256": "checksum",
      "x-wiseeff-meta-retention-class": "pilot-default"
    });
    expect(calls[2].init?.headers).toHaveProperty("x-wiseeff-signature");
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
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
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
  });
});

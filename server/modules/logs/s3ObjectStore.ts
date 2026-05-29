import { createHash, createHmac } from "node:crypto";
import path from "node:path";

import {
  rejectUnsafeStorageKey,
  sanitizeFileName,
  sanitizePathSegment,
  type ObjectStore,
  type ObjectStoreHealthCheck
} from "./objectStore";

export type ObjectStoragePutInput = {
  bucket: string;
  key: string;
  bytes: Buffer;
  contentType: string;
  metadata: Record<string, string>;
};

export type ObjectStorageTransport = {
  put(input: ObjectStoragePutInput): Promise<void>;
  get(input: { bucket: string; key: string }): Promise<Buffer>;
  head(input: { bucket: string }): Promise<void | { ok: boolean; error?: string }>;
};

export type ObjectStorageFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type S3ObjectStoreOptions = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  retentionClass?: string;
  encryptionMode?: string;
  transport?: ObjectStorageTransport;
  fetchImpl?: ObjectStorageFetch;
};

function requireNonBlank(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}

function storageUrl(endpoint: string, bucket: string, key?: string) {
  const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  const encodedSegments = [bucket, ...(key ? key.split("/") : [])].map(encodeURIComponent);
  return new URL(encodedSegments.join("/"), base).toString();
}

function headerNameForMetadata(key: string) {
  return `x-wiseeff-meta-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

async function assertOk(response: Response) {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  const detail = body.trim() ? `: ${body.trim()}` : "";
  throw new Error(`Object storage HTTP request failed with ${response.status} ${response.statusText}${detail}`);
}

function signedHeaders(input: {
  method: string;
  url: string;
  accessKeyId: string;
  secretAccessKey: string;
  body?: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}) {
  const bodyHash = input.body ? createHash("sha256").update(input.body).digest("hex") : "";
  const signature = createHmac("sha256", input.secretAccessKey)
    .update([input.method, input.url, bodyHash].join("\n"))
    .digest("hex");
  const headers: Record<string, string> = {
    "x-wiseeff-access-key-id": input.accessKeyId,
    "x-wiseeff-signature": signature
  };

  if (input.contentType) {
    headers["content-type"] = input.contentType;
  }

  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    headers[headerNameForMetadata(key)] = value;
  }

  return headers;
}

export function createHttpObjectStorageTransport(options: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetchImpl?: ObjectStorageFetch;
}): ObjectStorageTransport {
  requireNonBlank(options.endpoint, "OBJECT_STORAGE_ENDPOINT");
  requireNonBlank(options.accessKeyId, "OBJECT_STORAGE_ACCESS_KEY_ID");
  requireNonBlank(options.secretAccessKey, "OBJECT_STORAGE_SECRET_ACCESS_KEY");

  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async head(input) {
      const url = storageUrl(options.endpoint, input.bucket);
      const response = await fetchImpl(url, {
        method: "HEAD",
        headers: signedHeaders({
          method: "HEAD",
          url,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey
        })
      });
      await assertOk(response);
    },

    async get(input) {
      rejectUnsafeStorageKey(input.key);
      const url = storageUrl(options.endpoint, input.bucket, input.key);
      const response = await fetchImpl(url, {
        method: "GET",
        headers: signedHeaders({
          method: "GET",
          url,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey
        })
      });
      await assertOk(response);
      return Buffer.from(await response.arrayBuffer());
    },

    async put(input) {
      rejectUnsafeStorageKey(input.key);
      const url = storageUrl(options.endpoint, input.bucket, input.key);
      const response = await fetchImpl(url, {
        method: "PUT",
        body: input.bytes,
        headers: signedHeaders({
          method: "PUT",
          url,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
          body: input.bytes,
          contentType: input.contentType,
          metadata: input.metadata
        })
      });
      await assertOk(response);
    }
  };
}

export function createS3ObjectStore(options: S3ObjectStoreOptions): ObjectStore & ObjectStoreHealthCheck {
  requireNonBlank(options.endpoint, "OBJECT_STORAGE_ENDPOINT");
  requireNonBlank(options.bucket, "OBJECT_STORAGE_BUCKET");
  requireNonBlank(options.accessKeyId, "OBJECT_STORAGE_ACCESS_KEY_ID");
  requireNonBlank(options.secretAccessKey, "OBJECT_STORAGE_SECRET_ACCESS_KEY");

  const transport =
    options.transport ??
    createHttpObjectStorageTransport({
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      fetchImpl: options.fetchImpl
    });
  const retentionClass = options.retentionClass ?? "pilot-default";
  const encryptionMode = options.encryptionMode ?? "provider-managed";

  return {
    async put(input) {
      const organizationId = sanitizePathSegment(input.organizationId, "organization id");
      const fileName = sanitizeFileName(input.fileName);
      const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = path.posix.join(organizationId, `${checksumSha256}-${fileName}`);

      await transport.put({
        bucket: options.bucket,
        key: storageKey,
        bytes: input.bytes,
        contentType: input.contentType,
        metadata: {
          checksumSha256,
          fileSizeBytes: String(input.bytes.byteLength),
          contentType: input.contentType,
          retentionClass,
          encryptionMode
        }
      });

      return {
        storageKey,
        fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256,
        retentionClass,
        encryptionMode
      };
    },

    async get(storageKey) {
      rejectUnsafeStorageKey(storageKey);
      return transport.get({ bucket: options.bucket, key: storageKey });
    },

    async checkHealth() {
      try {
        const result = await transport.head({ bucket: options.bucket });
        if (result && !result.ok) {
          return {
            ok: false,
            status: "failed",
            message: `Object storage bucket ${options.bucket} is not ready: ${result.error ?? "head check failed"}`
          };
        }
        return { ok: true, status: "ready" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Object storage bucket head check failed.";
        return {
          ok: false,
          status: "failed",
          message: `Object storage bucket ${options.bucket} is not ready: ${message}`
        };
      }
    }
  };
}

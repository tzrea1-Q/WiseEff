import { createHash, createHmac, randomUUID } from "node:crypto";
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
  head(input: { bucket: string; key?: string }): Promise<void | { ok: boolean; error?: string; metadata?: Record<string, string> }>;
  delete(input: { bucket: string; key: string }): Promise<void>;
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
  return `x-amz-meta-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function normalizeHeaderValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function canonicalUri(url: URL) {
  return url.pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function signingKey(secretAccessKey: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, date);
  const dateRegionKey = hmac(dateKey, region);
  const dateRegionServiceKey = hmac(dateRegionKey, "s3");
  return hmac(dateRegionServiceKey, "aws4_request");
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
  region?: string;
  body?: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}) {
  const bodyHash = sha256Hex(input.body ?? "");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const region = input.region ?? "us-east-1";
  const credentialScope = `${amzDate.slice(0, 8)}/${input.region ?? "us-east-1"}/s3/aws4_request`;
  const parsedUrl = new URL(input.url);
  const headers: Record<string, string> = {
    host: parsedUrl.host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate
  };

  if (input.contentType) {
    headers["content-type"] = input.contentType;
  }

  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    headers[headerNameForMetadata(key)] = value;
  }

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${normalizeHeaderValue(headers[name])}\n`).join("");
  const signedHeaderList = signedHeaderNames.join(";");
  const canonicalRequest = [
    input.method,
    canonicalUri(parsedUrl),
    parsedUrl.searchParams.toString(),
    canonicalHeaders,
    signedHeaderList,
    bodyHash
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmacHex(signingKey(input.secretAccessKey, date, region), stringToSign);

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;
  delete headers.host;

  return headers;
}

export function createHttpObjectStorageTransport(options: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  fetchImpl?: ObjectStorageFetch;
}): ObjectStorageTransport {
  requireNonBlank(options.endpoint, "OBJECT_STORAGE_ENDPOINT");
  requireNonBlank(options.accessKeyId, "OBJECT_STORAGE_ACCESS_KEY_ID");
  requireNonBlank(options.secretAccessKey, "OBJECT_STORAGE_SECRET_ACCESS_KEY");

  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async head(input) {
      const url = storageUrl(options.endpoint, input.bucket, input.key);
      const response = await fetchImpl(url, {
        method: "HEAD",
        headers: signedHeaders({
          method: "HEAD",
          url,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
          region: options.region
        })
      });
      await assertOk(response);
      const metadata: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (key.toLowerCase().startsWith("x-amz-meta-")) {
          const metadataKey = key.slice("x-amz-meta-".length).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
          metadata[metadataKey] = value;
        }
      });
      return Object.keys(metadata).length ? { ok: true, metadata } : undefined;
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
          secretAccessKey: options.secretAccessKey,
          region: options.region
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
          region: options.region,
          body: input.bytes,
          contentType: input.contentType,
          metadata: input.metadata
        })
      });
      await assertOk(response);
    },

    async delete(input) {
      rejectUnsafeStorageKey(input.key);
      const url = storageUrl(options.endpoint, input.bucket, input.key);
      const response = await fetchImpl(url, {
        method: "DELETE",
        headers: signedHeaders({
          method: "DELETE",
          url,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
          region: options.region
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
      region: options.region,
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
      const probeBytes = Buffer.from("wiseeff-s3-health", "utf8");
      const checksumSha256 = createHash("sha256").update(probeBytes).digest("hex");
      const probeKey = path.posix.join(".health", `${randomUUID()}.txt`);
      try {
        const bucketHead = await transport.head({ bucket: options.bucket });
        if (bucketHead && !bucketHead.ok) {
          return {
            ok: false,
            status: "failed",
            message: `Object storage bucket ${options.bucket} is not ready: ${bucketHead.error ?? "bucket head check failed"}`
          };
        }
        await transport.put({
          bucket: options.bucket,
          key: probeKey,
          bytes: probeBytes,
          contentType: "text/plain",
          metadata: {
            checksumSha256,
            contentType: "text/plain",
            purpose: "health-probe"
          }
        });
        const objectHead = await transport.head({ bucket: options.bucket, key: probeKey });
        if (objectHead && !objectHead.ok) {
          return {
            ok: false,
            status: "failed",
            message: `Object storage bucket ${options.bucket} is not ready: ${objectHead.error ?? "health object head check failed"}`
          };
        }
        const readBack = await transport.get({ bucket: options.bucket, key: probeKey });
        if (createHash("sha256").update(readBack).digest("hex") !== checksumSha256) {
          return {
            ok: false,
            status: "failed",
            message: `Object storage bucket ${options.bucket} is not ready: health probe read-back mismatch`
          };
        }
        const observedChecksum = objectHead?.metadata?.checksumSha256;
        if (observedChecksum && observedChecksum !== checksumSha256) {
          return {
            ok: false,
            status: "failed",
            message: `Object storage bucket ${options.bucket} is not ready: health probe metadata checksum mismatch`
          };
        }
        await transport.delete({ bucket: options.bucket, key: probeKey });
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

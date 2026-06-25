import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import { ApiError, serializeApiError } from "./errors";
import type { HttpMethod, RouteRequest, RouteResponse } from "./router";

const allowedCorsOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
const allowedLocalFrontendPorts = { min: 5173, max: 5199 };
const corsMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const defaultCorsHeaders = "accept,content-type,x-request-id,x-wiseeff-user";

export type RawBody = {
  kind: "raw";
  contentType: string;
  bytes: Buffer;
};

export type MultipartBody = {
  kind: "multipart";
  fields: Record<string, string>;
  files: Array<{ fieldName: string; fileName: string; contentType: string; bytes: Buffer }>;
};

async function readRequestBytes(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function getContentType(request: IncomingMessage) {
  const contentType = request.headers["content-type"];
  return (Array.isArray(contentType) ? contentType[0] : contentType)?.split(";")[0].trim().toLowerCase() ?? "";
}

function getContentTypeHeader(request: IncomingMessage) {
  const contentType = request.headers["content-type"];
  return Array.isArray(contentType) ? contentType[0] : contentType ?? "";
}

function getMultipartBoundary(contentTypeHeader: string) {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  return match?.[1] ?? match?.[2]?.trim();
}

function parsePartHeaders(headerBlock: string) {
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split("\r\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    headers[line.slice(0, separatorIndex).trim().toLowerCase()] = line.slice(separatorIndex + 1).trim();
  }
  return headers;
}

function parseContentDisposition(value: string | undefined) {
  const disposition: Record<string, string> = {};
  for (const part of value?.split(";") ?? []) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (!rawKey || rawValueParts.length === 0) {
      continue;
    }
    disposition[rawKey.toLowerCase()] = rawValueParts.join("=").trim().replace(/^"|"$/g, "");
  }
  return disposition;
}

function parseMultipartBody(bytes: Buffer, boundary: string): MultipartBody {
  const fields: Record<string, string> = {};
  const files: MultipartBody["files"] = [];
  const marker = `--${boundary}`;
  const body = bytes.toString("binary");

  for (const rawPart of body.split(marker).slice(1, -1)) {
    const part = rawPart.startsWith("\r\n") ? rawPart.slice(2) : rawPart;
    const headerEndIndex = part.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) {
      continue;
    }

    const headers = parsePartHeaders(part.slice(0, headerEndIndex));
    const disposition = parseContentDisposition(headers["content-disposition"]);
    const fieldName = disposition.name;
    if (!fieldName) {
      continue;
    }

    let content = part.slice(headerEndIndex + 4);
    if (content.endsWith("\r\n")) {
      content = content.slice(0, -2);
    }

    const contentBytes = Buffer.from(content, "binary");
    if (disposition.filename !== undefined) {
      files.push({
        fieldName,
        fileName: disposition.filename,
        contentType: headers["content-type"] ?? "application/octet-stream",
        bytes: contentBytes
      });
    } else {
      fields[fieldName] = contentBytes.toString("utf8");
    }
  }

  return { kind: "multipart", fields, files };
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "DELETE") {
    return undefined;
  }

  const bytes = await readRequestBytes(request);
  if (bytes.length === 0) {
    return undefined;
  }

  const contentType = getContentType(request);
  if (contentType === "multipart/form-data") {
    const boundary = getMultipartBoundary(getContentTypeHeader(request));
    if (!boundary) {
      throw new ApiError("VALIDATION_FAILED", "Multipart boundary is required.", 400);
    }
    return parseMultipartBody(bytes, boundary);
  }

  if (contentType === "text/plain" || contentType === "text/csv" || contentType === "application/octet-stream") {
    return { kind: "raw", contentType, bytes } satisfies RawBody;
  }

  return JSON.parse(bytes.toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, contentType: string, text: string) {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.end(text);
}

async function sendSse(response: ServerResponse, events: AsyncIterable<{ event: string; data: unknown }>) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");

  try {
    for await (const event of events) {
      response.write(`event: ${event.event}\n`);
      response.write(`data: ${JSON.stringify(event.data)}\n\n`);
    }
  } catch (error) {
    response.write("event: error\n");
    response.write(
      `data: ${JSON.stringify({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Stream failed."
      })}\n\n`
    );
  }

  response.end();
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin) || !isAllowedCorsOrigin(origin)) {
    return;
  }

  const requestedHeaders = request.headers["access-control-request-headers"];
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", corsMethods);
  response.setHeader(
    "Access-Control-Allow-Headers",
    typeof requestedHeaders === "string" && requestedHeaders.trim() ? requestedHeaders : defaultCorsHeaders
  );
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin, Access-Control-Request-Headers");
}

function isAllowedCorsOrigin(origin: string) {
  if (allowedCorsOrigins.has(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const port = Number(url.port);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
      Number.isInteger(port) &&
      port >= allowedLocalFrontendPorts.min &&
      port <= allowedLocalFrontendPorts.max
    );
  } catch {
    return false;
  }
}

function getErrorStatus(error: unknown) {
  if (error instanceof Error && "status" in error) {
    const status = Number(error.status);
    if (Number.isFinite(status)) {
      return status;
    }
  }

  return 500;
}

function parseQuery(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (Array.isArray(existing)) {
      query[key] = [...existing, value];
    } else if (existing !== undefined) {
      query[key] = [existing, value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

export function createHttpServer(
  router: { handle(request: RouteRequest): Promise<RouteResponse>; matchRoutePattern?: (method: HttpMethod, path: string) => string | undefined },
  options: { metrics?: MetricsRegistry; tracing?: Pick<TracingBoundary, "withSpan"> } = {}
) {
  return createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.setHeader("X-Request-Id", requestId);
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method as HttpMethod;
      const route = router.matchRoutePattern?.(method, url.pathname) ?? url.pathname;
      const spanAttributes: Record<string, string | number | boolean> = {
        method: request.method ?? "GET",
        route,
        requestId
      };
      const handleRequest = async () => {
        try {
          const routeResponse = await router.handle({
            method: request.method as HttpMethod,
            path: url.pathname,
            params: {},
            query: parseQuery(url.searchParams),
            headers: request.headers,
            requestId,
            body: await readBody(request)
          });
          spanAttributes.status = routeResponse.status;
          return routeResponse;
        } catch (error) {
          spanAttributes.status = getErrorStatus(error);
          spanAttributes.errorType = error instanceof Error ? error.name : "unknown";
          throw error;
        }
      };
      const routeResponse = options.tracing
        ? await options.tracing.withSpan("api.request", spanAttributes, handleRequest)
        : await handleRequest();

      response.setHeader("X-Request-Id", requestId);
      if ("sse" in routeResponse) {
        await sendSse(response, routeResponse.sse);
      } else if ("bytes" in routeResponse) {
        response.statusCode = routeResponse.status;
        response.setHeader("Content-Type", routeResponse.contentType);
        if (routeResponse.fileName) {
          response.setHeader("Content-Disposition", `attachment; filename="${routeResponse.fileName}"`);
        }
        response.end(routeResponse.bytes);
      } else if ("text" in routeResponse) {
        sendText(response, routeResponse.status, routeResponse.contentType, routeResponse.text);
      } else {
        sendJson(response, routeResponse.status, routeResponse.body);
      }
      options.metrics?.recordHttpRequest({
        method: request.method ?? "GET",
        route,
        status: routeResponse.status,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.setHeader("X-Request-Id", requestId);
      const status = getErrorStatus(error);
      sendJson(response, status, serializeApiError(error, requestId));
      try {
        const url = new URL(request.url ?? "/", "http://localhost");
        const method = request.method as HttpMethod;
        options.metrics?.recordHttpRequest({
          method: request.method ?? "GET",
          route: router.matchRoutePattern?.(method, url.pathname) ?? url.pathname,
          status,
          durationMs: Date.now() - startedAt
        });
      } catch {
        options.metrics?.recordHttpRequest({
          method: request.method ?? "GET",
          route: "/unknown",
          status,
          durationMs: Date.now() - startedAt
        });
      }
    }
  });
}

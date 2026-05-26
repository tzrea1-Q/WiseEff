import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { serializeApiError } from "./errors";
import type { HttpMethod, RouteRequest, RouteResponse } from "./router";

const allowedCorsOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
const corsMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const defaultCorsHeaders = "accept,content-type,x-request-id,x-wiseeff-user";

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "DELETE") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin) || !allowedCorsOrigins.has(origin)) {
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

export function createHttpServer(router: { handle(request: RouteRequest): Promise<RouteResponse> }) {
  return createServer(async (request, response) => {
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const routeResponse = await router.handle({
        method: request.method as HttpMethod,
        path: url.pathname,
        params: {},
        query: parseQuery(url.searchParams),
        headers: request.headers,
        requestId,
        body: await readJsonBody(request)
      });

      response.setHeader("X-Request-Id", requestId);
      sendJson(response, routeResponse.status, routeResponse.body);
    } catch (error) {
      response.setHeader("X-Request-Id", requestId);
      sendJson(response, getErrorStatus(error), serializeApiError(error, requestId));
    }
  });
}

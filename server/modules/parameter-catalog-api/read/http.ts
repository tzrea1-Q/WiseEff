import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { notFound } from "./errors";
import { handleCatalogRead } from "./handlers";
import type { CatalogReadPorts, CatalogReadRequest } from "./types";

function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
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

function headersFrom(request: IncomingMessage): Record<string, string | string[] | undefined> {
  return { ...request.headers };
}

export function createCatalogReadHttpServer(ports: CatalogReadPorts): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const catalogRequest: CatalogReadRequest = {
        method: "GET",
        path: url.pathname,
        params: {},
        query: parseQuery(url.searchParams),
        headers: headersFrom(request),
        requestId,
      };
      const result =
        request.method === "GET"
          ? await handleCatalogRead(ports, catalogRequest)
          : notFound(requestId, "definition-not-found");
      response.statusCode = result.status;
      response.setHeader("Content-Type", "application/json");
      for (const [name, value] of Object.entries(result.headers)) {
        response.setHeader(name, value);
      }
      if (!result.headers["X-Request-Id"]) {
        response.setHeader("X-Request-Id", requestId);
      }
      response.end(JSON.stringify(result.body));
    } catch {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.setHeader("X-Request-Id", requestId);
      response.end(
        JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
            details: {},
            requestId,
          },
        }),
      );
    }
  });
}

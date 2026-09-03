import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { serializeApiError } from "../../../shared/http/errors";
import type { HttpMethod } from "../../../shared/http/router";

import { handleCatalogGovernance } from "./handlers";
import type { CatalogGovernancePorts, CatalogGovernanceRequest } from "./types";

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function parseQuery(searchParams: URLSearchParams): CatalogGovernanceRequest["query"] {
  const query: CatalogGovernanceRequest["query"] = {};
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

export function createCatalogGovernanceHttpServer(ports: CatalogGovernancePorts): Server {
  return createServer(async (request, response) => {
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const result = await handleCatalogGovernance(ports, {
        method: (request.method ?? "GET") as HttpMethod,
        path: url.pathname,
        params: {},
        query: parseQuery(url.searchParams),
        headers: request.headers,
        requestId,
        body: await readJsonBody(request),
      });
      for (const [name, value] of Object.entries(result.headers)) {
        response.setHeader(name, value);
      }
      if (!result.headers["X-Request-Id"]) {
        response.setHeader("X-Request-Id", requestId);
      }
      response.setHeader("Content-Type", "application/json");
      response.statusCode = result.status;
      response.end(JSON.stringify(result.body));
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.setHeader("X-Request-Id", requestId);
      response.setHeader("Content-Type", "application/json");
      response.statusCode = 500;
      response.end(JSON.stringify(serializeApiError(error, requestId)));
    }
  });
}

export async function listenCatalogGovernanceHttpServer(
  ports: CatalogGovernancePorts,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createCatalogGovernanceHttpServer(ports);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

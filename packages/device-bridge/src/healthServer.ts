import { createServer } from "node:http";

import type { BridgeHealthState } from "./healthState";

export type { BridgeHealthState, ToolProbeCache, ToolsInstallStatus } from "./healthState";
export { createToolProbeCache, parseToolProbeResult, parseToolsInstallStatus } from "./healthState";

export type HealthServer = {
  url: string;
  close: () => Promise<void>;
};

function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function normalizeCorsOrigin(raw: string) {
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function corsOriginHost(raw: string) {
  return new URL(raw).hostname.toLowerCase();
}

function listAllowedOrigins(allowedOrigin?: string | string[]) {
  if (!allowedOrigin) {
    return [];
  }
  return (Array.isArray(allowedOrigin) ? allowedOrigin : [allowedOrigin]).filter(Boolean);
}

export function resolveCorsOrigin(origin: string | undefined, allowedOrigin?: string | string[]) {
  if (!origin) {
    return undefined;
  }
  if (isLoopbackOrigin(origin)) {
    return origin;
  }

  const normalizedOrigin = normalizeCorsOrigin(origin);
  for (const allowed of listAllowedOrigins(allowedOrigin)) {
    if (normalizeCorsOrigin(allowed) === normalizedOrigin) {
      return origin;
    }
    if (corsOriginHost(allowed) === corsOriginHost(origin)) {
      return origin;
    }
  }
  return undefined;
}

function applyCorsHeaders(res: import("node:http").ServerResponse, origin: string | undefined, allowedOrigin?: string | string[]) {
  const corsOrigin = resolveCorsOrigin(origin, allowedOrigin);
  if (!corsOrigin) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Vary", "Origin");
}

function applyOpenCorsHeaders(res: import("node:http").ServerResponse, origin: string | undefined) {
  if (!origin) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}

function applyPrivateNetworkAccess(res: import("node:http").ServerResponse, req: import("node:http").IncomingMessage) {
  const requestPrivateNetwork = req.headers["access-control-request-private-network"];
  if (requestPrivateNetwork === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

export function startHealthServer(input: {
  getState: () => BridgeHealthState;
  host?: string;
  port?: number;
  onHealthRead?: () => void | Promise<void>;
  onToolsInstall?: (protocol: "adb" | "hdc" | "all") => void | Promise<void>;
  allowedOrigin?: string | string[];
}): Promise<HealthServer> {
  const host = input.host ?? "127.0.0.1";
  const port = input.port ?? 18_787;

  const server = createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
      const origin = req.headers.origin;

      if (req.method === "OPTIONS" && (requestUrl.pathname === "/tools/install" || requestUrl.pathname === "/health")) {
        res.statusCode = 204;
        if (requestUrl.pathname === "/tools/install") {
          applyCorsHeaders(res, origin, input.allowedOrigin);
          res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "content-type");
        } else {
          applyOpenCorsHeaders(res, origin);
          applyPrivateNetworkAccess(res, req);
          res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        }
        res.end();
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/tools/install") {
        applyCorsHeaders(res, origin, input.allowedOrigin);
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
        }
        const parsed = JSON.parse(body || "{}") as { protocol?: string };
        const protocol =
          parsed.protocol === "adb" || parsed.protocol === "hdc" || parsed.protocol === "all"
            ? parsed.protocol
            : "all";
        await input.onToolsInstall?.(protocol);
        res.statusCode = 202;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(`${JSON.stringify({ ok: true, accepted: true, protocol })}\n`);
        return;
      }

      if (req.method === "GET" && requestUrl.pathname === "/health") {
        await input.onHealthRead?.();
        const payload = { ok: true, ...input.getState() };
        res.statusCode = 200;
        applyOpenCorsHeaders(res, origin);
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(`${JSON.stringify(payload)}\n`);
        return;
      }

      res.statusCode = 404;
      res.end("Not Found");
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = address && typeof address === "object" ? address.port : port;
      resolve({
        url: `http://${host}:${actualPort}/health`,
        close: async () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.closeAllConnections?.();
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          })
      });
    });
  });
}

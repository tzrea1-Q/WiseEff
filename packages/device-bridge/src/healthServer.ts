import { createServer } from "node:http";

import type { BridgeHealthState } from "./healthState";

export type { BridgeHealthState, ToolProbeCache, ToolsInstallStatus } from "./healthState";
export { createToolProbeCache, parseToolProbeResult, parseToolsInstallStatus } from "./healthState";

export type HealthServer = {
  url: string;
  close: () => Promise<void>;
};

export function startHealthServer(input: {
  getState: () => BridgeHealthState;
  host?: string;
  port?: number;
  onHealthRead?: () => void | Promise<void>;
  onToolsInstall?: (protocol: "adb" | "hdc" | "all") => void | Promise<void>;
  allowedOrigin?: string;
}): Promise<HealthServer> {
  const host = input.host ?? "127.0.0.1";
  const port = input.port ?? 18_787;

  const server = createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
      const origin = req.headers.origin;
      const allowOrigin = input.allowedOrigin && origin === input.allowedOrigin ? origin : undefined;

      if (req.method === "OPTIONS" && requestUrl.pathname === "/tools/install") {
        res.statusCode = 204;
        if (allowOrigin) {
          res.setHeader("Access-Control-Allow-Origin", allowOrigin);
          res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "content-type");
        }
        res.end();
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/tools/install") {
        if (allowOrigin) {
          res.setHeader("Access-Control-Allow-Origin", allowOrigin);
        }
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
      resolve({
        url: `http://${host}:${port}/health`,
        close: async () =>
          new Promise<void>((closeResolve, closeReject) => {
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

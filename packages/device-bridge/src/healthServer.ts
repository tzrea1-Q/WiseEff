import { createServer } from "node:http";

export type BridgeHealthState = {
  paired: boolean;
  connected: boolean;
  bridgeId?: string;
  serverUrl?: string;
  lastError?: string;
  updatedAt: string;
};

export type HealthServer = {
  url: string;
  close: () => Promise<void>;
};

export function startHealthServer(input: {
  getState: () => BridgeHealthState;
  host?: string;
  port?: number;
}): Promise<HealthServer> {
  const host = input.host ?? "127.0.0.1";
  const port = input.port ?? 18_787;

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (req.method === "GET" && requestUrl.pathname === "/health") {
      const payload = { ok: true, ...input.getState() };
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(`${JSON.stringify(payload)}\n`);
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
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

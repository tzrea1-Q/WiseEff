import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

function powerManagementConfigWriter(): Plugin {
  return {
    name: "power-management-config-writer",
    configureServer(server) {
      server.middlewares.use("/api/power-management-config", (req, res) => {
        const request = req as unknown as {
          method?: string;
          setEncoding(encoding: string): void;
          on(event: "data", callback: (chunk: string) => void): void;
          on(event: "end", callback: () => void): void;
        };

        if (request.method !== "PUT") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }

        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", async () => {
          try {
            JSON.parse(body);
            const configPath = path.resolve(server.config.root, "src/config/power-management.json");
            await fs.writeFile(configPath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Invalid config" }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), powerManagementConfigWriter()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});

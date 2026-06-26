import { configDefaults, defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { hdcApiBridge } from "./viteHdcApi";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isNestedWorktree = /[\\/]\.worktrees[\\/]/.test(projectRoot);
const siblingWorktreeExclude = isNestedWorktree ? [] : [".worktrees/**"];

function resolvePreviewAllowedHosts(): string[] | true {
  const configured = process.env.VITE_WISEEFF_ALLOWED_HOSTS?.split(",").map((value) => value.trim()).filter(Boolean);
  if (configured?.length) {
    return configured;
  }

  const apiBase = process.env.VITE_WISEEFF_API_BASE_URL?.trim();
  if (!apiBase) {
    return ["127.0.0.1", "localhost"];
  }

  try {
    const hostname = new URL(apiBase).hostname;
    const hosts = new Set(["127.0.0.1", "localhost", hostname]);
    if (hostname.startsWith("www.")) {
      hosts.add(hostname.slice(4));
    } else {
      hosts.add(`www.${hostname}`);
    }
    return [...hosts];
  } catch {
    return true;
  }
}

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
  plugins: [react(), tailwindcss(), powerManagementConfigWriter(), hdcApiBridge()],
  preview: {
    host: "0.0.0.0",
    allowedHosts: resolvePreviewAllowedHosts()
  },
  server: {
    proxy: {
      "/downloads": {
        target: process.env.VITE_WISEEFF_API_BASE_URL?.trim() || "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/local-bridge": {
        target: "http://127.0.0.1:18787",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/local-bridge/, "")
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "./src")
    }
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, ...siblingWorktreeExclude, "e2e/**"],
    setupFiles: "./src/test/setup.ts"
  }
});

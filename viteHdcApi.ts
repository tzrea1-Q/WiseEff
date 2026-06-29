import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parseHdcTargets } from "@wiseeff/device-command-core/hdcTargets";

type HdcCommandResult = {
  command: string[];
  returncode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const detectTimeoutMs = 5_000;
const commandTimeoutMs = 10_000;

export function parseTargets(stdout: string) {
  return parseHdcTargets(stdout).map((target) => target.targetRef);
}

export function validateNodePath(nodePath: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof nodePath !== "string" || nodePath.trim() === "") {
    return { ok: false, error: "nodePath is required" };
  }
  if (!nodePath.startsWith("/")) {
    return { ok: false, error: "nodePath must start with /" };
  }
  return { ok: true };
}

export function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildReadShellCommand(nodePath: string) {
  return `cat ${quoteShellArg(nodePath)}`;
}

export function buildWriteShellCommand(nodePath: string, value: string) {
  return `printf '%s' ${quoteShellArg(value)} > ${quoteShellArg(nodePath)}`;
}

function readJsonBody(req: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function executeFile(command: string, args: string[], timeout: number): Promise<HdcCommandResult> {
  const started = Date.now();

  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: "utf8", timeout, windowsHide: true },
      (error, stdout, stderr) => {
        const maybeError = error as NodeJS.ErrnoException | null;
        const numericCode = typeof maybeError?.code === "number" ? maybeError.code : undefined;

        resolve({
          command: [command, ...args],
          returncode: numericCode ?? (maybeError ? 1 : 0),
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? maybeError?.message ?? ""),
          durationMs: Date.now() - started
        });
      }
    );
  });
}

async function runHdcShell(target: string | undefined, shellCommand: string) {
  const args = target ? ["-t", target, "shell", shellCommand] : ["shell", shellCommand];
  return executeFile("hdc", args, commandTimeoutMs);
}

export function hdcApiBridge(): Plugin {
  return {
    name: "hdc-api-bridge",
    configureServer(server) {
      server.middlewares.use("/api/hdc/targets", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        const result = await executeFile("hdc", ["list", "targets"], detectTimeoutMs);
        const targets = result.returncode === 0 ? parseTargets(result.stdout) : [];

        sendJson(res, 200, {
          ok: result.returncode === 0 && targets.length > 0,
          targets,
          activeTarget: targets[0],
          error: result.returncode === 0 ? undefined : result.stderr || "hdc target detection failed",
          stderr: result.stderr
        });
      });

      server.middlewares.use("/api/hdc/read-node", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const validation = validateNodePath(body.nodePath);
          if (!validation.ok) {
            sendJson(res, 400, { ok: false, error: validation.error });
            return;
          }

          const nodePath = String(body.nodePath);
          const result = await runHdcShell(
            typeof body.target === "string" ? body.target : undefined,
            buildReadShellCommand(nodePath)
          );

          sendJson(res, 200, {
            ok: result.returncode === 0,
            ...result,
            value: result.stdout.trim()
          });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid request" });
        }
      });

      server.middlewares.use("/api/hdc/write-node", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const validation = validateNodePath(body.nodePath);
          if (!validation.ok) {
            sendJson(res, 400, { ok: false, error: validation.error });
            return;
          }

          const nodePath = String(body.nodePath);
          const target = typeof body.target === "string" ? body.target : undefined;
          const value = String(body.value ?? "");
          const writeResult = await runHdcShell(target, buildWriteShellCommand(nodePath, value));
          const readResult = body.readBack === true && writeResult.returncode === 0
            ? await runHdcShell(target, buildReadShellCommand(nodePath))
            : undefined;
          const readValue = readResult?.stdout.trim();

          sendJson(res, 200, {
            ok: writeResult.returncode === 0 && (!readResult || readResult.returncode === 0),
            writeResult,
            readResult,
            value: readValue,
            verified: readResult ? readValue === value : undefined
          });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid request" });
        }
      });
    }
  };
}

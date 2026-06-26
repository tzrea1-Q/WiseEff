import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function stopLocalBridgeHealthListener(platform: NodeJS.Platform, port = 18_787) {
  if (platform === "win32") {
    try {
      const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"]);
      const pids = new Set<number>();
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) {
          continue;
        }
        const pid = Number(line.trim().split(/\s+/).at(-1));
        if (Number.isInteger(pid) && pid > 0) {
          pids.add(pid);
        }
      }

      for (const pid of pids) {
        await execFileAsync("taskkill", ["/PID", String(pid), "/F"]);
      }

      if (pids.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch {
      // No listener on the health port.
    }
    return;
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    const pids = stdout
      .trim()
      .split("\n")
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);

    for (const pid of pids) {
      process.kill(pid, "SIGTERM");
    }

    if (pids.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch {
    // No listener on the health port.
  }
}

export async function waitForLocalBridgeConnection(
  fetchImpl: typeof fetch,
  timeoutMs = 10_000,
  intervalMs = 500
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const health = await probeLocalBridgeHealth(fetchImpl);
    if (health?.connected) {
      return health;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return probeLocalBridgeHealth(fetchImpl);
}

async function probeLocalBridgeHealth(fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl("http://127.0.0.1:18787/health");
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { connected?: boolean; paired?: boolean };
    return {
      connected: Boolean(body.connected),
      paired: typeof body.paired === "boolean" ? body.paired : undefined
    };
  } catch {
    return null;
  }
}

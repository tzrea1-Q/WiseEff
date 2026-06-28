import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LOG_PATH = path.join(os.homedir(), ".wiseeff", "bridge-launch.log");

export async function appendBridgeLaunchLog(message: string): Promise<void> {
  try {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Best-effort diagnostic logging only.
  }
}

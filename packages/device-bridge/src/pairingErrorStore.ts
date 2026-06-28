import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PAIRING_ERROR_PATH = path.join(os.homedir(), ".wiseeff", "pairing-error.json");

export async function writePairingError(message: string): Promise<void> {
  try {
    await mkdir(path.dirname(PAIRING_ERROR_PATH), { recursive: true });
    await writeFile(
      PAIRING_ERROR_PATH,
      JSON.stringify({ message, updatedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
  } catch {
    // Best-effort — don't let error logging itself fail.
  }
}

export async function readPairingError(): Promise<string | undefined> {
  try {
    const raw = await readFile(PAIRING_ERROR_PATH, "utf8");
    const parsed = JSON.parse(raw) as { message?: string; updatedAt?: string };
    return typeof parsed.message === "string" && parsed.message ? parsed.message : undefined;
  } catch {
    return undefined;
  }
}

export async function clearPairingError(): Promise<void> {
  try {
    await unlink(PAIRING_ERROR_PATH);
  } catch {
    // File may not exist.
  }
}

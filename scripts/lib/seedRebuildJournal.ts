import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SeedRebuildState } from "./seedRebuild";

const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/);
export const seedRebuildRunId = (value: unknown) => safeId.parse(value);

export async function openSeedRebuildJournal(runDir: string) {
  if (!path.isAbsolute(runDir)) throw new Error("seed-rebuild-absolute-run-dir-required");
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const stat = await lstat(runDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("seed-rebuild-private-run-dir-required");
  }
  const file = path.join(runDir, "core-state.json");
  return {
    async read(): Promise<SeedRebuildState> {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 32 * 1024 * 1024) {
        throw new Error("seed-rebuild-private-state-required");
      }
      return JSON.parse(await readFile(file, "utf8")) as SeedRebuildState;
    },
    async save(state: SeedRebuildState) {
      const temp = `${file}.${randomUUID()}.tmp`;
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        await rename(temp, file);
        const dir = await open(runDir, "r");
        try { await dir.sync(); } finally { await dir.close(); }
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(temp).catch(() => undefined);
        throw error;
      }
    },
  };
}

export async function assertSeedMaintenance(runDir: string, state: SeedRebuildState, publishing = false) {
  const proof = JSON.parse(await readFile(path.join(runDir, "wrapper-state.json"), "utf8"));
  if (proof.schemaVersion !== 1 || proof.runId !== state.runId || proof.planDigest !== state.plan.digest
    || proof.candidateSha !== state.plan.candidateSha || proof.organizationId !== state.plan.organizationId
    || proof.phase !== "maintenance-begun" || proof.recoveryPoint?.verified !== true
    || !/^sha256:[a-f0-9]{64}$/.test(proof.recoveryPoint?.manifestDigest ?? "")
    || proof.isolation?.proxyStopped !== true || proof.isolation?.queuePaused !== true
    || proof.isolation?.writersStopped !== true || proof.queue?.drained !== true
    || proof.publication?.frozen !== !publishing || (!publishing && proof.isolation?.managerStopped !== true)) {
    throw new Error("seed-rebuild-verified-maintenance-required");
  }
  return proof;
}

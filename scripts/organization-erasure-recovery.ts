import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import { resolveXiaozeCheckpointerFromEnv } from "../server/modules/agent/xiaoze/checkpointer";
import { createLocalArchiveObjectStore } from "../server/modules/catalog-cutover/archive";
import { createBridgeConnectionPool } from "../server/modules/deviceBridge/connectionPool";
import { getAuthContext } from "../server/modules/auth/repository";
import { createUserInvocation } from "../server/modules/auth/trustedInvocation";
import { captureOrganizationErasureState, organizationErasureRecoverySchema, replayOrganizationErasureState } from "../server/modules/users/organizationErasureRecovery";

/** Run only inside the existing restore owner's stopped-writer boundary. No
 * API, queue, publication manager, WebSocket server or worker is started here. */
export async function runOrganizationErasureRecovery(args: string[], environment = process.env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true,
    options: { file: { type: "string" }, actor: { type: "string" } } });
  const command = positionals[0];
  if (positionals.length !== 1 || !command || !["capture", "replay"].includes(command) || !values.file || (command === "replay" && !values.actor)) {
    throw new Error("Use capture --file PATH or replay --file PATH --actor CURRENT_PLATFORM_USER");
  }
  const file = path.resolve(values.file);
  if (command === "capture") {
    try { const state = organizationErasureRecoverySchema.parse(JSON.parse(await readFile(file, "utf8"))); return { captured: state.receipts.length, retained: true }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const env = loadServerEnv(environment);
  if (!env.DATABASE_URL) throw new Error("Actual restore database is required");
  const db = createPostgresDatabase(env.DATABASE_URL);
  const agentCheckpointer = resolveXiaozeCheckpointerFromEnv(env);
  try {
    const runtime = { agentCheckpointer, objectStore: createObjectStoreFromEnv(env), bridgeConnectionPool: createBridgeConnectionPool(),
      ...(env.WISEEFF_CATALOG_ARCHIVE_ROOT ? { catalogArchiveStore: createLocalArchiveObjectStore(env.WISEEFF_CATALOG_ARCHIVE_ROOT) } : {}),
      ...(env.WISEEFF_CATALOG_ARCHIVE_KEY_HEX ? { catalogArchiveKey: Buffer.from(env.WISEEFF_CATALOG_ARCHIVE_KEY_HEX, "hex") } : {}) };
    if (command === "capture") {
      const state = await captureOrganizationErasureState(db, runtime);
      const handle = await open(file, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
      return { captured: state.receipts.length, retained: false };
    }
    return await replayOrganizationErasureState(db, createUserInvocation(await getAuthContext(db, values.actor!)), JSON.parse(await readFile(file, "utf8")), runtime);
  } finally {
    await db.close();
    await (agentCheckpointer.saver as { end?: () => Promise<void> }).end?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOrganizationErasureRecovery(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error("Organization deletion recovery is incomplete; keep access and queues stopped. Inspect the protected recovery state and configured runtime.");
    process.exitCode = 1;
  });
}

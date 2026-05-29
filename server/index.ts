import "dotenv/config";
import { createWiseEffServerFromEnv } from "./app";
import { loadServerEnv } from "./config/env";
import { createAgentProviderFromEnv } from "./modules/agent/providerRegistry";
import { createHdcDebugDeviceGateway } from "./modules/debugging/hdcGateway";
import { createSimulatorDebugDeviceGateway } from "./modules/debugging/simulator";
import { startLogWorkerLoop } from "./modules/logs/worker";
import { createObjectStoreFromEnv } from "./objectStoreFactory";
import { createPostgresDatabase } from "./shared/database/client";

const env = loadServerEnv(process.env);
const db = env.DATABASE_URL ? createPostgresDatabase(env.DATABASE_URL) : undefined;
const objectStore = db ? createObjectStoreFromEnv(env) : undefined;
const agentProvider = createAgentProviderFromEnv(env);
const debugGateway =
  env.DEBUG_DEVICE_GATEWAY_MODE === "hdc"
    ? createHdcDebugDeviceGateway({ timeoutMs: env.HDC_TIMEOUT_MS })
    : createSimulatorDebugDeviceGateway();
const stopLogWorker = db && objectStore ? startLogWorkerLoop({ db, objectStore }) : undefined;
const server = createWiseEffServerFromEnv({
  db,
  objectStore,
  objectStoreHealth: objectStore,
  debugGateway,
  agentProvider,
  env
});

function shutdown() {
  stopLogWorker?.();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(env.PORT, "127.0.0.1", () => {
  console.log(`WiseEff API listening on http://127.0.0.1:${env.PORT}`);
});

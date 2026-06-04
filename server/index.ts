import "dotenv/config";
import { createWiseEffServerFromEnv } from "./app";
import { loadServerEnv } from "./config/env";
import { createAgentProviderFromEnv } from "./modules/agent/providerRegistry";
import { createHdcDebugDeviceGateway } from "./modules/debugging/hdcGateway";
import { createSimulatorDebugDeviceGateway } from "./modules/debugging/simulator";
import { createLogAnalysisQueueRuntime, createLogAnalysisQueueTransport } from "./modules/logs/logAnalysisQueueRuntime";
import { startLogWorkerLoop } from "./modules/logs/worker";
import { createMetricsRegistry } from "./observability/metrics";
import { createObjectStoreFromEnv } from "./objectStoreFactory";
import { createPostgresDatabase } from "./shared/database/client";

const env = loadServerEnv(process.env);
const db = env.DATABASE_URL ? createPostgresDatabase(env.DATABASE_URL) : undefined;
const objectStore = db ? createObjectStoreFromEnv(env) : undefined;
const metrics = createMetricsRegistry({ serviceName: "wiseeff-api" });
const agentProvider = createAgentProviderFromEnv(env);
const debugGateway =
  env.DEBUG_DEVICE_GATEWAY_MODE === "hdc"
    ? createHdcDebugDeviceGateway({ timeoutMs: env.HDC_TIMEOUT_MS })
    : createSimulatorDebugDeviceGateway();
const logAnalysisQueueEnv = {
  REDIS_URL: env.REDIS_URL ?? "",
  LOG_ANALYSIS_QUEUE_PREFIX: env.LOG_ANALYSIS_QUEUE_PREFIX,
  LOG_ANALYSIS_QUEUE_ATTEMPTS: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
  LOG_ANALYSIS_QUEUE_BACKOFF_MS: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS,
  LOG_ANALYSIS_QUEUE_CONCURRENCY: env.LOG_ANALYSIS_QUEUE_CONCURRENCY
};
const logAnalysisQueueRuntime =
  env.LOG_ANALYSIS_QUEUE_MODE === "durable" && db && objectStore
    ? env.LOG_WORKER_ENABLED
      ? createLogAnalysisQueueRuntime({ env: logAnalysisQueueEnv, db, objectStore, metrics })
      : createLogAnalysisQueueTransport({ env: logAnalysisQueueEnv })
    : undefined;
const stopLogWorker =
  env.LOG_WORKER_ENABLED && env.LOG_ANALYSIS_QUEUE_MODE === "polling" && db && objectStore
    ? startLogWorkerLoop({ db, objectStore, metrics })
    : undefined;
const server = createWiseEffServerFromEnv({
  db,
  objectStore,
  objectStoreHealth: objectStore,
  logAnalysisQueue: logAnalysisQueueRuntime?.queue,
  debugGateway,
  agentProvider,
  durableQueue: logAnalysisQueueRuntime?.queue,
  env,
  metrics
});

function shutdown() {
  stopLogWorker?.();
  void logAnalysisQueueRuntime
    ?.close()
    .catch((error) => {
      console.error("Failed to close log-analysis durable queue runtime.", error);
    })
    .finally(() => {
      server.close(() => {
        process.exit(0);
      });
    });

  if (!logAnalysisQueueRuntime) {
    server.close(() => {
      process.exit(0);
    });
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(env.PORT, env.HOST, () => {
  console.log(`WiseEff API listening on http://${env.HOST}:${env.PORT}`);
});

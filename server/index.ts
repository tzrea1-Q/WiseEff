import { loadDotenvFiles } from "./config/loadDotenv";

loadDotenvFiles();
import { createWiseEffServerFromEnv } from "./app";
import { loadServerEnv } from "./config/env";
import { createAgentProviderFromEnv } from "./modules/agent/providerRegistry";
import { createAdbDebugDeviceGateway } from "./modules/debugging/adbGateway";
import { createDebugDeviceGatewayRegistry } from "./modules/debugging/gatewayRegistry";
import { createHdcDebugDeviceGateway } from "./modules/debugging/hdcGateway";
import { createSimulatorDebugDeviceGateway } from "./modules/debugging/simulator";
import { createBridgeConnectionPool } from "./modules/deviceBridge/connectionPool";
import { createBridgeRpcClient } from "./modules/deviceBridge/rpc";
import { createLogAnalysisQueueRuntime, createLogAnalysisQueueTransport } from "./modules/logs/logAnalysisQueueRuntime";
import { startLogWorkerLoop } from "./modules/logs/worker";
import { createMetricsRegistry } from "./observability/metrics";
import { defaultTracingBoundary } from "./observability/tracing";
import { createObjectStoreFromEnv } from "./objectStoreFactory";
import { createPostgresDatabase } from "./shared/database/client";

const env = loadServerEnv(process.env);
const db = env.DATABASE_URL ? createPostgresDatabase(env.DATABASE_URL, { tracing: defaultTracingBoundary }) : undefined;
const objectStore = db ? createObjectStoreFromEnv(env, { tracing: defaultTracingBoundary }) : undefined;
const metrics = createMetricsRegistry({ serviceName: "wiseeff-api" });
const agentProvider = createAgentProviderFromEnv(env);
const hdcGateway = createHdcDebugDeviceGateway({ timeoutMs: env.HDC_TIMEOUT_MS });
const adbGateway = createAdbDebugDeviceGateway({ timeoutMs: env.ADB_TIMEOUT_MS });
const simulatorGateway = createSimulatorDebugDeviceGateway();
const debugGateway =
  env.DEBUG_DEVICE_GATEWAY_MODE === "hdc"
    ? hdcGateway
    : env.DEBUG_DEVICE_GATEWAY_MODE === "adb"
      ? adbGateway
      : simulatorGateway;
const debugGatewayRegistry = createDebugDeviceGatewayRegistry({
  hdc:
    env.DEBUG_DEVICE_GATEWAY_MODE === "hdc" || env.DEBUG_DEVICE_GATEWAY_MODE === "multi"
      ? hdcGateway
      : env.DEBUG_DEVICE_GATEWAY_MODE === "simulator"
        ? simulatorGateway
        : undefined,
  adb: env.DEBUG_DEVICE_GATEWAY_MODE === "multi" || env.DEBUG_DEVICE_GATEWAY_MODE === "adb" ? adbGateway : undefined
});
const bridgeConnectionPool = createBridgeConnectionPool();
const bridgeRpcClient = createBridgeRpcClient({ pool: bridgeConnectionPool });
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
      ? createLogAnalysisQueueRuntime({ env: logAnalysisQueueEnv, db, objectStore, metrics, tracing: defaultTracingBoundary })
      : createLogAnalysisQueueTransport({ env: logAnalysisQueueEnv })
    : undefined;
const stopLogWorker =
  env.LOG_WORKER_ENABLED && env.LOG_ANALYSIS_QUEUE_MODE === "polling" && db && objectStore
    ? startLogWorkerLoop({ db, objectStore, metrics, tracing: defaultTracingBoundary })
    : undefined;
const server = createWiseEffServerFromEnv({
  db,
  objectStore,
  objectStoreHealth: objectStore,
  logAnalysisQueue: logAnalysisQueueRuntime?.queue,
  debugGateway,
  debugGatewayRegistry,
  agentProvider,
  durableQueue: logAnalysisQueueRuntime?.queue,
  env,
  metrics,
  deviceBridge: {
    connectionPool: bridgeConnectionPool,
    rpcClient: bridgeRpcClient
  }
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

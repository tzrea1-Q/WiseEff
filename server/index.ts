import "dotenv/config";
import { createWiseEffServer } from "./app";
import { loadServerEnv } from "./config/env";
import { createLocalObjectStore } from "./modules/logs/objectStore";
import { startLogWorkerLoop } from "./modules/logs/worker";
import { createPostgresDatabase } from "./shared/database/client";

const env = loadServerEnv(process.env);
const db = env.DATABASE_URL ? createPostgresDatabase(env.DATABASE_URL) : undefined;
const objectStore = db ? createLocalObjectStore(env.OBJECT_STORE_ROOT) : undefined;
const stopLogWorker = db && objectStore ? startLogWorkerLoop({ db, objectStore }) : undefined;
const server = createWiseEffServer({ db, objectStore });

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

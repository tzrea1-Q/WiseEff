import "dotenv/config";
import { createWiseEffServer } from "./app";
import { loadServerEnv } from "./config/env";
import { createPostgresDatabase } from "./shared/database/client";

const env = loadServerEnv(process.env);
const db = env.DATABASE_URL ? createPostgresDatabase(env.DATABASE_URL) : undefined;
const server = createWiseEffServer({ db });

server.listen(env.PORT, "127.0.0.1", () => {
  console.log(`WiseEff API listening on http://127.0.0.1:${env.PORT}`);
});

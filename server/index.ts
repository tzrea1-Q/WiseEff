import "dotenv/config";
import { createWiseEffServer } from "./app";
import { loadServerEnv } from "./config/env";

const env = loadServerEnv(process.env);
const server = createWiseEffServer();

server.listen(env.PORT, "127.0.0.1", () => {
  console.log(`WiseEff API listening on http://127.0.0.1:${env.PORT}`);
});

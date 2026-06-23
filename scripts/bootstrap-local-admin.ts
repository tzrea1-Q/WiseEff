import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadServerEnv } from "../server/config/env";
import { bootstrapLocalAdmin } from "../server/modules/auth/bootstrapLocalAdmin";
import { createPostgresDatabase } from "../server/shared/database/client";

function readArg(name: string) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((argument) => argument.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

async function main() {
  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to bootstrap a local admin account.");
  }
  if (env.AUTH_PROVIDER !== "local") {
    throw new Error("AUTH_PROVIDER=local is required to bootstrap a local admin account.");
  }

  const username = readArg("username")?.trim();
  const password = readArg("password");
  const name = readArg("name")?.trim() ?? "Platform Admin";
  const organization = readArg("organization")?.trim() ?? readArg("organization-name")?.trim() ?? "硬件部";
  const title = readArg("title")?.trim() ?? "Platform Admin";

  if (!username || !password) {
    throw new Error(
      "Usage: npm run admin:bootstrap -- --username <username> --password <password> [--name \"Platform Admin\"] [--organization 硬件部|软件部]"
    );
  }

  const db = createPostgresDatabase(env.DATABASE_URL);
  const result = await bootstrapLocalAdmin(db, {
    username,
    password,
    name,
    organization,
    title
  });

  console.log(
    JSON.stringify(
      {
        status: "created",
        userId: result.userId,
        username: result.username,
        organizationId: result.organizationId,
        organizationName: result.organizationName,
        message: "Local admin account created. Log in through the UI with the provided username and password."
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

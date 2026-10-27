import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export function loadDotenvFiles(cwd = process.cwd()) {
  const localRuntime = process.env.NODE_ENV === "development" && process.env.WISEEFF_LOCAL_DEVELOPMENT_RUNTIME === "1";
  const apiDatabaseUrl = process.env.DATABASE_URL;
  if (localRuntime && !apiDatabaseUrl?.trim()) throw new Error("Local API runtime requires its prepared database LOGIN");
  dotenv.config({ path: path.join(cwd, ".env") });
  const localPath = path.join(cwd, ".env.local");
  if (fs.existsSync(localPath)) {
    dotenv.config({ path: localPath, override: true });
  }
  if (localRuntime) {
    process.env.DATABASE_URL = apiDatabaseUrl;
    delete process.env.WISEEFF_PUBLICATION_MANAGER_DATABASE_URL;
  }
}

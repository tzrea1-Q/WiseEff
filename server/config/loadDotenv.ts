import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export function loadDotenvFiles(cwd = process.cwd()) {
  dotenv.config({ path: path.join(cwd, ".env") });
  const localPath = path.join(cwd, ".env.local");
  if (fs.existsSync(localPath)) {
    dotenv.config({ path: localPath, override: true });
  }
}

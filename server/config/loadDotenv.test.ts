import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotenvFiles } from "./loadDotenv";

describe("loadDotenvFiles", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads .env.local overrides after .env", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wiseeff-dotenv-"));
    tempDirs.push(cwd);
    fs.writeFileSync(path.join(cwd, ".env"), "AGENT_API_KEY=from-env\n");
    fs.writeFileSync(path.join(cwd, ".env.local"), "AGENT_API_KEY=from-local\n");

    loadDotenvFiles(cwd);

    expect(process.env.AGENT_API_KEY).toBe("from-local");
  });
});

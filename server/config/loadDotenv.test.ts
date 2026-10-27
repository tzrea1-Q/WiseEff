import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDotenvFiles } from "./loadDotenv";

describe("loadDotenvFiles", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads .env.local overrides after .env", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wiseeff-dotenv-"));
    tempDirs.push(cwd);
    fs.writeFileSync(path.join(cwd, ".env"), "XIAOZE_LLM_API_KEY=from-env\n");
    fs.writeFileSync(path.join(cwd, ".env.local"), "XIAOZE_LLM_API_KEY=from-local\n");

    loadDotenvFiles(cwd);

    expect(process.env.XIAOZE_LLM_API_KEY).toBe("from-local");
  });

  it.each([
    ["development", "1", "prepared-api"],
    ["development", undefined, "bootstrap"],
    ["production", "1", "bootstrap"],
  ])("preserves the prepared LOGIN only for the explicit local API runtime (%s, %s)", (mode, localRuntime, expected) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wiseeff-local-runtime-env-"));
    tempDirs.push(cwd);
    fs.writeFileSync(path.join(cwd, ".env.local"), "DATABASE_URL=bootstrap\nWISEEFF_PUBLICATION_MANAGER_DATABASE_URL=private-manager\n");
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("WISEEFF_LOCAL_DEVELOPMENT_RUNTIME", localRuntime);
    vi.stubEnv("DATABASE_URL", "prepared-api");
    vi.stubEnv("WISEEFF_PUBLICATION_MANAGER_DATABASE_URL", undefined);
    loadDotenvFiles(cwd);
    expect(process.env.DATABASE_URL).toBe(expected);
    expect(process.env.WISEEFF_PUBLICATION_MANAGER_DATABASE_URL).toBe(expected === "prepared-api" ? undefined : "private-manager");
  });
});

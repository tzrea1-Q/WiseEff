import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const SCAN_ROOTS = ["server", "src", "scripts"] as const;

/** Paths where legacy identity tokens remain allowed (migrations / cutover / migrator / archives). */
const ALLOWED_PATH_SUBSTRINGS = [
  "/migrations/",
  "/cutovers/",
  "/parameter-topology/migration.ts",
  "/parameter-topology/migration.test.ts",
  "/docs/exec-plans/completed/",
  "/docs/zh-CN/exec-plans/completed/",
  "/legacyDependencyGuard.test.ts"
] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function isAllowedPath(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, "/");
  if (ALLOWED_PATH_SUBSTRINGS.some((fragment) => normalized.includes(fragment))) {
    return true;
  }
  // Non-production tests may mention retired tokens while asserting fail-closed behavior.
  if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(normalized)) {
    return true;
  }
  if (normalized.includes("/e2e/")) {
    return true;
  }
  return false;
}

async function walkFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      await walkFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
}

export async function productionSourceContains(token: string): Promise<boolean> {
  const hits = await listProductionHits(token);
  return hits.length > 0;
}

export async function listProductionHits(token: string): Promise<string[]> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    await walkFiles(path.join(REPO_ROOT, root), files);
  }

  const hits: string[] = [];
  for (const file of files) {
    if (isAllowedPath(file)) continue;
    const info = await stat(file);
    if (!info.isFile()) continue;
    const text = await readFile(file, "utf8");
    if (text.includes(token)) {
      hits.push(path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
    }
  }
  return hits.sort();
}

describe("legacy parameter identity dependency guard", () => {
  it("has no production dependency on legacy parameter identity", async () => {
    const forbidden = ["recommended_value", "source_node_path as parameter", "DTS_IDENTITY_FALLBACK_MODE"];
    const failures: string[] = [];
    for (const token of forbidden) {
      const hits = await listProductionHits(token);
      if (hits.length > 0) {
        failures.push(`${token}:\n  - ${hits.join("\n  - ")}`);
      }
      expect(await productionSourceContains(token), `forbidden token still present: ${token}\n${hits.join("\n")}`).toBe(
        false
      );
    }
    expect(failures, failures.join("\n\n")).toEqual([]);
  });
});

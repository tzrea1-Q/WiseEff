import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const SCAN_ROOTS = ["server", "src", "scripts"] as const;

/**
 * Only migration / cutover / rollback / explicit transitional adapters may keep
 * retired flat-identity table/column/shadow tokens in production source.
 */
const ALLOWED_PATH_SUBSTRINGS = [
  "/migrations/",
  "/cutovers/",
  "/parameter-topology/migration.ts",
  "/parameter-topology/migration.test.ts",
  // Local-dev post-cutover finalize probes retired flat tables before rename.
  "/parameter-topology/localPostCutover.ts",
  "/parameter-kernel/legacyParameterIdentityAdapter.ts",
  "/parameter-kernel/legacyParameterIdentityNames.ts",
  // Pre-cutover project delete still clears archived flat-identity rows.
  "/parameters/repository.ts",
  // Pre-cutover draft listing still joins the legacy PPV/definition tables.
  "/parameter-drafts/repository.ts",
  // Conflict enrichment falls back to legacy PPV/definition columns pre-cutover.
  "/parameters/fileSyncConflictRepository.ts",
  "/parameters/dashboard/legacyDashboardAdapter.ts",
  "/parameters/semanticParameterIdentityNames.ts",
  "/docs/exec-plans/completed/",
  "/docs/zh-CN/exec-plans/completed/",
  "/legacyDependencyGuard.test.ts",
  "/testing/",
  "/scripts/"
] as const;

const ACTIVE_DASHBOARD_REPO_PATHS = [
  "server/modules/parameters/dashboard/repository.ts",
  "server/modules/parameters/dashboard/hotspotRepository.ts"
] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

/** Tokens that must not appear in activity runtime outside the allowlist. */
const FORBIDDEN_ACTIVITY_TOKENS = [
  "project_parameter_values",
  "parameter_definitions",
  "legacy_project_parameter_values",
  "legacy_parameter_definitions",
  "ensureShadowParameterValue",
  "binding-shadow",
  "recommended_value",
  "source_node_path as parameter",
  "DTS_IDENTITY_FALLBACK_MODE"
] as const;

// The first two identities in the existing retired inventory also name canonical
// relations. Reuse that inventory for the exception and its paired regressions;
// do not introduce additional embedded legacy identities.
const SHARED_CATALOG_RELATION_TOKENS: readonly string[] = FORBIDDEN_ACTIVITY_TOKENS.slice(0, 2);

const FORBIDDEN_DASHBOARD_IMPORT_MARKERS = [
  "LEGACY_IDENTITY_SQL",
  "legacyParameterIdentityNames",
  "legacyParameterIdentityAdapter"
] as const;

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

export function containsRetiredIdentityToken(text: string, token: string): boolean {
  if (!SHARED_CATALOG_RELATION_TOKENS.includes(token)) return text.includes(token);
  // These two canonical relations share names with retired public tables.
  // Recognize only the exact source spelling, never a file-wide exemption.
  const namespace = "parameter_catalog.";
  for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, at + token.length)) {
    const start = at - namespace.length;
    if (start < 0 || text.slice(start, at) !== namespace
      || /[\w$.\u0080-\uFFFF]/u.test(text[start - 1] ?? "")
      || /[\w$\u0080-\uFFFF]/u.test(text[at + token.length] ?? "")) return true;
  }
  return false;
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
    if (containsRetiredIdentityToken(text, token)) {
      hits.push(path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
    }
  }
  return hits.sort();
}

export async function listLegacyIdentityTemplateInterpolationHits(
  relativePaths?: readonly string[]
): Promise<string[]> {
  const targets =
    relativePaths ??
    (await (async () => {
      const files: string[] = [];
      for (const root of SCAN_ROOTS) {
        await walkFiles(path.join(REPO_ROOT, root), files);
      }
      return files
        .filter((file) => !isAllowedPath(file))
        .map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
    })());

  const hits: string[] = [];
  for (const relativePath of targets) {
    const text = await readFile(path.join(REPO_ROOT, relativePath), "utf8");
    if (text.includes("${LEGACY_IDENTITY_SQL")) {
      hits.push(relativePath);
    }
  }
  return hits.sort();
}

describe("legacy parameter identity dependency guard", () => {
  it.each(SHARED_CATALOG_RELATION_TOKENS)(
    "still rejects unqualified, disguised and mixed retired %s references",
    token => {
      const forbidden = [token, `public.${token}`, `other.${token}`, `legacy_${token}`,
        `xparameter_catalog.${token}`, `other.parameter_catalog.${token}`, `éparameter_catalog.${token}`,
        `$parameter_catalog.${token}`, `parameter_catalog.${token}_shadow`, `parameter_catalog.${token}é`,
        `parameter_catalog.${token}$`, `"parameter_catalog".${token}`, `parameter_catalog."${token}"`,
        `parameter_catalog./* namespace gap */${token}`, `parameter_catalog. ${token}`,
        `parameter_catalog.${token}; public.${token}`, `${token}; parameter_catalog.${token}`,
        `/* parameter_catalog.${token} */ select * from ${token}`];
      for (const text of forbidden) expect(containsRetiredIdentityToken(text, token), text).toBe(true);
    }
  );

  it("keeps every other retired token forbidden even with a canonical namespace prefix", () => {
    for (const token of FORBIDDEN_ACTIVITY_TOKENS) {
      if (SHARED_CATALOG_RELATION_TOKENS.includes(token)) continue;
      expect(containsRetiredIdentityToken(`parameter_catalog.${token}`, token), token).toBe(true);
    }
  });

  it.each(SHARED_CATALOG_RELATION_TOKENS)(
    "distinguishes the canonical namespace from each retired %s occurrence",
    token => {
      expect(containsRetiredIdentityToken(`select * from parameter_catalog.${token}`, token)).toBe(false);
      expect(containsRetiredIdentityToken(`"parameter_catalog.${token}"`, token)).toBe(false);
      expect(containsRetiredIdentityToken(`parameter_catalog.${token}, parameter_catalog.${token}`, token)).toBe(false);
    }
  );

  it(
    "has no activity-runtime dependency on legacy parameter identity",
    async () => {
      const failures: string[] = [];
      for (const token of FORBIDDEN_ACTIVITY_TOKENS) {
        const hits = await listProductionHits(token);
        if (hits.length > 0) {
          failures.push(`${token}:\n  - ${hits.join("\n  - ")}`);
        }
      }
      expect(failures, failures.join("\n\n")).toEqual([]);
    },
    60_000
  );

  it(
    "keeps active dashboard repos free of legacy identity imports",
    async () => {
      const failures: string[] = [];
      for (const relativePath of ACTIVE_DASHBOARD_REPO_PATHS) {
        const text = await readFile(path.join(REPO_ROOT, relativePath), "utf8");
        for (const marker of FORBIDDEN_DASHBOARD_IMPORT_MARKERS) {
          if (text.includes(marker)) {
            failures.push(`${relativePath}: ${marker}`);
          }
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    },
    30_000
  );

  it(
    "has no LEGACY_IDENTITY_SQL template interpolation in active dashboard repos",
    async () => {
      const hits = await listLegacyIdentityTemplateInterpolationHits(ACTIVE_DASHBOARD_REPO_PATHS);
      expect(hits, hits.join("\n")).toEqual([]);
    },
    30_000
  );
});

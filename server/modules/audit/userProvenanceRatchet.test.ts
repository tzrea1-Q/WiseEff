import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * ADR-0038 growth-only ratchet, not a proof of provenance. New service-layer User
 * provenance must be threaded from the caller's TrustedInvocationContext instead.
 * For a genuinely user-only site, add a baseline with a one-line review justification.
 * Decreases pass: lower the baseline in the same change when convenient.
 */
// Counts: [literal actorType: "user", non-HTTP createUserInvocation calls].
// Existing service mints retain user-only editing/admin entries; mixed Agent writes thread context.
const BASELINE: Record<string, readonly [number, number]> = {
  "app.ts": [0, 1],
  "modules/audit/listTypes.ts": [1, 0],
  "modules/audit/routes.ts": [1, 0],
  "modules/audit/trustedAudit.ts": [1, 0],
  "modules/auth/localAuth.ts": [1, 0],
  "modules/catalog-publication/authorization/testHarness.ts": [0, 1],
  "modules/catalog-publication/jobs/managerRunner.ts": [0, 1],
  "modules/debugging/catalogTransfer.ts": [0, 2],
  "modules/debugging/deviceWriteApproval.ts": [0, 2],
  "modules/debugging/service.ts": [0, 18],
  "modules/knowledge/service.ts": [0, 15],
  "modules/logs/domainsService.ts": [0, 6],
  "modules/logs/service.ts": [0, 9],
  "modules/parameter-bindings/catalogProjectValueSync.ts": [0, 1],
  "modules/parameter-bindings/drafts/service.ts": [0, 1],
  "modules/parameter-bindings/seedInitialization/dispose.ts": [0, 1],
  "modules/parameter-bindings/seedInitialization/materialize.ts": [0, 1],
  "modules/parameter-catalog-api/productionWire.ts": [0, 3],
  "modules/parameter-catalog-migration/service.ts": [0, 1],
  "modules/parameter-files/baselineService.ts": [0, 3],
  "modules/parameter-files/candidateService.ts": [0, 1],
  "modules/parameter-files/canonicalBatchDraftComposition.ts": [0, 1],
  "modules/parameter-files/canonicalFileWorkflow.ts": [0, 10],
  "modules/parameter-files/configSetService.ts": [0, 5],
  "modules/parameter-files/conflictService.ts": [0, 1],
  "modules/parameter-files/exportService.ts": [0, 2],
  "modules/parameter-files/service.ts": [0, 2],
  "modules/parameter-files/syncService.ts": [0, 2],
  "modules/parameter-files/validationGate.ts": [0, 1],
  "modules/parameter-modules/parameterCatalogComparisonContribution.ts": [0, 1],
  "modules/parameter-modules/service.ts": [0, 1],
  "modules/parameter-specs/parameterCatalogComparisonContribution.ts": [0, 1],
  "modules/parameter-topology/service.ts": [0, 4],
  "modules/parameters/initializationService.ts": [0, 3],
  "modules/parameters/projectService.ts": [0, 4],
  "modules/parameters/service.ts": [0, 8],
  "modules/parameters/testSubmissionContext.ts": [0, 1],
  "modules/product-feedback/service.ts": [0, 5],
  "modules/release-verification/comparison/offlineModD02SourceReader.ts": [0, 1],
  "modules/release-verification/evidence/api/driver.ts": [0, 1],
  "modules/users/service.ts": [0, 11],
};
const serverRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : listTsFiles(full);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

it("User provenance sites only ever decrease (ADR-0038)", () => {
  const growth: string[] = [];
  for (const file of listTsFiles(serverRoot)) {
    const key = relative(serverRoot, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    const entryPoint = /(?:^|\/)(?:routes|[^/]*(?:Routes|Endpoint))\.ts$/.test(key);
    const counts = [
      (text.match(/\bactorType\s*:\s*["']user["']/g) ?? []).length,
      entryPoint || key === "modules/auth/trustedInvocation.ts" ? 0 : (text.match(/\bcreateUserInvocation\s*\(/g) ?? []).length
    ];
    if (counts.some((count, index) => count > (BASELINE[key]?.[index] ?? 0))) {
      growth.push(`${key}: [${counts}] exceeds [${BASELINE[key] ?? [0, 0]}]`);
    }
  }
  expect(growth, "thread the caller's trusted invocation; justify genuinely user-only baseline additions in review").toEqual([]);
});

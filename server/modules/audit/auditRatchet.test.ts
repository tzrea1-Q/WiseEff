import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Migration ratchet for ADR-0027. Direct `createAuditEvent(...)` calls cannot prove
 * they share the audited write's transaction, so they are being replaced by
 * `withAuditedWrite` / `writeAuditEventInTx` call site by call site. This test pins
 * the remaining direct calls per file: counts may only go DOWN. When the allowlist
 * reaches zero, delete `createAuditEvent` and this test.
 *
 * If this test fails because you added a NEW direct call: use `withAuditedWrite`
 * (or `writeAuditEventInTx` with `asAuditTx` inside your transaction) instead.
 * If it fails because a count went down or a file disappeared: update the allowlist
 * to the new, lower value in the same change.
 */
const ALLOWED_DIRECT_CALLS: Record<string, number> = {
  "modules/agent/orchestrator.ts": 1,
  "modules/agent/xiaoze/threadPersistence.ts": 1,
  "modules/agent/xiaoze/threadRoutes.ts": 2,
  // audit/routes.ts stays: for POST /audit-events the audit event IS the domain write.
  "modules/audit/routes.ts": 1,
  // auth/* stay: bootstrap/register/login/logout audits fire before an AuthContext
  // exists and the seam derives actor/org from auth; all sites are in-transaction.
  "modules/auth/bootstrapLocalAdmin.ts": 1,
  "modules/auth/localAuth.ts": 1,
  "modules/dts-reload/configurationService.ts": 1,
  // dts-reload/policy.ts + sensitiveGate.ts are REFUSAL audits (deny + throw) that must
  // survive the caller's rollback, i.e. deliberately outside the audited write seam.
  "modules/dts-reload/policy.ts": 1,
  "modules/dts-reload/sensitiveGate.ts": 1,
  "modules/dts-reload/service.ts": 1,
  "modules/logs/service.ts": 1,
  "modules/parameter-modules/service.ts": 2,
  "modules/parameter-specs/driverSchemaOverlayService.ts": 1,
  "modules/parameter-topology/governanceAudit.ts": 1,
  // parameters/sensitiveNode.ts stays: refusal audit, same as dts-reload/policy.ts.
  "modules/parameters/sensitiveNode.ts": 1
};

/** Files where direct calls are the implementation of the seam itself. */
const SEAM_FILES = new Set(["modules/audit/repository.ts", "modules/audit/auditedWrite.ts"]);

const serverRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function countDirectCalls(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of listTsFiles(serverRoot)) {
    const key = relative(serverRoot, file).split(sep).join("/");
    if (SEAM_FILES.has(key)) continue;
    const matches = readFileSync(file, "utf8").match(/createAuditEvent\(/g);
    if (matches && matches.length > 0) {
      counts.set(key, matches.length);
    }
  }
  return counts;
}

describe("audit write ratchet (ADR-0027)", () => {
  it("direct createAuditEvent call sites only ever decrease", () => {
    const actual = countDirectCalls();

    const newFiles: string[] = [];
    const increased: string[] = [];
    for (const [file, count] of actual.entries()) {
      const allowed = ALLOWED_DIRECT_CALLS[file];
      if (allowed === undefined) {
        newFiles.push(`${file} (${count})`);
      } else if (count > allowed) {
        increased.push(`${file} (${count} > ${allowed})`);
      }
    }

    expect(newFiles, "new files with direct createAuditEvent calls — use withAuditedWrite").toEqual([]);
    expect(increased, "direct createAuditEvent calls increased — use withAuditedWrite").toEqual([]);
  });

  it("keeps the allowlist honest: entries whose file dropped the calls must be removed", () => {
    const actual = countDirectCalls();
    const stale = Object.entries(ALLOWED_DIRECT_CALLS)
      .filter(([file, allowed]) => (actual.get(file) ?? 0) < allowed)
      .map(([file, allowed]) => `${file} (now ${actual.get(file) ?? 0}, allowlist ${allowed})`);

    expect(stale, "ratchet down: lower these allowlist entries to match reality").toEqual([]);
  });
});

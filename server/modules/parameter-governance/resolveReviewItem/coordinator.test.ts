import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  ReviewItemEtag,
  ReviewItemId,
} from "../../parameter-catalog-contract/index";

import {
  fingerprintResolveReviewItemCommand,
  reviewResolutionCommandFamily,
  validateResolveReviewItemCommand,
  THREAT_MATRIX,
  type RegisterSubjectResolutionCommand,
} from "./index";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = readdirSync(dir).filter(
  (file) => file.endsWith(".ts") && !file.includes(".test."),
);

const catalogStructuralTokens = [
  "catalog_releases",
  "catalog_subjects",
  "catalog_drivers",
  "catalog_node_types",
  "catalog_release_subjects",
  "catalog_subject_aliases",
  "catalog_release_subject_aliases",
  "parameter_definitions",
  "definition_revisions",
  "catalog_release_definition_heads",
  "catalog_materializations",
  "catalog_state",
] as const;

const allowedCatalogIdentifiers = new Set([
  "governance_command_idempotency",
  "parameter_review_items",
  "parameter_review_resolutions",
  "parameter_review_evidence",
  "definition_proposals",
  "definition_proposal_revisions",
  "organization_subject_registrations",
  "subject_placements",
]);

const pin = {
  id: CatalogReleaseId("crel_acme_1"),
  digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
};

const registerCommand = (
  overrides: Partial<RegisterSubjectResolutionCommand> = {},
): RegisterSubjectResolutionCommand => ({
  resolution: "register-subject",
  organizationId: "org-s5-rsl",
  reviewItemId: ReviewItemId("prit_s5_rsl_item"),
  expectedRelease: pin,
  etag: ReviewItemEtag(`sha256:${"b".repeat(64)}`),
  idempotencyKey: "resolve-key-1",
  context: {
    actorKind: "org-admin",
    principalId: "user-org-admin",
    organizationId: "org-s5-rsl",
  },
  reason: "unknown",
  subjectId: CatalogSubjectId("csub_acme_power"),
  subjectKind: "driver",
  placement: { mode: "use-default" },
  destinationModuleId: "pmod-s5-rsl-driver",
  ...overrides,
});

describe("S5-RSL public command contract", () => {
  it("owns the frozen command family and threat-matrix coverage", () => {
    expect(reviewResolutionCommandFamily).toBe("review-resolution");
    expect(THREAT_MATRIX).toHaveLength(7);
  });

  it("fingerprints canonical proof key order identically", () => {
    const first = fingerprintResolveReviewItemCommand(
      registerCommand({ proof: { note: "stable", reason: "review" } }),
    );
    const second = fingerprintResolveReviewItemCommand(
      registerCommand({ proof: { reason: "review", note: "stable" } }),
    );
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("refuses Agent, Platform Admin, and cross-organization callers", () => {
    expect(
      validateResolveReviewItemCommand(
        registerCommand({ context: { actorKind: "agent", principalId: "agent-1" } }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "permission-denied", actorKind: "agent" },
    });
    expect(
      validateResolveReviewItemCommand(
        registerCommand({
          context: { actorKind: "platform-admin", principalId: "platform-1" },
        }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "permission-denied", actorKind: "platform-admin" },
    });
    expect(
      validateResolveReviewItemCommand(
        registerCommand({
          context: {
            actorKind: "org-admin",
            principalId: "user-org-admin",
            organizationId: "org-other",
          },
        }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "permission-denied", actorKind: "org-admin" },
    });
  });

  it("rejects restore-registration that carries Placement fields", () => {
    const result = validateResolveReviewItemCommand({
      resolution: "restore-registration",
      organizationId: "org-s5-rsl",
      reviewItemId: ReviewItemId("prit_s5_rsl_item"),
      expectedRelease: pin,
      etag: ReviewItemEtag(`sha256:${"b".repeat(64)}`),
      idempotencyKey: "restore-key-1",
      context: {
        actorKind: "org-admin",
        principalId: "user-org-admin",
        organizationId: "org-s5-rsl",
      },
      reason: "retired-registration-observed",
      registrationId: "sreg_existing" as never,
      placement: { mode: "use-default" },
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-command");
  });

  it("does not export a repository, transaction, or unit of work", async () => {
    const exported = await import("./index");
    expect("withReviewResolutionUnitOfWork" in exported).toBe(false);
    expect("writeGuardedRegistration" in exported).toBe(false);
    expect("assertCatalogSubjectActive" in exported).toBe(false);
    expect(Object.keys(exported).some((key) => /repository/i.test(key))).toBe(false);
    expect(Object.keys(exported).some((key) => /unitOfWork|UnitOfWork|transaction/i.test(key))).toBe(
      false,
    );
  });
});

describe("S5-RSL production Catalog isolation and HTTP multiwriter ratchet", () => {
  it("never selects Catalog structural rows or instantiates a second guard adapter", () => {
    expect(productionFiles).toEqual(
      expect.arrayContaining([
        "command.ts",
        "coordinator.ts",
        "failures.ts",
        "index.ts",
        "result.ts",
        "threatMatrix.ts",
        "unitOfWork.ts",
      ]),
    );
    expect(productionFiles.some((file) => /guard/i.test(file))).toBe(false);

    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("parameter_definitions");
      expect(source, file).not.toMatch(/pg_advisory_/);
      expect(source, file).not.toContain("assert_catalog_subject_active");
      expect(source, file).not.toContain("assertCatalogSubjectActive");
      expect(source, file).not.toContain("guardAdapter");
      for (const token of catalogStructuralTokens) {
        expect(source, `${file} must not mention ${token}`).not.toContain(token);
      }
      const identifiers = [...source.matchAll(/parameter_catalog\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (match) => match[1],
      );
      for (const identifier of identifiers) {
        expect(allowedCatalogIdentifiers.has(identifier), `${file} -> ${identifier}`).toBe(true);
      }
    }

    const coordinator = sources.find((entry) => entry.file === "coordinator.ts");
    const index = sources.find((entry) => entry.file === "index.ts");
    const command = sources.find((entry) => entry.file === "command.ts");
    expect(coordinator?.source).toContain("writeGuardedRegistration");
    expect(coordinator?.source.match(/writeGuardedRegistration/g)?.length).toBeGreaterThanOrEqual(1);
    expect(index?.source).not.toContain("writeGuardedRegistration");
    expect(index?.source).not.toContain("withReviewResolutionUnitOfWork");
    expect(index?.source).not.toMatch(/PoolClient|transaction handle|req\.tx/i);
    expect(command?.source).not.toMatch(/PoolClient|transaction/i);
    expect(coordinator?.source).toMatch(
      /export const resolveReviewItem = async \(\s*pool: pg\.Pool,\s*command: ResolveReviewItemCommand/,
    );
  });
});

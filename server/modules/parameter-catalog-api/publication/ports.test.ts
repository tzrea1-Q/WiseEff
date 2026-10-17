import { afterEach, describe, expect, it, vi } from "vitest";

import { compileVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";
import { createUserInvocation } from "../../auth/trustedInvocation";
import * as currentPointer from "../../catalog-kernel/install/currentPointer";
import { encodeBundleBytes, sha256Digest } from "../../catalog-publication/builder/bundleCodec";
import { integerContent } from "../../catalog-publication/builder/predecessorHarness";
import * as publicationStore from "../../catalog-publication/persistence/store";
import { CatalogArtifactId } from "../../parameter-catalog-contract/index";
import type { Database } from "../../../shared/database/client";
import { makeTestAuthContext } from "../../../testing/authContext";
import { mapPublicationFailure } from "./errors";
import { bindCatalogPublicationCommands } from "./ports";

afterEach(() => vi.restoreAllMocks());

describe("publication preview retired owner boundary", () => {
  it.each(["create-definition", "revise-definition", "retire-definition", "restore-definition"] as const)(
    "reports %s as subject-retired before any persistence", async (op) => {
      const vendor = compileVendorCatalogSuccessor();
      const bytes = encodeBundleBytes(vendor.bundle);
      vi.spyOn(publicationStore, "getArtifactByDigest").mockResolvedValue({
        ok: true,
        value: {
          id: CatalogArtifactId("cart_retired_owner"),
          artifactDigest: vendor.compiled.aggregateDigest,
          bytesChecksum: sha256Digest(bytes),
          artifactBytes: bytes,
          sourceKind: "adopted-preexisting",
          targetReleaseId: vendor.compiled.release.id,
          targetReleaseDigest: vendor.compiled.aggregateDigest,
          predecessorReleaseId: null,
          predecessorReleaseDigest: null,
          toolchain: {},
          createdAt: "2026-10-16T00:00:00Z",
        },
      });
      vi.spyOn(currentPointer, "readCurrentCatalogPointer").mockResolvedValue({
        kind: "installed", current: vendor.compiled.release, predecessorReleaseId: null,
      });
      const db = { query: vi.fn(), transaction: vi.fn() } as unknown as Database;
      const commands = bindCatalogPublicationCommands({ db, pool: {} as Parameters<typeof currentPointer.readCurrentCatalogPointer>[0] });
      const content = integerContent("Input current limit", "Retired subject remains read-only.");
      const change = op === "create-definition"
        ? { op, subjectId: "csub_acme_power", propertyKey: "iin_new", content }
        : { op, definitionId: "pdef_acme_power_iin_max", class: "documentation", content };
      const result = await commands.previewCandidate({
        trustedActor: createUserInvocation(makeTestAuthContext()),
        organizationId: "org-retired-owner", principalId: "author", actorKind: "org-admin",
        permissions: ["catalog:author"], catalogReleaseId: vendor.compiled.release.id,
        changeSet: [change],
      });
      expect(result).toEqual({ ok: false, error: { kind: "reason", reason: "subject-retired" } });
      if (result.ok) throw new Error("retired subject preview was accepted");
      expect(mapPublicationFailure(result.error, "retired-owner")).toMatchObject({
        status: 409,
        body: { error: { details: { reason: "subject-retired", retryable: false } } },
      });
      expect(db.query).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );
});

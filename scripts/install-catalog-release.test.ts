import { describe, expect, it } from "vitest";
import type pg from "pg";

import { validCatalogReleaseBundle } from "../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import {
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
} from "./compile-vendor-catalog-release";
import {
  installCatalogRelease,
  parseInstallCatalogReleaseArgs,
} from "./install-catalog-release";

const firstReleaseBundle = () => {
  const full = validCatalogReleaseBundle();
  const first = full.releases[0]!;
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

describe("parseInstallCatalogReleaseArgs", () => {
  it("parses bootstrap with confirm-digest only", () => {
    expect(
      parseInstallCatalogReleaseArgs([
        "/tmp/bundle.json",
        "--confirm-digest",
        FIRST_ACME_RELEASE_DIGEST,
      ]),
    ).toEqual({
      mode: "bootstrap",
      filename: "/tmp/bundle.json",
      expectedTargetDigest: FIRST_ACME_RELEASE_DIGEST,
    });
  });

  it("parses advance with expected current pin", () => {
    expect(
      parseInstallCatalogReleaseArgs([
        "--mode",
        "advance",
        "/tmp/successor.json",
        "--expected-current-id",
        FIRST_ACME_RELEASE_ID,
        "--expected-current-digest",
        FIRST_ACME_RELEASE_DIGEST,
        "--confirm-digest",
        VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
      ]),
    ).toEqual({
      mode: "advance",
      filename: "/tmp/successor.json",
      expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
      expectedCurrentId: FIRST_ACME_RELEASE_ID,
      expectedCurrentDigest: FIRST_ACME_RELEASE_DIGEST,
    });
  });

  it("rejects advance without the current pin", () => {
    expect(() =>
      parseInstallCatalogReleaseArgs([
        "/tmp/successor.json",
        "--mode",
        "advance",
        "--confirm-digest",
        FIRST_ACME_RELEASE_DIGEST,
      ]),
    ).toThrow("catalog-install-usage");
  });

  it("rejects bootstrap when an expected-current pin is also supplied", () => {
    expect(() =>
      parseInstallCatalogReleaseArgs([
        "/tmp/bundle.json",
        "--mode",
        "bootstrap",
        "--confirm-digest",
        FIRST_ACME_RELEASE_DIGEST,
        "--expected-current-id",
        FIRST_ACME_RELEASE_ID,
        "--expected-current-digest",
        FIRST_ACME_RELEASE_DIGEST,
      ]),
    ).toThrow("catalog-install-usage");
  });

  it("rejects skipAuthorization and other unknown flags", () => {
    expect(() =>
      parseInstallCatalogReleaseArgs([
        "/tmp/bundle.json",
        "--confirm-digest",
        FIRST_ACME_RELEASE_DIGEST,
        "--skipAuthorization",
        "true",
      ]),
    ).toThrow("catalog-install-usage");
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      parseInstallCatalogReleaseArgs([
        "/tmp/bundle.json",
        "--mode",
        "replace",
        "--confirm-digest",
        FIRST_ACME_RELEASE_DIGEST,
      ]),
    ).toThrow("catalog-install-usage");
  });
});

describe("installCatalogRelease", () => {
  it("rejects a digest mismatch before touching PostgreSQL", async () => {
    await expect(
      installCatalogRelease(
        {} as pg.Pool,
        {
          mode: "bootstrap",
          filename: "-",
          expectedTargetDigest: `sha256:${"0".repeat(64)}`,
        },
        firstReleaseBundle(),
      ),
    ).rejects.toThrow("catalog-install-digest-mismatch");
  });
});

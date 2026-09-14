import { describe, expect, it } from "vitest";

import { parseCatalogPublicationOpsArgv, resolvePolicyStatusDatabaseUrl } from "./catalog-publication-ops";

describe("catalog-publication-ops argv", () => {
  it("parses inspect", () => {
    expect(parseCatalogPublicationOpsArgv(["inspect"])).toEqual({
      ok: true,
      command: { name: "inspect" },
    });
  });

  it("requires adopt check or execute plus pins", () => {
    const parsed = parseCatalogPublicationOpsArgv([
      "adopt",
      "--check",
      "--expected-id",
      "crel_1",
      "--expected-digest",
      "sha256:abc",
      "--bundle",
      "bundle.json",
      "--actor",
      "user-1",
      "--verification-digest",
      "sha256:def",
      "--data-mode",
      "fresh",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.command).toMatchObject({ name: "adopt", mode: "check", expectedId: "crel_1" });
  });

  it("rejects missing adopt flags with usage", () => {
    const parsed = parseCatalogPublicationOpsArgv(["adopt", "--execute"]);
    expect(parsed.ok).toBe(false);
  });

  it("parses provision-logins", () => {
    expect(parseCatalogPublicationOpsArgv(["provision-logins"])).toEqual({
      ok: true,
      command: {
        name: "provision-logins",
        mode: "official",
        runToken: undefined,
        rotatePasswords: false,
        credentialDir: process.env.WISEEFF_PUBLICATION_CREDENTIAL_DIR,
      },
    });
  });

  it("parses provision-logins lab mode with credential dir", () => {
    expect(
      parseCatalogPublicationOpsArgv([
        "provision-logins",
        "--mode",
        "lab",
        "--run-token",
        "abc123xyz",
        "--credential-dir",
        "/tmp/creds",
      ]),
    ).toEqual({
      ok: true,
      command: {
        name: "provision-logins",
        mode: "lab",
        runToken: "abc123xyz",
        rotatePasswords: false,
        credentialDir: "/tmp/creds",
      },
    });
  });

  it("parses inspect-login worker", () => {
    expect(parseCatalogPublicationOpsArgv(["inspect-login", "worker"])).toEqual({
      ok: true,
      command: { name: "inspect-login", which: "worker" },
    });
  });

  it("parses freeze set with actor", () => {
    const parsed = parseCatalogPublicationOpsArgv(["freeze", "set", "--actor", "deployment-upgrade"]);
    expect(parsed).toEqual({
      ok: true,
      command: { name: "freeze", action: "set", actor: "deployment-upgrade" },
    });
  });

  it("parses managed instance policy check without bundling low-risk", () => {
    const parsed = parseCatalogPublicationOpsArgv([
      "policy",
      "check",
      "enable",
      "--actor",
      "user-1",
      "--expected-database-oid",
      "16384",
      "--expected-id",
      "crel_1",
      "--expected-digest",
      "sha256:abc",
      "--expected-policy-revision",
      "1",
      "--expected-frozen",
      "false",
      "--expected-adopted",
      "true",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.command).toMatchObject({
      name: "policy",
      action: "check",
      target: "enable",
      expectedDatabaseOid: "16384",
      expectedAdopted: true,
      expectedFrozen: false,
      lowRiskSingleActorPublish: undefined,
    });
  });

  it("reads policy status through DATABASE_URL, not the manager LOGIN", () => {
    expect(
      resolvePolicyStatusDatabaseUrl({
        DATABASE_URL: "postgres://wiseeff_api:x@postgres:5432/wiseeff",
        WISEEFF_PUBLICATION_MANAGER_DATABASE_URL: "postgres://wiseeff_publication_manager:x@postgres:5432/wiseeff",
        WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL: "postgres://wiseeff:x@postgres:5432/wiseeff",
      }),
    ).toEqual({ ok: true, url: "postgres://wiseeff_api:x@postgres:5432/wiseeff" });
    expect(resolvePolicyStatusDatabaseUrl({ WISEEFF_PUBLICATION_MANAGER_DATABASE_URL: "postgres://manager:x@postgres/db" })).toEqual({
      ok: false,
      message: "DATABASE_URL is required for policy status; the manager LOGIN cannot SELECT catalog_state",
    });
  });

  it("parses independent low-risk single-actor flag", () => {
    const parsed = parseCatalogPublicationOpsArgv([
      "policy",
      "enable",
      "--actor",
      "user-1",
      "--confirmation",
      "ephemeral-test-only",
      "--low-risk-single-actor",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.command).toMatchObject({
      name: "policy",
      action: "enable",
      confirmation: "ephemeral-test-only",
      lowRiskSingleActorPublish: true,
    });
  });
});

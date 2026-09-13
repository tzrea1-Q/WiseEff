import { describe, expect, it } from "vitest";

import { parseCatalogPublicationOpsArgv } from "./catalog-publication-ops";

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
      command: { name: "provision-logins" },
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
});

import { describe, expect, it } from "vitest";

import {
  publicationManagerDatabaseUrlReusesApiLogin,
  resolvePublicationManagerDatabaseUrl,
} from "../server/modules/catalog-publication/runtime/managerDatabaseUrl";

describe("resolvePublicationManagerDatabaseUrl", () => {
  it("fails closed when the manager DSN is missing", () => {
    expect(resolvePublicationManagerDatabaseUrl({ DATABASE_URL: "postgres://wiseeff:x@h/db" })).toEqual({
      ok: false,
      error: {
        code: "manager-dsn-missing",
        message:
          "WISEEFF_PUBLICATION_MANAGER_DATABASE_URL is required. Do not reuse DATABASE_URL. Provision a dedicated manager LOGIN.",
      },
    });
  });

  it("fails closed when the manager login equals the API login", () => {
    const result = resolvePublicationManagerDatabaseUrl({
      DATABASE_URL: "postgres://wiseeff:secret@postgres:5432/wiseeff",
      WISEEFF_PUBLICATION_MANAGER_DATABASE_URL: "postgres://wiseeff:other@postgres:5432/wiseeff",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("manager-dsn-reuses-api");
  });

  it("accepts a dedicated manager login", () => {
    const result = resolvePublicationManagerDatabaseUrl({
      DATABASE_URL: "postgres://wiseeff_api:a@postgres:5432/lab",
      WISEEFF_PUBLICATION_MANAGER_DATABASE_URL:
        "postgres://wiseeff_publication_manager:b@postgres:5432/lab",
    });
    expect(result).toEqual({
      ok: true,
      url: "postgres://wiseeff_publication_manager:b@postgres:5432/lab",
    });
  });

  it("treats identical usernames as reuse even when hosts differ", () => {
    expect(
      publicationManagerDatabaseUrlReusesApiLogin(
        "postgres://wiseeff:x@127.0.0.1:55438/iso",
        "postgres://wiseeff:x@postgres:5432/wiseeff",
      ),
    ).toBe(true);
  });
});

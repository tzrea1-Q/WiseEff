import { describe, expect, it, vi } from "vitest";

vi.mock("../server/config/env", () => ({ loadServerEnv: () => ({ DATABASE_URL: "fixture" }) }));
vi.mock("../server/shared/database/client", () => ({
  createPostgresDatabase: () => ({ close: async () => undefined }),
}));
vi.mock("../server/modules/operations/parameterCatalogComparisonContribution", () => ({
  readTypedVerificationReport: async () => ({
    status: "value", value: { kind: "absent", reason: "missing" },
  }),
}));

import { runReconcileParameterDefinitions } from "./reconcile-parameter-definitions";

describe("UPG-01 release authorization is not a diagnostic query", () => {
  it("rejects the source controller invocation instead of releasing on absent report", async () => {
    const result = await runReconcileParameterDefinitions(["--verify", "--catalog-only"], {});
    expect(result.exitCode).not.toBe(0);
    expect(result.body).toMatchObject({ code: "PCAT-UPG-RELEASE-CONTEXT-UNAVAILABLE" });
  });
});

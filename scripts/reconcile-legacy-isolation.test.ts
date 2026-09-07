import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.resetModules());

describe("reconcile CLI uses the canonical diagnostic seam", () => {
  it("reads typed absence without loading the retired verifier", async () => {
    vi.doMock("../server/modules/parameter-specs/definitionVerification", () => {
      throw new Error("retired verifier module must not load");
    });
    vi.doMock("../server/config/env", () => ({ loadServerEnv: () => ({ DATABASE_URL: "isolated-fixture" }) }));
    const close = vi.fn();
    vi.doMock("../server/shared/database/client", () => ({ createPostgresDatabase: () => ({ close }) }));
    const read = vi.fn(async () => ({ status: "value", value: { kind: "absent", reason: "missing" } }));
    vi.doMock("../server/modules/operations/parameterCatalogComparisonContribution", () => ({ readTypedVerificationReport: read }));
    const { runReconcileParameterDefinitions } = await import("./reconcile-parameter-definitions");
    const result = await runReconcileParameterDefinitions(["--verify", "--diagnostic", "--report-id", "missing"], {});
    expect(result).toEqual({ exitCode: 0, body: { status: "value", value: { kind: "absent", reason: "missing" } } });
    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(await runReconcileParameterDefinitions(["--verify", "--catalog-only"], {})).toMatchObject({ exitCode: 2 });
    expect(read).toHaveBeenCalledOnce();
  });
});

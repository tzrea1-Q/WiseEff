import { describe, expect, it } from "vitest";
import { createAuthContextResolver } from "./contextFactory";
import { developmentAuthContext } from "./routes";

describe("auth context factory", () => {
  it("keeps development auth outside production", async () => {
    const resolve = createAuthContextResolver({ mode: "development", developmentAuthContext });

    await expect(resolve({ headers: {} })).resolves.toEqual(developmentAuthContext);
  });

  it("refuses development fallback in production", async () => {
    expect(() => createAuthContextResolver({ mode: "production", developmentAuthContext })).toThrow(
      "Production auth verifier is required when AUTH_MODE=production."
    );
  });

  it("uses production verifier in production", async () => {
    const resolve = createAuthContextResolver({
      mode: "production",
      verifier: { verify: async () => ({ ...developmentAuthContext, user: { ...developmentAuthContext.user, id: "u-prod" } }) }
    });

    await expect(resolve({ headers: { authorization: "Bearer token" } })).resolves.toMatchObject({
      user: { id: "u-prod" }
    });
  });
});

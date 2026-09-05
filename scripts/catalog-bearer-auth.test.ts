import { afterEach, describe, expect, it, vi } from "vitest";
import { createBearerTokenForUser, authHeadersForUser } from "../e2e/acceptance/helpers/bearerAuth";
import { ACCEPTANCE_ORGANIZATION } from "../e2e/acceptance/helpers/cast";
import { createTokenVerifier } from "../server/modules/auth/tokenVerifier";

afterEach(() => vi.unstubAllEnvs());

describe("Catalog acceptance bearer organization scope", () => {
  it.each([undefined, "org-catalog-b"])("uses the declared organization %s with no self-reported authority", async (organization) => {
    vi.stubEnv("AUTH_TOKEN_ISSUER", "catalog-scope-test");
    vi.stubEnv("AUTH_TOKEN_HMAC_SECRET", "catalog-scope-test-only-secret");
    const authorization = createBearerTokenForUser("test-user", "scope@example.test", "Scope User", organization);
    const verifier = createTokenVerifier({ issuer: "catalog-scope-test", secret: "catalog-scope-test-only-secret" });
    await expect(verifier.verify(authorization ?? undefined)).resolves.toMatchObject({
      organization: { id: organization ?? ACCEPTANCE_ORGANIZATION.id },
      user: { id: "test-user", organizationId: organization ?? ACCEPTANCE_ORGANIZATION.id },
      roles: [],
      permissions: [],
    });
    expect(authHeadersForUser("test-user", "scope@example.test", "Scope User", organization).Authorization).toBe(authorization);
    await expect(createTokenVerifier({ issuer: "catalog-scope-test", secret: "different-test-key" }).verify(authorization ?? undefined)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

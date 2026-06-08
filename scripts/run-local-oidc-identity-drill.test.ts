import { describe, expect, it } from "vitest";
import { createOidcVerifier } from "../server/modules/auth/oidcVerifier";
import { createLocalOidcTokenSet, parseLocalOidcDrillArgs } from "./run-local-oidc-identity-drill";

describe("local OIDC identity drill", () => {
  it("writes local drill evidence separately from target identity evidence by default", () => {
    expect(parseLocalOidcDrillArgs([], {})).toMatchObject({
      output: "docs/generated/m6-local-oidc-identity-evidence.md"
    });
  });

  it("creates RS256 OIDC evidence tokens accepted and rejected by the WiseEff verifier", async () => {
    const now = new Date("2026-06-04T00:00:00.000Z");
    const tokens = createLocalOidcTokenSet({
      issuer: "http://127.0.0.1:8790/realms/wiseeff",
      audience: "wiseeff-api",
      subject: "u-xu-yun",
      organizationId: "org-chargelab",
      now
    });
    const verifier = createOidcVerifier({
      issuer: "http://127.0.0.1:8790/realms/wiseeff",
      audience: "wiseeff-api",
      jwks: tokens.jwks,
      now: () => now
    });

    await expect(verifier.verify(tokens.adminAuthorization)).resolves.toMatchObject({
      user: {
        id: "u-xu-yun",
        organizationId: "org-chargelab",
        emailVerified: true
      }
    });
    await expect(verifier.verify(tokens.wrongIssuerAuthorization)).rejects.toThrow("OIDC token issuer is not trusted.");
    await expect(verifier.verify(tokens.wrongAudienceAuthorization)).rejects.toThrow("OIDC token audience is not accepted.");
    await expect(verifier.verify(tokens.expiredAuthorization)).rejects.toThrow("OIDC token has expired.");
  });
});

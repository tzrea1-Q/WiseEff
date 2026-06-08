import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOidcVerifier } from "./oidcVerifier";

const now = new Date("2026-06-02T00:00:00.000Z");
const exp = Math.floor(now.getTime() / 1000) + 60;

function createKey(kid: string) {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = createPrivateKey(pair.privateKey.export({ format: "pem", type: "pkcs8" }));
  const publicKey = createPublicKey(pair.publicKey.export({ format: "pem", type: "spki" }));
  const jwk = publicKey.export({ format: "jwk" });

  return {
    kid,
    privateKey,
    jwk: { ...jwk, kid, alg: "RS256", use: "sig", kty: "RSA" }
  };
}

function jwt(input: { kid: string; privateKey: ReturnType<typeof createKey>["privateKey"]; claims: Record<string, unknown>; alg?: string }) {
  const header = Buffer.from(JSON.stringify({ alg: input.alg ?? "RS256", typ: "JWT", kid: input.kid }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify(input.claims), "utf8").toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), input.privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function makeClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://id.example.com/realms/wiseeff",
    aud: "wiseeff-api",
    sub: "oidc-user-1",
    exp,
    iat: exp - 60,
    email: "oidc@example.com",
    name: "OIDC User",
    organization_id: "org-chargelab",
    organization_name: "ChargeLab",
    wiseeff_roles: [{ projectId: "aurora", roleId: "admin" }],
    ...overrides
  };
}

describe("OIDC verifier", () => {
  it("maps a valid RS256 OIDC token into the WiseEff auth context", async () => {
    const key = createKey("kid-1");
    const verifier = createOidcVerifier({
      issuer: "https://id.example.com/realms/wiseeff",
      audience: "wiseeff-api",
      discovery: async () => ({ jwksUri: "https://id.example.com/realms/wiseeff/protocol/openid-connect/certs" }),
      fetchJwks: async () => ({ keys: [key.jwk] }),
      now: () => now
    });

    await expect(verifier.verify(`Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims() })}`)).resolves.toMatchObject({
      user: { id: "oidc-user-1", organizationId: "org-chargelab", email: "oidc@example.com", name: "OIDC User" },
      organization: { id: "org-chargelab", name: "ChargeLab" },
      roles: [{ projectId: "aurora", roleId: "admin" }],
      permissions: expect.arrayContaining(["admin:access", "users:manage"])
    });
  });

  it("rejects expired, wrong issuer, wrong audience, unsigned, and invalid role tokens", async () => {
    const key = createKey("kid-1");
    const verifier = createOidcVerifier({
      issuer: "https://id.example.com/realms/wiseeff",
      audience: "wiseeff-api",
      jwks: { keys: [key.jwk] },
      now: () => now
    });

    await expect(
      verifier.verify(`Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims({ exp: Math.floor(now.getTime() / 1000) - 1 }) })}`)
    ).rejects.toThrow("OIDC token has expired.");
    await expect(
      verifier.verify(`Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims({ iss: "https://evil.example.com" }) })}`)
    ).rejects.toThrow("OIDC token issuer is not trusted.");
    await expect(
      verifier.verify(`Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims({ aud: "other-api" }) })}`)
    ).rejects.toThrow("OIDC token audience is not accepted.");
    await expect(verifier.verify("Bearer unsigned.token")).rejects.toThrow("OIDC token format is invalid.");
    await expect(
      verifier.verify(`Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims({ wiseeff_roles: [{ roleId: "owner" }] }) })}`)
    ).rejects.toThrow("OIDC token role claims are invalid.");
  });

  it("accepts identity-only OIDC tokens so WiseEff can load authorization from its database", async () => {
    const key = createKey("kid-1");
    const verifier = createOidcVerifier({
      issuer: "https://id.example.com/realms/wiseeff",
      audience: "wiseeff-api",
      jwks: { keys: [key.jwk] },
      now: () => now
    });

    await expect(
      verifier.verify(`Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims({ wiseeff_roles: undefined }) })}`)
    ).resolves.toMatchObject({
      user: { id: "oidc-user-1", organizationId: "org-chargelab", email: "oidc@example.com" },
      roles: [],
      permissions: []
    });
  });

  it("exposes email verification state for WiseEff account linking", async () => {
    const key = createKey("kid-1");
    const verifier = createOidcVerifier({
      issuer: "https://id.example.com/realms/wiseeff",
      audience: "wiseeff-api",
      jwks: { keys: [key.jwk] },
      now: () => now
    });

    await expect(
      verifier.verify(
        `Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims({ sub: "oidc-user-verified", email_verified: true }) })}`
      )
    ).resolves.toMatchObject({
      user: { id: "oidc-user-verified", email: "oidc@example.com", emailVerified: true }
    });

    await expect(
      verifier.verify(
        `Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims({ sub: "oidc-user-unverified", email_verified: false }) })}`
      )
    ).resolves.toMatchObject({
      user: { id: "oidc-user-unverified", email: "oidc@example.com", emailVerified: false }
    });
  });

  it("rejects JWKS keys that are not RSA RS256 signing keys", async () => {
    const key = createKey("kid-1");
    const token = `Bearer ${jwt({ kid: key.kid, privateKey: key.privateKey, claims: makeClaims() })}`;

    for (const jwk of [
      { ...key.jwk, use: "enc" },
      { ...key.jwk, alg: "RS512" },
      { ...key.jwk, kty: "EC" }
    ]) {
      const verifier = createOidcVerifier({
        issuer: "https://id.example.com/realms/wiseeff",
        audience: "wiseeff-api",
        jwks: { keys: [jwk] },
        now: () => now
      });

      await expect(verifier.verify(token)).rejects.toThrow("OIDC signing key was not found.");
    }
  });

  it("refreshes JWKS when the token key id rotates", async () => {
    const oldKey = createKey("old-kid");
    const nextKey = createKey("next-kid");
    let calls = 0;
    const verifier = createOidcVerifier({
      issuer: "https://id.example.com/realms/wiseeff",
      audience: "wiseeff-api",
      jwks: { keys: [oldKey.jwk] },
      fetchJwks: async () => {
        calls += 1;
        return { keys: [oldKey.jwk, nextKey.jwk] };
      },
      now: () => now
    });

    await expect(verifier.verify(`Bearer ${jwt({ kid: nextKey.kid, privateKey: nextKey.privateKey, claims: makeClaims() })}`)).resolves.toMatchObject({
      user: { id: "oidc-user-1" }
    });
    expect(calls).toBe(1);
  });
});

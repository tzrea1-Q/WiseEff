import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTokenVerifier } from "./tokenVerifier";

function sign(payload: Record<string, unknown>, secret = "test-secret") {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

const now = new Date("2026-05-28T00:00:00.000Z");
const exp = Math.floor(now.getTime() / 1000) + 60;

describe("production token verifier", () => {
  it("maps signed claims into auth context", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret", now: () => now });

    await expect(
      verifier.verify(
        `Bearer ${sign({
          iss: "wiseeff-test",
          sub: "u-prod",
          org: "org-prod",
          exp,
          name: "Prod User",
          email: "prod@example.com",
          title: "Pilot Admin",
          roles: [{ projectId: "aurora", roleId: "admin" }],
          permissions: ["parameter:view", "admin:access"]
        })}`
      )
    ).resolves.toMatchObject({
      user: { id: "u-prod", organizationId: "org-prod", name: "Prod User", email: "prod@example.com", title: "Pilot Admin" },
      organization: { id: "org-prod" },
      roles: [{ projectId: "aurora", roleId: "admin" }],
      permissions: ["parameter:view", "admin:access"]
    });
  });

  it("rejects missing bearer tokens", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret" });

    await expect(verifier.verify(undefined)).rejects.toThrow("Authorization bearer token is required.");
  });

  it("rejects invalid signatures and issuers", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret", now: () => now });

    await expect(verifier.verify(`Bearer ${sign({ iss: "other", sub: "u-prod", org: "org-prod", exp })}`)).rejects.toThrow(
      "Token issuer is not trusted."
    );
    await expect(verifier.verify(`Bearer ${sign({ iss: "wiseeff-test", sub: "u-prod", org: "org-prod", exp }, "wrong")}`)).rejects.toThrow(
      "Token signature is invalid."
    );
  });

  it("requires issuer, subject, and organization claims", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret", now: () => now });

    await expect(verifier.verify(`Bearer ${sign({ iss: "wiseeff-test", sub: "u-prod", exp })}`)).rejects.toThrow(
      "Token issuer, subject, and organization claims are required."
    );
  });

  it("requires an expiration claim", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret", now: () => now });

    await expect(verifier.verify(`Bearer ${sign({ iss: "wiseeff-test", sub: "u-prod", org: "org-prod" })}`)).rejects.toThrow(
      "Token expiration claim is required."
    );
  });

  it("rejects expired tokens", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret", now: () => now });

    await expect(
      verifier.verify(`Bearer ${sign({ iss: "wiseeff-test", sub: "u-prod", org: "org-prod", exp: Math.floor(now.getTime() / 1000) - 1 })}`)
    ).rejects.toThrow("Token has expired.");
  });

  it("rejects tokens before their not-before time", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret", now: () => now });

    await expect(
      verifier.verify(`Bearer ${sign({ iss: "wiseeff-test", sub: "u-prod", org: "org-prod", exp, nbf: Math.floor(now.getTime() / 1000) + 1 })}`)
    ).rejects.toThrow("Token is not valid yet.");
  });
});

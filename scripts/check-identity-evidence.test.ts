import { describe, expect, it } from "vitest";

import {
  buildIdentityEvidenceMarkdown,
  evaluateIdentityEvidence,
  parseIdentityCheckArgs,
  redactIdentitySecret
} from "./check-identity-evidence";

describe("M6.2 identity evidence checker", () => {
  it("passes complete target OIDC evidence and records pending browser evidence separately", () => {
    const result = evaluateIdentityEvidence({
      discovery: { status: "passed", detail: "issuer and jwks_uri discovered" },
      me: { status: "passed", detail: "admin context returned", statusCode: 200 },
      negativeChecks: [
        { name: "wrong issuer", status: "passed", detail: "401 rejected", statusCode: 401 },
        { name: "wrong audience", status: "passed", detail: "401 rejected", statusCode: 401 },
        { name: "expired token", status: "passed", detail: "401 rejected", statusCode: 401 }
      ],
      browserRuntime: "pending"
    });

    expect(result).toEqual({
      status: "failed",
      blockers: [],
      pending: ["Browser token acquisition/refresh/logout evidence is pending."]
    });
  });

  it("fails missing discovery, current user, and required negative checks", () => {
    const result = evaluateIdentityEvidence({
      discovery: { status: "failed", detail: "fetch failed" },
      me: { status: "failed", detail: "401", statusCode: 401 },
      negativeChecks: [{ name: "wrong issuer", status: "passed", detail: "401 rejected", statusCode: 401 }],
      browserRuntime: "failed"
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "OIDC discovery/JWKS evidence failed.",
        "/api/v1/me target token evidence failed.",
        "Missing required negative OIDC token check: wrong audience.",
        "Missing required negative OIDC token check: expired token.",
        "Browser token acquisition/refresh/logout evidence failed."
      ])
    );
  });

  it("renders redacted target identity evidence", () => {
    const markdown = buildIdentityEvidenceMarkdown({
      date: "2026-06-03T00:00:00.000Z",
      issuer: "https://id.example.test/realms/wiseeff?token=secret",
      apiBaseUrl: "https://wiseeff.example.test",
      audience: "wiseeff-api",
      evidenceScope: "target self-hosted OIDC",
      browserRuntime: "passed",
      result: { status: "failed", blockers: [], pending: ["Target evidence is pending."] },
      checks: [
        { name: "OIDC discovery/JWKS", status: "passed", statusCode: 200, detail: "ok" },
        { name: "/api/v1/me", status: "passed", statusCode: 200, detail: "Bearer abc.def.ghi" }
      ]
    });

    expect(markdown).toContain("## M6.2 Identity Evidence");
    expect(markdown).toContain("- Evidence scope: `target self-hosted OIDC`");
    expect(markdown).toContain("| browser token acquisition/refresh/logout | passed | n/a | target browser runtime evidence recorded |");
    expect(markdown).toContain("token=<redacted>");
    expect(markdown).toContain("Bearer <redacted>");
    expect(markdown).not.toContain("secret");
    expect(markdown).not.toContain("abc.def.ghi");
  });

  it("parses equals-form arguments and npm config fallback values", () => {
    expect(
      parseIdentityCheckArgs(
        [
          "--issuer=https://id.example.test/realms/wiseeff",
          "--api-base-url=https://wiseeff.example.test",
          "--audience=wiseeff-api",
          "--authorization=Bearer admin",
          "--wrong-issuer-authorization=Bearer wrong-issuer",
          "--wrong-audience-authorization=Bearer wrong-audience",
          "--expired-authorization=Bearer expired",
          "--browser-runtime=passed"
        ],
        {}
      )
    ).toMatchObject({
      issuer: "https://id.example.test/realms/wiseeff",
      apiBaseUrl: "https://wiseeff.example.test",
      audience: "wiseeff-api",
      authorization: "Bearer admin",
      browserRuntime: "passed"
    });

    expect(parseIdentityCheckArgs([], { npm_config_issuer: "https://id.example.test", npm_config_api_base_url: "https://api.example.test" })).toMatchObject({
      issuer: "https://id.example.test",
      apiBaseUrl: "https://api.example.test"
    });
  });

  it("redacts bearer tokens and common secret query values", () => {
    expect(redactIdentitySecret("Bearer abc.def.ghi https://x.test?client_secret=s3cr3t&token=tok")).toBe(
      "Bearer <redacted> https://x.test?client_secret=<redacted>&token=<redacted>"
    );
  });
});

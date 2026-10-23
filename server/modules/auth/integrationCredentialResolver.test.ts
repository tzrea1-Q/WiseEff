import { timingSafeEqual } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { createAuthContextResolver } from "./contextFactory";
import { allowsIntegrationPrincipal, hashIntegrationSecret, isIntegrationAuthorization, matchesIntegrationSecret, resolveIntegrationCredential } from "./integrationCredentialResolver";
import { requireUserInitiatedInvocation } from "./trustedInvocationPolicy";
import { projectTrustedInvocationForAudit } from "../audit/trustedAudit";

vi.mock("node:crypto", async (original) => {
  const crypto = await original<typeof import("node:crypto")>();
  return { ...crypto, timingSafeEqual: vi.fn(crypto.timingSafeEqual) };
});

const id = "f1016303-7cfa-41ed-9b63-0d953ea769da";
const secret = "s".repeat(43);
const token = `Bearer wie_${id}_${secret}`;
function database(overrides: Record<string, unknown> = {}, organizationStatus = "active") {
  const query = vi.fn<Queryable["query"]>(async <Row,>(sql: string) => sql.includes("from public.organizations")
    ? { rows: [{ id: "org-1", name: "Organization", status: organizationStatus }] as Row[], rowCount: 1 }
    : { rows: [{ id, organization_id: "org-1", name: "CI logs", skill_id: null,
      status: "active", secret_hash: hashIntegrationSecret(secret), last_used_at: new Date(), ...overrides }] as Row[], rowCount: 1 });
  return { query } satisfies Queryable;
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("integration credential resolver", () => {
  it("routes only the wie_ bearer prefix and leaves other user resolvers unchanged", async () => {
    const auth = makeTestAuthContext();
    const userResolver = vi.fn(() => auth);
    const resolve = createAuthContextResolver({ mode: "development", getDevelopmentAuthContext: userResolver });
    for (const authorization of [undefined, "Bearer ordinary-user-token", "Bearer wielder", "Basic wie_secret"]) {
      expect(isIntegrationAuthorization(authorization)).toBe(false);
      expect(await resolve({ headers: { authorization } })).toBe(auth);
    }
    for (const authorization of [token, "Bearer wie_malformed", [token], "bearer wie_invalid"]) {
      expect(isIntegrationAuthorization(authorization)).toBe(true);
      await expect(resolve({ headers: { authorization } })).rejects.toMatchObject({ status: 401 });
    }
    expect(userResolver).toHaveBeenCalledTimes(4);
  });

  it.each([undefined, [token], "Bearer wie_bad", `Bearer wie_${id}_short`, `${token} trailing`, `Basic wie_${id}_${secret}`])(
    "rejects malformed tokens without reading a domain", async (authorization) => {
      const db = database();
      await expect(resolveIntegrationCredential(db, authorization)).rejects.toMatchObject({ status: 401 });
      expect(db.query).not.toHaveBeenCalled();
    });

  it("uses equal-length constant-time digest comparisons for valid, wrong and corrupt hashes", () => {
    expect(matchesIntegrationSecret(secret, hashIntegrationSecret(secret))).toBe(true);
    expect(matchesIntegrationSecret("different", hashIntegrationSecret(secret))).toBe(false);
    expect(matchesIntegrationSecret(secret, "broken hash")).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(3);
    for (const [actual, expected] of vi.mocked(timingSafeEqual).mock.calls) {
      expect(actual.byteLength).toBe(32);
      expect(expected.byteLength).toBe(32);
    }
  });

  it("rejects revoked, unknown and incorrect secrets with the same 401", async () => {
    const unknown = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    for (const db of [database({ status: "revoked" }), database({ secret_hash: hashIntegrationSecret("other") }), unknown]) {
      await expect(resolveIntegrationCredential(db, token)).rejects.toMatchObject({ status: 401 });
      expect(db.query).toHaveBeenCalledTimes(1);
    }
  });

  it("constructs only a machine principal, produces truthful audit provenance and fails human policies", async () => {
    const principal = await resolveIntegrationCredential(database(), token);
    expect(principal).toMatchObject({ kind: "integration", credentialId: id, organizationId: "org-1" });
    expect(principal).not.toHaveProperty("user");
    expect(principal).not.toHaveProperty("permissions");
    expect(projectTrustedInvocationForAudit(principal.invocation)).toEqual({ organizationId: "org-1", actorUserId: null,
      actorType: "integration", metadata: { initiator: "integration", credentialId: id } });
    expect(() => requireUserInitiatedInvocation(principal.invocation)).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("refuses a suspended organization without recording credential use", async () => {
    const db = database({ last_used_at: null }, "suspended");
    await expect(resolveIntegrationCredential(db, token)).rejects.toMatchObject({ status: 403, details: { reason: "organization-suspended" } });
    expect(db.query.mock.calls.some(([sql]) => /^update log_integration_credentials/.test(sql))).toBe(false);
  });

  it("throttles last_used_at to one minute, with a SQL predicate protecting concurrent resolvers", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-19T12:00:00Z");
    vi.setSystemTime(now);
    for (const age of [0, 59_999, 60_000, null]) {
      const db = database({ last_used_at: age === null ? null : new Date(now.getTime() - age) });
      await resolveIntegrationCredential(db, token);
      const updates = db.query.mock.calls.filter(([sql]) => /^update log_integration_credentials/.test(sql));
      expect(updates).toHaveLength(age === null || age >= 60_000 ? 1 : 0);
      if (updates.length) {
        expect(updates[0][0]).toContain("last_used_at <= clock_timestamp() - interval '1 minute'");
        expect(updates[0][1]).toEqual([id, "org-1"]);
      }
    }
  });

  it("allowlists only exact upload and own-record read templates", () => {
    expect(allowsIntegrationPrincipal("POST", "/api/v1/log-files")).toBe(true);
    expect(allowsIntegrationPrincipal("POST", "/api/v1/logs")).toBe(true);
    expect(allowsIntegrationPrincipal("GET", "/api/v1/logs/:logId")).toBe(true);
    expect(allowsIntegrationPrincipal("GET", "/api/v1/logs/:logId/lines")).toBe(true);
    for (const path of [undefined, "/api/v1/me", "/api/v1/logs", "/api/v1/logs/feedback-insights", "/api/v1/logs/:logId/trace", "/api/v1/logs/:logId/runs"]) {
      expect(allowsIntegrationPrincipal("GET", path)).toBe(false);
    }
    expect(allowsIntegrationPrincipal("POST", "/api/v1/logs/:logId")).toBe(false);
  });
});

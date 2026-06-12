import { describe, expect, it } from "vitest";
import { createAuthContextResolver } from "./contextFactory";
import { developmentAuthContext } from "./routes";
import type { Database, QueryResult } from "../../shared/database/client";

function createDbAuthContext(overrides: Partial<typeof developmentAuthContext.user> = {}) {
  const user = { ...developmentAuthContext.user, ...overrides };
  const db: Database = {
    query: async <Row,>(): Promise<QueryResult<Row>> => ({
      rows: [
        {
          user_id: user.id,
          organization_id: user.organizationId,
          organization_name: developmentAuthContext.organization.name,
	          name: user.name,
	          email: user.email,
	          username: null,
	          title: user.title,
          is_active: user.isActive,
          project_id: null,
          role_id: "admin"
        }
      ] as Row[],
      rowCount: 1
    }),
    transaction: async (fn) => fn(db)
  };
  return db;
}

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
      db: createDbAuthContext({ id: "u-prod", email: "prod@example.com" }),
      verifier: { verify: async () => ({ ...developmentAuthContext, user: { ...developmentAuthContext.user, id: "u-prod" } }) }
    });

    await expect(resolve({ headers: { authorization: "Bearer token" } })).resolves.toMatchObject({
      user: { id: "u-prod" }
    });
  });

  it("only falls back to email lookup for verified OIDC email claims", async () => {
    const calls: Array<{ values?: unknown[] }> = [];
    const db: Database = {
      query: async <Row,>(_text: string, values?: unknown[]): Promise<QueryResult<Row>> => {
        calls.push({ values });
        return { rows: [], rowCount: 0 };
      },
      transaction: async (fn) => fn(db)
    };
    const resolve = createAuthContextResolver({
      mode: "production",
      db,
      verifier: {
        verify: async () => ({
          ...developmentAuthContext,
          user: {
            ...developmentAuthContext.user,
            id: "oidc-subject",
            email: "mapped@example.com",
            emailVerified: false
          }
        })
      }
    });

    await expect(resolve({ headers: { authorization: "Bearer token" } })).rejects.toThrow("User is not authenticated.");
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([developmentAuthContext.user.organizationId, "oidc-subject"]);
  });

  it("uses verified OIDC email claims for migration-only account linking", async () => {
    const user = { ...developmentAuthContext.user, id: "u-by-email", email: "mapped@example.com" };
    const calls: Array<{ values?: unknown[] }> = [];
    const db: Database = {
      query: async <Row,>(_text: string, values?: unknown[]): Promise<QueryResult<Row>> => {
        calls.push({ values });
        const rows =
          calls.length === 1
            ? []
            : [
                {
                  user_id: user.id,
                  organization_id: user.organizationId,
                  organization_name: developmentAuthContext.organization.name,
	                  name: user.name,
	                  email: user.email,
	                  username: null,
	                  title: user.title,
                  is_active: user.isActive,
                  project_id: null,
                  role_id: "admin"
                }
              ];
        return { rows: rows as Row[], rowCount: rows.length };
      },
      transaction: async (fn) => fn(db)
    };
    const resolve = createAuthContextResolver({
      mode: "production",
      db,
      verifier: {
        verify: async () => ({
          ...developmentAuthContext,
          user: {
            ...developmentAuthContext.user,
            id: "oidc-subject",
            email: "mapped@example.com",
            emailVerified: true
          }
        })
      }
    });

    await expect(resolve({ headers: { authorization: "Bearer token" } })).resolves.toMatchObject({
      user: { id: "u-by-email" }
    });
    expect(calls.map((call) => call.values)).toEqual([
      [developmentAuthContext.user.organizationId, "oidc-subject"],
      [developmentAuthContext.user.organizationId, "mapped@example.com"]
    ]);
  });
});

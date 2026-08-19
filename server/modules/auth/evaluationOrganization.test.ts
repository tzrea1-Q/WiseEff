import { describe, expect, it } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import {
  DEFAULT_BOOTSTRAP_ORGANIZATION_NAME,
  EVALUATION_ORGANIZATION_ID,
  resolveBootstrapOrganization,
  resolveEvaluationOrganization
} from "./evaluationOrganization";

type OrgRow = { id: string; name: string };

function createOrgDb(organizations: OrgRow[]) {
  const query = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.includes("where id = $1")) {
      const match = organizations.find((organization) => organization.id === values[0]);
      return { rows: (match ? [match] : []) as Row[], rowCount: match ? 1 : 0 };
    }
    if (normalized.includes("id <> all($1::text[])")) {
      const retired = new Set(values[0] as string[]);
      const rows = organizations.filter((organization) => !retired.has(organization.id));
      return { rows: rows as Row[], rowCount: rows.length };
    }
    return { rows: [] as Row[], rowCount: 0 };
  };
  const db: Database = {
    query,
    transaction: async (fn) => fn({ query } satisfies Queryable)
  };
  return db;
}

describe("resolveEvaluationOrganization", () => {
  it("joins ChargeLab when the evaluation organization exists", async () => {
    const organization = await resolveEvaluationOrganization(
      createOrgDb([
        { id: EVALUATION_ORGANIZATION_ID, name: "ChargeLab" },
        { id: "org-hardware-department", name: "硬件部" }
      ])
    );

    expect(organization).toEqual({ id: EVALUATION_ORGANIZATION_ID, name: "ChargeLab" });
  });

  it("joins the single non-department organization when ChargeLab is absent", async () => {
    const organization = await resolveEvaluationOrganization(
      createOrgDb([
        { id: "org-acme", name: "Acme" },
        { id: "org-hardware-department", name: "硬件部" }
      ])
    );

    expect(organization).toEqual({ id: "org-acme", name: "Acme" });
  });

  it("fails closed when no joinable organization exists", async () => {
    await expect(resolveEvaluationOrganization(createOrgDb([{ id: "org-hardware-department", name: "硬件部" }]))).rejects.toMatchObject({
      code: "VALIDATION_FAILED"
    });
  });

  it("fails closed when multiple joinable organizations exist", async () => {
    await expect(
      resolveEvaluationOrganization(
        createOrgDb([
          { id: "org-a", name: "A" },
          { id: "org-b", name: "B" }
        ])
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("resolveBootstrapOrganization", () => {
  it("joins ChargeLab even when other organizations exist", async () => {
    const organization = await resolveBootstrapOrganization(
      createOrgDb([
        { id: EVALUATION_ORGANIZATION_ID, name: "ChargeLab" },
        { id: "org-a", name: "A" }
      ]),
      { organizationName: "Ignored" }
    );

    expect(organization).toEqual({ id: EVALUATION_ORGANIZATION_ID, name: "ChargeLab", created: false });
  });

  it("creates a neutral organization when the database has no joinable tenant", async () => {
    const organization = await resolveBootstrapOrganization(createOrgDb([{ id: "org-hardware-department", name: "硬件部" }]));

    expect(organization.created).toBe(true);
    expect(organization.name).toBe(DEFAULT_BOOTSTRAP_ORGANIZATION_NAME);
    expect(organization.id).toMatch(/^org-/);
    expect(organization.id).not.toBe("org-hardware-department");
  });

  it("rejects Hardware Department as a bootstrap name", async () => {
    await expect(
      resolveBootstrapOrganization(createOrgDb([]), { organizationName: "硬件部" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("fails closed when many organizations exist without a matching name", async () => {
    await expect(
      resolveBootstrapOrganization(
        createOrgDb([
          { id: "org-a", name: "A" },
          { id: "org-b", name: "B" }
        ])
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { CatalogSubjectId } from "../../parameter-catalog-contract/index";
import { createGovernanceCatalogQueries, GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "../../parameter-governance/queries";
import { createRegistrationProjectionFromQueries } from "./ports";

const a = CatalogSubjectId("csub_batch_a");
const b = CatalogSubjectId("csub_batch_b");
const input = { organizationId: "org-batch", principalId: "principal-batch", canRegister: true, observedRelease: { id: "crel_batch", digest: `sha256:${"a".repeat(64)}` } };

function fixture() {
  const sql = vi.fn(async () => { throw new Error("unexpected SQL"); });
  const queries = createGovernanceCatalogQueries({ query: sql });
  const project = vi.spyOn(queries, "projectRegistrations");
  return { port: createRegistrationProjectionFromQueries(queries), project, sql };
}

describe("R2-BATCH page registration port", () => {
  it("deduplicates stable IDs and associates out-of-order results by ID", async () => {
    const { port, project } = fixture();
    project.mockResolvedValue({ ok: true, value: { semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS, projections: [
      { subjectId: b, registration: { status: "unregistered" }, reviewCount: 7 },
      { subjectId: a, registration: { status: "unregistered" }, reviewCount: 2 },
    ] } });
    const result = await port.projectSubjects({ ...input, subjectIds: [a, b, a] });
    expect(project).toHaveBeenCalledExactlyOnceWith({ organizationId: input.organizationId, subjectIds: [a, b], authScope: { organizationId: input.organizationId, principalId: input.principalId }, observedRelease: input.observedRelease });
    expect(result.get(a)?.reviewCount).toBe(2);
    expect(result.get(b)?.reviewCount).toBe(7);
  });
  it("empty input issues no domain query or SQL", async () => {
    const { port, project, sql } = fixture();
    expect(await port.projectSubjects({ ...input, subjectIds: [] })).toEqual(new Map());
    expect(project).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });
  it("missing required result fails closed instead of fabricating unregistered/zero", async () => {
    const { port, project } = fixture();
    project.mockResolvedValue({ ok: true, value: { semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS, projections: [] } });
    await expect(port.projectSubjects({ ...input, subjectIds: [a] })).rejects.toMatchObject({ failure: { kind: "query-unavailable" } });
  });
  it("dependency failure is not an empty successful projection", async () => {
    const { port, project } = fixture();
    project.mockRejectedValue(new Error("controlled dependency failure"));
    await expect(port.projectSubjects({ ...input, subjectIds: [a] })).rejects.toThrow("controlled dependency failure");
  });
});

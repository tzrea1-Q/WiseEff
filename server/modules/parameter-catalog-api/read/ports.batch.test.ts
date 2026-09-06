import { describe, expect, it, vi } from "vitest";
import { CatalogSubjectId, ParameterDefinitionId } from "../../parameter-catalog-contract/index";
import { createGovernanceCatalogQueries, GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "../../parameter-governance/queries";
import { createUsageQueries, USAGE_CURRENT_PROJECTION_SEMANTICS } from "../../parameter-bindings/usage";
import { createRegistrationProjectionFromQueries, createUsageProjectionFromQueries } from "./ports";
import type { UsageProjectionPort } from "./types";

const a = CatalogSubjectId("csub_batch_a");
const b = CatalogSubjectId("csub_batch_b");
const input = { organizationId: "org-batch", principalId: "principal-batch", projectScope: { kind: "all" as const }, canRegister: true, observedRelease: { id: "crel_batch", digest: `sha256:${"a".repeat(64)}` } };

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
  it.each(["projectSubject", "projectDefinition"] as const)("R2-DETAIL %s missing required result is unavailable, not unregistered", async (method) => {
    const { port, project } = fixture();
    project.mockResolvedValue({ ok: true, value: { semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS, projections: [] } });
    await expect(port[method]({ ...input, subjectId: a })).rejects.toMatchObject({ failure: { kind: "query-unavailable" } });
  });
  it("R2-DETAIL single Subject/Definition projections select the requested stable ID", async () => {
    const { port, project } = fixture();
    project.mockResolvedValue({ ok: true, value: { semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS, projections: [
      { subjectId: b, registration: { status: "retired", id: "registration-other" }, reviewCount: 7 },
      { subjectId: a, registration: { status: "unregistered" }, reviewCount: 2 },
    ] } });
    expect(await port.projectSubject({ ...input, subjectId: a })).toEqual({ registration: { status: "unregistered" }, reviewCount: 2 });
    expect(await port.projectDefinition({ ...input, subjectId: a })).toEqual({ status: "unregistered" });
  });
  it("dependency failure is not an empty successful projection", async () => {
    const { port, project } = fixture();
    project.mockRejectedValue(new Error("controlled dependency failure"));
    await expect(port.projectSubjects({ ...input, subjectIds: [a] })).rejects.toThrow("controlled dependency failure");
  });
});

describe("R2-BATCH page usage port", () => {
  const first = ParameterDefinitionId("pdef_batch_a");
  const second = ParameterDefinitionId("pdef_batch_b");
  function usageFixture() {
    const sql = vi.fn(async () => { throw new Error("unexpected SQL"); });
    const queries = createUsageQueries({ query: sql });
    return { port: createUsageProjectionFromQueries(queries), summarize: vi.spyOn(queries, "summarize"), sql };
  }
  it("deduplicates a page and associates usage by stable ID, retaining the existing projection scope", async () => {
    const { port, summarize } = usageFixture();
    summarize.mockResolvedValue({ ok: true, value: { semantics: USAGE_CURRENT_PROJECTION_SEMANTICS, summaries: [
      { definitionId: second, policyCount: 0, projectCount: 3, currentValueCount: 5 },
      { definitionId: first, policyCount: 0, projectCount: 1, currentValueCount: 2 },
    ] } });
    const result = await port.summarizeMany({ ...input, definitionIds: [first, second, first] });
    expect(summarize).toHaveBeenCalledExactlyOnceWith({ organizationId: input.organizationId, definitionIds: [first, second], projectScope: { kind: "all" }, authScope: { organizationId: input.organizationId, principalId: input.principalId } });
    expect(result.get(first)).toEqual({ policyCount: 0, projectCount: 1, currentValueCount: 2 });
    expect(result.get(second)).toEqual({ policyCount: 0, projectCount: 3, currentValueCount: 5 });
    // Policy remains outside the project/current-value scope acceptance.
  });
  it("empty input issues no usage query", async () => {
    const { port, summarize, sql } = usageFixture();
    expect(await port.summarizeMany({ ...input, definitionIds: [] })).toEqual(new Map());
    expect(summarize).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });
  it.each([{ ids: ["project-a", "project-b", "project-a"] }, { ids: [] }])("forwards only scope $ids without promoting it to all", async ({ ids }) => {
    const { port, summarize } = usageFixture();
    summarize.mockResolvedValue({ ok: true, value: { semantics: USAGE_CURRENT_PROJECTION_SEMANTICS, summaries: [{ definitionId: first, policyCount: 0, projectCount: 0, currentValueCount: 0 }] } });
    const result = await port.summarizeMany({ ...input, definitionIds: [first], projectScope: { kind: "only", ids } });
    expect(summarize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ projectScope: { kind: "only", ids: [...new Set(ids)] } }));
    expect(result.get(first)).toEqual({ policyCount: 0, projectCount: 0, currentValueCount: 0 });
  });
  it.each([undefined, null, {}, { kind: "unknown" }, { kind: "only" }, { kind: "only", ids: null }, { kind: "only", ids: [undefined] }, { kind: "only", ids: [""] }, { kind: "only", ids: [" padded"] }, { kind: "only", ids: ["bad\u0000id"] }])("rejects malformed trusted project scope %j before querying", async (projectScope) => {
    const { port, summarize, sql } = usageFixture();
    // Controlled invalid runtime input, not a forged trusted production identity.
    const malformed = { ...input, definitionIds: [first], projectScope } as Parameters<UsageProjectionPort["summarizeMany"]>[0];
    await expect(port.summarizeMany(malformed)).rejects.toMatchObject({ failure: { kind: "invalid-query", reason: "projectScope" } });
    await expect(port.summarizeMany({ ...malformed, definitionIds: [] })).rejects.toMatchObject({ failure: { kind: "invalid-query", reason: "projectScope" } });
    expect(summarize).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });
  it("missing required summary fails closed for both batch and single detail", async () => {
    const { port, summarize } = usageFixture();
    summarize.mockResolvedValue({ ok: true, value: { semantics: USAGE_CURRENT_PROJECTION_SEMANTICS, summaries: [] } });
    await expect(port.summarizeMany({ ...input, definitionIds: [first] })).rejects.toMatchObject({ failure: { kind: "query-unavailable" } });
    await expect(port.summarize({ ...input, definitionId: first })).rejects.toMatchObject({ failure: { kind: "query-unavailable" } });
  });
  it.each(["timeout", "dependency-failure", "query-unavailable"] as const)("retains %s rather than returning zero", async (kind) => {
    const { port, summarize } = usageFixture();
    summarize.mockResolvedValue({ ok: false, error: { kind, operation: "summarizeUsage" } });
    await expect(port.summarizeMany({ ...input, definitionIds: [first] })).rejects.toMatchObject({ failure: { kind, operation: "summarizeUsage" } });
  });
});

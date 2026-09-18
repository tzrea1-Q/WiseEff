import { expect, it, vi } from "vitest";
import { createDbLogAnalysisToolBackends } from "./dbToolBackends";

it("uses an immutable database root without wrapping query for related-parameter or knowledge search", async () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const db = Object.freeze({ query });
  const tools = createDbLogAnalysisToolBackends({
    db,
    organizationId: "org",
    relatedParameterId: "binding",
    logDomainId: "domain-1"
  });
  expect(await tools.loadRelatedParameterContext!()).toBeNull();
  const relatedQueryCount = query.mock.calls.length;
  expect(relatedQueryCount).toBeGreaterThan(0);
  await tools.searchDomainKnowledge("iin_max");
  expect(db.query).toBe(query);
  expect(query.mock.calls.length).toBeGreaterThan(relatedQueryCount);
  const knowledgeSql = query.mock.calls.slice(relatedQueryCount).map(([sql]) => String(sql));
  expect(knowledgeSql.some((sql) => sql.includes("log_domain_knowledge_links"))).toBe(true);
  for (const [sql] of query.mock.calls) {
    expect(String(sql)).not.toContain("ps.specification_key");
  }
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("coalesce(psv.display_name, dps.property_key)"),
    ["org", "binding"]
  );
});

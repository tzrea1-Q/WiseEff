import { expect, it, vi } from "vitest";
import { createDbLogAnalysisToolBackends } from "./dbToolBackends";

it("uses an immutable database root without changing its query method", async () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const db = Object.freeze({ query });
  const tools = createDbLogAnalysisToolBackends({ db, organizationId: "org", relatedParameterId: "binding" });
  expect(await tools.loadRelatedParameterContext!()).toBeNull();
  expect(db.query).toBe(query);
  expect(query).toHaveBeenCalledWith(expect.not.stringContaining("ps.specification_key"), ["org", "binding"]);
});

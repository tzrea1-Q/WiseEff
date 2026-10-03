import { describe, expect, it } from "vitest";
import type { Queryable } from "../../../shared/database/client";
import { readRetainedDismissedCompatibleIdentities } from "./retainedDismissedIdentities";

const identity = { organization_id: "org", id: "old-row", compatible: "Vendor,Complete Value" };
const queryResult = (rows: unknown): Queryable => ({
  query: async () => ({ rows, rowCount: null }) as never,
});

describe("retained historical identity response boundary", () => {
  it("preserves bytes and accepts an actually empty inventory", async () => {
    expect(await readRetainedDismissedCompatibleIdentities(queryResult([identity]), "org"))
      .toEqual([{ organizationId: "org", id: identity.id, compatible: identity.compatible }]);
    expect(await readRetainedDismissedCompatibleIdentities(queryResult([]), "org")).toEqual([]);
  });
  it.each([
    undefined, {}, [null], [{ ...identity, organization_id: "other" }],
    [{ ...identity, id: "" }], [{ ...identity, compatible: null }],
    [identity, identity], [identity, { ...identity, id: "earlier" }],
  ])("rejects invalid/incomplete response %j instead of returning zero", async (rows) => {
    await expect(readRetainedDismissedCompatibleIdentities(queryResult(rows), "org")).rejects.toThrow();
  });
  it("rejects an empty organization and propagates database failure", async () => {
    await expect(readRetainedDismissedCompatibleIdentities(queryResult([]), " ")).rejects.toThrow();
    const failure = new Error("identity-source-unavailable");
    await expect(readRetainedDismissedCompatibleIdentities({ query: async () => { throw failure; } }, "org"))
      .rejects.toBe(failure);
  });
});

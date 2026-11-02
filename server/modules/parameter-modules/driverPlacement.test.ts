import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { getDriverRegistrationDefaultBusinessCategoryId } from "./driverPlacement";

describe("getDriverRegistrationDefaultBusinessCategoryId", () => {
  it("returns null for a missing default without moving modules", async () => {
    const query = vi.fn(async (_text: string) => ({ rows: [], rowCount: 0 }));

    await expect(getDriverRegistrationDefaultBusinessCategoryId({ query } as Queryable, {
      organizationId: "org-1",
      attributionSubjectId: "subj-auto",
    })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([text]) =>
      /^\s*select\b/i.test(String(text)) &&
      !/\b(insert|update|delete|merge)\b/i.test(String(text)),
    )).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { Database } from "../shared/database/client";
import { seedParameterDashboardFixture } from "./parameterDashboardFixture";

describe("parameter dashboard fixture namespace", () => {
  it("never mutates the shared product seed organization or projects", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db = {
      query,
      transaction: vi.fn()
    } as unknown as Database;

    await seedParameterDashboardFixture(db);

    const argumentsPassed = query.mock.calls.flatMap((call) => call[1] ?? []);
    expect(argumentsPassed).not.toContain("org-chargelab");
    expect(argumentsPassed).not.toContain("aurora");
    expect(argumentsPassed).not.toContain("nebula");
  });
});

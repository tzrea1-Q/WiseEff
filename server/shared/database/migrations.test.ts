import { describe, expect, it } from "vitest";
import { getPendingMigrations } from "./migrations";

describe("getPendingMigrations", () => {
  it("returns migrations that have not been applied", () => {
    const pending = getPendingMigrations(["0001_m0_foundation.sql", "0002_next.sql"], ["0001_m0_foundation.sql"]);

    expect(pending).toEqual(["0002_next.sql"]);
  });
});

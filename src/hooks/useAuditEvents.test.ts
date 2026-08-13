import { describe, expect, it } from "vitest";
import { auditTimeWindowFrom } from "./useAuditEvents";

describe("auditTimeWindowFrom", () => {
  it("maps windows to start timestamps", () => {
    const now = new Date("2026-08-13T10:00:00.000Z");
    expect(auditTimeWindowFrom("all", now)).toBeUndefined();
    expect(auditTimeWindowFrom("7d", now)).toBe("2026-08-06T10:00:00.000Z");
    expect(auditTimeWindowFrom("30d", now)).toBe("2026-07-14T10:00:00.000Z");
    expect(auditTimeWindowFrom("today", now)?.endsWith("Z")).toBe(true);
  });
});

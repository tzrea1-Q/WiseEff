import { describe, expect, it } from "vitest";
import { canPerform, compareRoles } from "./policy";

describe("auth policy", () => {
  it("orders roles by operational authority", () => {
    expect(compareRoles("guest", "hardware-user")).toBeLessThan(0);
    expect(compareRoles("software-user", "hardware-user")).toBe(0);
    expect(compareRoles("hardware-committer", "software-user")).toBeGreaterThan(0);
    expect(compareRoles("admin", "software-committer")).toBeGreaterThan(0);
  });

  it("checks action permissions", () => {
    expect(canPerform("guest", "parameter:edit")).toBe(false);
    expect(canPerform("hardware-user", "parameter:edit")).toBe(true);
    expect(canPerform("software-user", "debugging:use")).toBe(true);
    expect(canPerform("software-user", "parameter:review")).toBe(false);
    expect(canPerform("hardware-committer", "parameter:review")).toBe(true);
    expect(canPerform("admin", "users:manage")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { createApiInitialState, createPrototypeState, initialState } from "./mockData";
import type { PrototypeState } from "@/domain/prototype/types";
import { createEmptyPowerManagementConfig } from "./powerManagementConfig";

type RetiredSlice = "developers" | "logAdminUsers";
type UnexpectedRetiredSlice = Extract<keyof PrototypeState, RetiredSlice>;
const _prototypeStateHasNoRetiredSlices: [UnexpectedRetiredSlice] extends [never] ? true : never = true;
void _prototypeStateHasNoRetiredSlices;

describe("createApiInitialState leftover slices", () => {
  it("boots API mode with empty auditEvents", () => {
    expect(createApiInitialState().auditEvents).toEqual([]);
  });

  it("does not carry retired developers or logAdminUsers fields", () => {
    const apiState = createApiInitialState();
    const mockState = createPrototypeState();

    expect(apiState).not.toHaveProperty("developers");
    expect(apiState).not.toHaveProperty("logAdminUsers");
    expect(mockState).not.toHaveProperty("developers");
    expect(mockState).not.toHaveProperty("logAdminUsers");
  });

  it("keeps non-empty auditEvents on mock-mode initialState and createPrototypeState", () => {
    expect(initialState.auditEvents.length).toBeGreaterThan(0);
    expect(createPrototypeState().auditEvents.length).toBeGreaterThan(0);
  });

  it("boots API mode with an explicit empty power-management config, not a spread mock snapshot", () => {
    const empty = createEmptyPowerManagementConfig();
    const apiState = createApiInitialState();

    expect(apiState.configDraft).toEqual(empty);
    expect(apiState.persistedConfigSnapshot).toEqual(empty);
    expect(Object.keys(apiState.persistedConfigSnapshot).sort()).toEqual([
      "debugParameters",
      "parameterLibrary",
      "parameterModules",
      "projects"
    ]);
    expect(apiState.persistedConfigSnapshot).not.toBe(apiState.configDraft);
  });
});

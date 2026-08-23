import { describe, expect, it, vi } from "vitest";

import {
  OWNED_ACCEPTANCE_RUNTIME_FLAG_ENV,
  loadAcceptanceEnvironment,
} from "../e2e/acceptance/helpers/acceptanceEnvironment";

describe("acceptance environment loading contract", () => {
  it("validates an owned descriptor and never loads an implicit dotenv file", () => {
    const loadDotenv = vi.fn();
    const validateOwnedRuntime = vi.fn(() => ({ run: { id: "owned-gate0" } }));

    const result = loadAcceptanceEnvironment({
      env: {
        WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "/tmp/owned/runtime.json",
      },
      loadDotenv,
      validateOwnedRuntime,
    });

    expect(result).toMatchObject({ mode: "owned-descriptor", ownedRuntime: { run: { id: "owned-gate0" } } });
    expect(validateOwnedRuntime).toHaveBeenCalledOnce();
    expect(loadDotenv).not.toHaveBeenCalled();
  });

  it("uses the explicit owned-runtime flag for descriptor-free nested workers without loading dotenv", () => {
    const loadDotenv = vi.fn();

    expect(loadAcceptanceEnvironment({
      env: { [OWNED_ACCEPTANCE_RUNTIME_FLAG_ENV]: "true" },
      loadDotenv,
    })).toEqual({ mode: "owned-flag" });
    expect(loadDotenv).not.toHaveBeenCalled();
  });

  it("keeps legacy and manual runners on their explicit dotenv file", () => {
    const loadDotenv = vi.fn();

    expect(loadAcceptanceEnvironment({
      env: { WISEEFF_ACCEPTANCE_ENV_FILE: "manual.env" },
      loadDotenv,
    })).toEqual({ mode: "legacy" });
    expect(loadDotenv).toHaveBeenCalledWith({ path: "manual.env" });
  });

  it("fails closed on an invalid owned descriptor instead of falling back to dotenv", () => {
    const loadDotenv = vi.fn();

    expect(() => loadAcceptanceEnvironment({
      env: { WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "/tmp/invalid/runtime.json" },
      loadDotenv,
      validateOwnedRuntime: () => { throw new Error("descriptor identity mismatch"); },
    })).toThrow("descriptor identity mismatch");
    expect(loadDotenv).not.toHaveBeenCalled();
  });
});

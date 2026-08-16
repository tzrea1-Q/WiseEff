import { describe, expect, it } from "vitest";

import {
  guardActivateParameterSpec,
  guardDeprecateParameterSpec,
  guardRestoreParameterSpec,
  guardUpdateParameterSpec,
  nextSpecLifecycleAfterRestore
} from "./specLifecycleGuard";

describe("guardActivateParameterSpec", () => {
  it("allows only draft specs", () => {
    expect(guardActivateParameterSpec("draft", "spec-1")).toEqual({ ok: true });
  });

  it("rejects activate when the spec is not a draft", () => {
    expect(guardActivateParameterSpec("active", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Only draft parameter specs can be activated.",
      details: { specId: "spec-1" }
    });
    expect(guardActivateParameterSpec("deprecated", "spec-1")).toMatchObject({
      ok: false,
      code: "CONFLICT"
    });
  });
});

describe("guardUpdateParameterSpec", () => {
  it("rejects update on a draft spec", () => {
    expect(guardUpdateParameterSpec("draft", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Draft specs must be activated, not updated.",
      details: { specId: "spec-1" }
    });
  });

  it("allows update of active and deprecated specs", () => {
    expect(guardUpdateParameterSpec("active", "spec-1")).toEqual({ ok: true });
    expect(guardUpdateParameterSpec("deprecated", "spec-1")).toEqual({ ok: true });
  });
});

describe("guardDeprecateParameterSpec", () => {
  it("allows draft and active specs", () => {
    expect(guardDeprecateParameterSpec("draft", "spec-1")).toEqual({ ok: true });
    expect(guardDeprecateParameterSpec("active", "spec-1")).toEqual({ ok: true });
  });

  it("rejects deprecate when the spec is already deprecated", () => {
    expect(guardDeprecateParameterSpec("deprecated", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Only draft or active parameter specs can be deprecated.",
      details: { specId: "spec-1" }
    });
  });
});

describe("guardRestoreParameterSpec", () => {
  it("allows only deprecated specs", () => {
    expect(guardRestoreParameterSpec("deprecated", "spec-1")).toEqual({ ok: true });
  });

  it("rejects restore when the spec is not deprecated", () => {
    expect(guardRestoreParameterSpec("draft", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Only deprecated parameter specs can be restored.",
      details: { specId: "spec-1" }
    });
    expect(guardRestoreParameterSpec("active", "spec-1")).toMatchObject({
      ok: false,
      code: "CONFLICT"
    });
  });
});

describe("nextSpecLifecycleAfterRestore", () => {
  it("returns active when the spec was previously activated", () => {
    expect(nextSpecLifecycleAfterRestore("2026-07-14T10:00:00.000Z")).toBe("active");
  });

  it("returns draft when the spec was never activated", () => {
    expect(nextSpecLifecycleAfterRestore(null)).toBe("draft");
    expect(nextSpecLifecycleAfterRestore(undefined)).toBe("draft");
  });
});

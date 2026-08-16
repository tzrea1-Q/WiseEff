import type { DomainGuardResult } from "../guardResult";
import type { SpecLifecycle } from "./types";

export function guardActivateParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle !== "draft") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Only draft parameter specs can be activated.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function guardUpdateParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle === "draft") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Draft specs must be activated, not updated.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function guardDeprecateParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle !== "draft" && lifecycle !== "active") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Only draft or active parameter specs can be deprecated.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function guardRestoreParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle !== "deprecated") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Only deprecated parameter specs can be restored.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function nextSpecLifecycleAfterRestore(activatedAt: string | null | undefined): SpecLifecycle {
  return activatedAt ? "active" : "draft";
}

import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_RELEASE_ID,
  catalogReviewItem,
  readyCatalogDocument,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import { catalogConflictReasons } from "@/application/parameter-catalog/states";

import {
  REVIEW_RESOLUTION_COMMAND,
  canExecuteGovernanceAction,
  createGovernanceSubmitGate,
  executeGovernanceWrite,
  fingerprintGovernanceDraft,
  governanceConflictCopy,
  governanceFailureMessage,
  placementIntentFromChoice,
  prepareGovernanceWrite,
  proposalOutcomeMaterializesDefinition,
  reviewItemGovernanceState,
  writeActionNeedsIfMatch
} from "./governanceState";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });
const unregistered = deriveCatalogDomainState({
  document: readyCatalogDocument,
  subject: unregisteredSubject
});
const loading = deriveCatalogDomainState({
  inFlight: true,
  previousReleaseId: CATALOG_RELEASE_ID
});

describe("governance write algebra", () => {
  it("keeps Agent mutations denied in every closed state and never invokes the write", async () => {
    const write = vi.fn();
    expect(canExecuteGovernanceAction("agent", "register-subject", unregistered)).toBe(false);
    expect(canExecuteGovernanceAction("agent", "resolve-review-item", ready)).toBe(false);
    expect(canExecuteGovernanceAction("agent", "accept-proposal", ready)).toBe(false);

    const prepared = prepareGovernanceWrite({
      actor: "agent",
      action: "register-subject",
      state: unregistered,
      catalogReleaseId: CATALOG_RELEASE_ID,
      draftFingerprint: "draft"
    });
    expect(prepared.status).toBe("denied");
    if (prepared.status === "denied") {
      expect(prepared.reason).toBe("actor");
    }

    const execution = await executeGovernanceWrite({
      actor: "agent",
      action: "register-subject",
      state: unregistered,
      catalogReleaseId: CATALOG_RELEASE_ID,
      draftFingerprint: "draft",
      draft: { reason: "should not send" },
      write
    });
    expect(execution.outcome).toBe("denied");
    expect(execution.silentRetry).toBe(false);
    expect(execution.draft).toEqual({ reason: "should not send" });
    expect(write).not.toHaveBeenCalled();
  });

  it("separates Org Admin registration from Platform Admin proposal review", () => {
    expect(canExecuteGovernanceAction("org-admin", "register-subject", unregistered)).toBe(true);
    expect(canExecuteGovernanceAction("org-admin", "resolve-review-item", unregistered)).toBe(true);
    expect(canExecuteGovernanceAction("org-admin", "update-placement", unregistered)).toBe(false);
    expect(canExecuteGovernanceAction("org-admin", "accept-proposal", ready)).toBe(false);
    expect(canExecuteGovernanceAction("platform-admin", "register-subject", unregistered)).toBe(false);
    expect(canExecuteGovernanceAction("platform-admin", "accept-proposal", ready)).toBe(true);
    expect(canExecuteGovernanceAction("user", "create-proposal", ready)).toBe(true);
    expect(canExecuteGovernanceAction("user", "register-subject", unregistered)).toBe(false);
  });

  it("disables mutations while loading even when a previous release is visible", () => {
    expect(canExecuteGovernanceAction("org-admin", "register-subject", loading)).toBe(false);
    expect(canExecuteGovernanceAction("platform-admin", "accept-proposal", loading)).toBe(false);
    const prepared = prepareGovernanceWrite({
      actor: "org-admin",
      action: "resolve-review-item",
      state: loading,
      catalogReleaseId: CATALOG_RELEASE_ID,
      ifMatch: "etag-1",
      draftFingerprint: "draft"
    });
    expect(prepared.status).toBe("denied");
  });

  it("requires If-Match for existing resources and omits it for new Registration and Proposal", () => {
    expect(writeActionNeedsIfMatch("register-subject")).toBe(false);
    expect(writeActionNeedsIfMatch("create-proposal")).toBe(false);
    expect(writeActionNeedsIfMatch("update-placement")).toBe(true);
    expect(writeActionNeedsIfMatch("resolve-review-item")).toBe(true);
    expect(writeActionNeedsIfMatch("accept-proposal")).toBe(true);

    const missing = prepareGovernanceWrite({
      actor: "org-admin",
      action: "resolve-review-item",
      state: ready,
      catalogReleaseId: CATALOG_RELEASE_ID,
      draftFingerprint: "draft"
    });
    expect(missing.status).toBe("denied");
    if (missing.status === "denied") {
      expect(missing.reason).toBe("missing-etag");
    }

    const register = prepareGovernanceWrite({
      actor: "org-admin",
      action: "register-subject",
      state: unregistered,
      catalogReleaseId: CATALOG_RELEASE_ID,
      draftFingerprint: "draft",
      createIdempotencyKey: () => "key-reg"
    });
    expect(register.status).toBe("ready");
    if (register.status === "ready") {
      expect(register.context).toEqual({
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: "key-reg"
      });
      expect(register.context).not.toHaveProperty("ifMatch");
    }
  });

  it("blocks a second in-flight command instead of silently retrying", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    const gate = createGovernanceSubmitGate();
    const input = {
      actor: "org-admin" as const,
      action: "register-subject" as const,
      state: unregistered,
      catalogReleaseId: CATALOG_RELEASE_ID,
      draftFingerprint: fingerprintGovernanceDraft({ mode: "use-default" }),
      createIdempotencyKey: vi.fn(() => "key-1")
    };

    const first = gate.begin(input);
    expect(first.status).toBe("ready");
    const second = gate.begin(input);
    expect(second.status).toBe("in-flight");
    expect(input.createIdempotencyKey).toHaveBeenCalledTimes(1);

    const execution = await executeGovernanceWrite({
      ...input,
      pendingSession: first.status === "ready" ? first.session : null,
      draft: { mode: "use-default" },
      write
    });
    expect(execution.outcome).toBe("in-flight");
    expect(execution.silentRetry).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("maps write conflicts to preserve-input and forbids silent retry", async () => {
    for (const reason of catalogConflictReasons) {
      const write = vi.fn().mockRejectedValue(
        catalogApiFailure(reason, { catalogReleaseId: CATALOG_RELEASE_ID })
      );
      const draft = { reason: "keep this", placementMode: "choose-parent" };
      const execution = await executeGovernanceWrite({
        actor: "org-admin",
        action: "register-subject",
        state: unregistered,
        catalogReleaseId: CATALOG_RELEASE_ID,
        draftFingerprint: fingerprintGovernanceDraft(draft),
        draft,
        write
      });
      expect(execution.outcome).toBe("failure");
      expect(execution.silentRetry).toBe(false);
      expect(execution.draft).toEqual(draft);
      expect(execution.domain).toMatchObject({
        kind: "conflict",
        reason,
        preserveInput: true,
        silentRetry: false,
        writesEnabled: false
      });
      expect(governanceFailureMessage(execution.domain!)).toContain("输入已保留");
      expect(governanceConflictCopy(reason)).toContain("输入已保留");
      expect(write).toHaveBeenCalledTimes(1);
    }
  });

  it("treats a stale review candidate as release-drift without retrying", () => {
    const stale = reviewItemGovernanceState(
      {
        ...catalogReviewItem,
        candidateState: {
          status: "stale",
          capturedRelease: { id: "crel_old", digest: "sha256:old" },
          currentRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:abc" }
        }
      },
      ready
    );
    expect(stale).toMatchObject({
      kind: "conflict",
      reason: "release-drift",
      preserveInput: true,
      silentRetry: false
    });
    expect(
      canExecuteGovernanceAction("org-admin", "resolve-review-item", stale)
    ).toBe(false);
  });

  it("never materializes a Parameter definition from Proposal acceptance", () => {
    expect(proposalOutcomeMaterializesDefinition()).toBe(false);
    expect(REVIEW_RESOLUTION_COMMAND).toBe("resolveReviewItem");
  });

  it("builds explicit Placement intent and refuses inferred parents", () => {
    expect(placementIntentFromChoice({ mode: "use-default" })).toEqual({ mode: "use-default" });
    expect(
      placementIntentFromChoice({
        mode: "choose-parent",
        parentPlacementId: "splc_01KROOT",
        displayName: "充电芯片"
      })
    ).toEqual({
      mode: "choose-parent",
      parentPlacementId: "splc_01KROOT",
      displayName: "充电芯片"
    });
    expect(fingerprintGovernanceDraft({ a: 1 })).toBe(fingerprintGovernanceDraft({ a: 1 }));
  });

  it("passes exact release, idempotency, and If-Match on a ready conditional write", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    const execution = await executeGovernanceWrite({
      actor: "org-admin",
      action: "resolve-review-item",
      state: ready,
      catalogReleaseId: CATALOG_RELEASE_ID,
      ifMatch: "etag-1",
      draftFingerprint: "draft",
      draft: { type: "mark-out-of-scope" },
      createIdempotencyKey: () => "key-resolve",
      write
    });
    expect(execution.outcome).toBe("success");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      catalogReleaseId: CATALOG_RELEASE_ID,
      idempotencyKey: "key-resolve",
      ifMatch: "etag-1"
    });
  });
});

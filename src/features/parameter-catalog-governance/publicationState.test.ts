import { describe, expect, it } from "vitest";

import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { readyCatalogDocument } from "@/application/parameter-catalog/fixtures";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import { catalogPublicationJob } from "@/application/parameter-catalog/fixtures";

import {
  buildCreateDefinitionChangeSet,
  canExecutePublicationAction,
  createPublicationSubmitGate,
  emptyPublicationDraft,
  fingerprintPublicationDraft,
  publicationCopy,
  publicationFailureCopy,
  publicationFieldError,
  publicationJobIsPending,
  publicationMustRePreview,
  publicationPreviewIsStale,
  publicationStatusCopy,
  publicationSuccessKind
} from "./publicationState";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

describe("publication operator state", () => {
  it("does not treat org-admin as an author without session permission", () => {
    expect(canExecutePublicationAction("org-admin", "preview-publication", ready)).toBe(false);
    expect(canExecutePublicationAction("org-admin", "preview-publication", ready, ["catalog:author"])).toBe(
      true
    );
    expect(
      canExecutePublicationAction("agent", "publish-publication", ready, ["catalog:publish"])
    ).toBe(false);
  });

  it("builds a create-definition ChangeSet without digest or git fields", () => {
    const draft = {
      ...emptyPublicationDraft(),
      subjectId: "csub_01KSC8562",
      propertyKey: "iin_hold",
      displayName: "保持电流",
      documentation: "最小保持电流。",
      valueType: "integer" as const,
      minimum: "0",
      maximum: "3000",
      unit: "mA" as const,
      examples: "100, 200"
    };
    expect(buildCreateDefinitionChangeSet(draft)).toEqual([
      {
        op: "create-definition",
        subjectId: "csub_01KSC8562",
        propertyKey: "iin_hold",
        content: {
          displayName: "保持电流",
          documentation: "最小保持电流。",
          unit: "mA",
          valueSchema: { type: "integer", minimum: 0, maximum: 3000 },
          examples: [100, 200]
        }
      }
    ]);
    expect(JSON.stringify(buildCreateDefinitionChangeSet(draft))).not.toMatch(/git|digest|releaseVersion/i);
  });

  it("invalidates preview when the draft body changes", () => {
    const draft = { ...emptyPublicationDraft(), propertyKey: "iin_hold", displayName: "保持电流" };
    const fingerprint = fingerprintPublicationDraft(draft);
    expect(publicationPreviewIsStale(fingerprint, draft)).toBe(false);
    expect(publicationPreviewIsStale(fingerprint, { ...draft, documentation: "新说明" })).toBe(true);
  });

  it("treats active-superseded as historical success rather than a red failure", () => {
    const superseded = {
      ...catalogPublicationJob,
      status: "active" as const,
      effective: true,
      isCurrent: false,
      currentness: "active-superseded" as const
    };
    expect(publicationSuccessKind(superseded)).toBe("active-superseded");
    expect(publicationStatusCopy(superseded)).toEqual({
      tone: "success",
      message: publicationCopy.activeSuperseded
    });
    expect(publicationJobIsPending("queued")).toBe(true);
    expect(publicationJobIsPending("active")).toBe(false);
  });

  it("maps policy, freeze, and needs-rebase to Chinese copy while naming the input field", () => {
    expect(publicationFailureCopy(catalogApiFailure("publication-policy-disabled"))).toContain("策略已关闭");
    expect(publicationFailureCopy(catalogApiFailure("publication-frozen"))).toContain("冻结");
    expect(publicationFailureCopy(catalogApiFailure("needs-rebase"))).toContain("重新预览");
    expect(publicationFieldError(catalogApiFailure("unsupported-catalog-capability", { field: "propertyKey" }))).toEqual({
      input: "propertyKey",
      message: "属性键不符合规范，请调整后重试。"
    });
  });

  it("debounces a second publish begin until the first gate finishes", () => {
    const gate = createPublicationSubmitGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    gate.finish();
    expect(gate.begin()).toBe(true);
  });

  it("requires a new preview when the candidate is stale or needs-rebase", () => {
    const draft = { ...emptyPublicationDraft(), propertyKey: "iin_hold" };
    expect(
      publicationMustRePreview({
        previewStale: publicationPreviewIsStale(fingerprintPublicationDraft(draft), {
          ...draft,
          documentation: "changed"
        }),
        jobStatus: "queued",
        failureReason: null
      })
    ).toBe(true);
    expect(
      publicationMustRePreview({
        previewStale: false,
        jobStatus: "needs-rebase",
        failureReason: null
      })
    ).toBe(true);
    expect(
      publicationMustRePreview({
        previewStale: false,
        jobStatus: "queued",
        failureReason: "needs-rebase"
      })
    ).toBe(true);
    expect(
      publicationMustRePreview({
        previewStale: false,
        jobStatus: "queued",
        failureReason: null
      })
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import {
  CATALOG_DEFINITION_ID,
  CATALOG_RELEASE_ID,
  catalogPublicationJob,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";

import {
  buildCreateDefinitionChangeSet,
  buildPublicationChangeSet,
  canExecutePublicationAction,
  canSavePublicationDraft,
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
    expect(canSavePublicationDraft("org-admin", ready, ["catalog:author"])).toBe(true);
    expect(canSavePublicationDraft("user", ready, ["catalog:author"])).toBe(false);
    expect(canSavePublicationDraft("platform-admin", ready, ["catalog:author"])).toBe(false);
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

  it("builds nested create-subject definitions without a published subjectId", () => {
    const draft = {
      ...emptyPublicationDraft(),
      mode: "create-subject" as const,
      subjectKind: "driver" as const,
      selectorValue: "acme,aux",
      nature: "physical-device" as const,
      cardinality: "multiple" as const,
      propertyKey: "vbat",
      displayName: "辅助电池",
      documentation: "辅助电池电压。",
      valueType: "integer" as const,
      unit: "mV" as const
    };
    expect(buildPublicationChangeSet(draft)).toEqual([
      {
        op: "create-subject-with-definitions",
        kind: "driver",
        canonicalKey: "driver:acme,aux",
        selector: { kind: "driver-compatible", value: "acme,aux" },
        nature: "physical-device",
        cardinality: "multiple",
        definitions: [
          {
            propertyKey: "vbat",
            content: {
              displayName: "辅助电池",
              documentation: "辅助电池电压。",
              unit: "mV",
              valueSchema: { type: "integer" }
            }
          }
        ]
      }
    ]);
    expect(JSON.stringify(buildPublicationChangeSet(draft))).not.toMatch(/csub_|subjectId/i);
  });

  it("builds a revise-definition ChangeSet from the selected definition", () => {
    const draft = {
      ...emptyPublicationDraft(),
      mode: "revise-definition" as const,
      definitionId: "pdef_01KGPIOINT",
      reviseClass: "semantic" as const,
      displayName: "保持电流",
      documentation: "新约束。",
      valueType: "integer" as const,
      maximum: "3000",
      unit: "mA" as const
    };
    expect(buildPublicationChangeSet(draft)[0]).toMatchObject({
      op: "revise-definition",
      definitionId: "pdef_01KGPIOINT",
      class: "semantic"
    });
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

  it("does not treat a fake documentation class that mutates unit or schema as low", async () => {
    const { catalog } = createMockCatalogPorts();
    const created = await catalog.createPublicationCandidate(
      {
        changeSet: [
          {
            op: "revise-definition",
            definitionId: CATALOG_DEFINITION_ID,
            class: "documentation",
            content: {
              displayName: "GPIO interrupt",
              documentation: "GPIO interrupt",
              unit: "mV",
              valueSchema: { type: "integer", minimum: 0, maximum: 9 }
            }
          }
        ]
      },
      { catalogReleaseId: CATALOG_RELEASE_ID }
    );
    expect(created.item.riskClass).toBe("high");
  });
});

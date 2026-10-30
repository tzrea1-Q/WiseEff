import { describe, expect, it } from "vitest";

import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import {
  CATALOG_DEFINITION_ID,
  CATALOG_RELEASE_ID,
  activeDefinition,
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
  publicationApprovalCopy,
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
  it("describes high-risk approval for the current actor", () => {
    expect(publicationApprovalCopy("high", "org-admin")).toBe("高风险：组织管理员可自行批准，请仔细核对影响。");
    expect(publicationApprovalCopy("high", "user")).toBe("高风险：必须由另一位具备高风险复核权限的人员批准。");
  });
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

  it("maps historical DTS shapes and keeps multiline documentation", () => {
    const draft = {
      ...emptyPublicationDraft(),
      subjectId: "csub_acme_power",
      propertyKey: "enable",
      displayName: "Enable",
      documentation: "Line one.\nLine two.",
      valueType: "boolean" as const,
      unit: "µA",
      examples: "true"
    };
    expect(buildCreateDefinitionChangeSet(draft)[0]).toMatchObject({
      content: {
        documentation: "Line one.\nLine two.",
        unit: "µA",
        valueSchema: { type: "boolean" },
        examples: [true]
      }
    });
  });

  it.each(["create-definition", "revise-definition"] as const)("keeps a complete multiline trx_plim statement as one string-list example in %s", (mode) => {
    const values = ["5017", "5500", "1200", "-1", "2", "-1", "-1", "-1",
      "12000", "12000", "2300", "-1", "6|9|10", "-1", "3", "-1",
      "12000", "12000", "2300", "-1", "255", "-1", "3|4", "-1"];
    const change = buildPublicationChangeSet({ ...emptyPublicationDraft(), mode,
      propertyKey: "trx_plim", valueType: "string-list",
      examples: `trx_plim =\n\t${values.map((value) => JSON.stringify(value)).join(",\n\t")};` });
    expect(change[0]).toMatchObject({ content: { examples: [values] } });
  });

  it.each([
    ["u32-array", "/* values */ value = <1/* separator */2>; // trailing", [[1, 2]]],
    ["u32-array", "<0x10 // first\r\n20> /* trailing */", [[16, 20]]],
    ["bytes", "value = [00 /* byte */ ff]; /* trailing */", ["[00   ff]"]],
    ["empty", "/* flag */ value /* name */; // trailing", [null]],
    ["string-list", '/* leading */ "http://host", "a/*literal*/b"; /* trailing */', [["http://host", "a/*literal*/b"]]],
    ["string", String.raw`value = "quoted \"/*literal*/\" // text"; // trailing`, ['quoted "/*literal*/" // text']],
    ["u32-array", "value = <0x10 20>;", [[16, 20]]],
    ["integer", "<0x10>", [16]],
    ["string", 'value = "with,comma; and \\"quotes\\"";', ['with,comma; and "quotes"']],
    ["string", '"voltage=5;";', ["voltage=5;"]],
    ["string-list", '"", "123", "6|9|10"', [["", "123", "6|9|10"]]],
    ["bytes", "value = [00 ff];", ["[00 ff]"]],
    ["bytes", "[10]", ["[10]"]],
    ["bytes", '["[10]"]', ["[10]"]],
    ["phandle-list", "value = <&intc>;", [["&intc"]]],
    ["empty", "value;", [null]]
  ] as const)("converts a DTS %s example without losing its value", (valueType, examples, expected) => {
    expect(buildPublicationChangeSet({ ...emptyPublicationDraft(), mode: "revise-definition",
      propertyKey: "value", valueType, examples })[0]).toMatchObject({ content: { examples: expected } });
  });

  it.each(['other = "123";', 'value = "unterminated;', 'value = "first"; other = "second";',
    '/* prefix */ other = "123"; /* suffix */', 'value = "123"; /* unterminated',
    'value = "123", /* comment */;', 'value = "first"; /* comment */ other = "second";',
    "/* comment only */", "// comment only", "value = /* no value */;",
    "value = ;", "value = <>, <1>;", "value = /bits/ 64 <9007199254740993>;"])("rejects mismatched, malformed or lossy DTS examples: %s", (examples) => {
    expect(() => buildPublicationChangeSet({ ...emptyPublicationDraft(), mode: "revise-definition",
      propertyKey: "value", valueType: "string-list", examples })).toThrow();
  });

  it.each(["create-definition", "revise-definition"] as const)("accepts the reported 18-row commented trx_plim example in %s", (mode) => {
    const source = `trx_plim =
      "5000",  "5500", "1000", "0x1",  "-1",     "-1",  "5",   "-1",       /* STHU */
      "15000", "9000",   "1500", "-1",   "6",      "-1",  "5",  "-1",      /* CP62R */
      "9000",  "9000", "1000", "-1",   "10",     "-1",  "5",   "-1",       /* CK030_LP */
      "9000",  "9000", "1000", "-1",   "255",    "-1",  "5",   "-1",       /* CK030_LP:extra */
      "15000",  "9000", "2000", "-1",  "-1",     "-1",  "5",   "-1",       /* BRACKETSHELL */
      "15000", "9000", "1500", "-1",   "7|8",    "-1",  "-1",  "0xa",      /* CP39S | CP39S_HK */
      "15000", "9000", "1900", "-1",   "4|5",    "-1",  "-1",  "0xa",      /* CP62_LX | CP62_XW*/
      "15000", "9000",   "3000", "-1",   "6",      "-1",  "-1",  "0xa",      /* CP62R */
      "-1",    "-1",    "4000", "-1",   "3^1",    "-1",  "-1",  "-1",       /* CP61_EXT */
      "9000",  "9000", "1100", "-1",   "3",      "-1",  "-1",  "-1",       /* CP61 */
      "9000",  "9000", "1100", "-1",   "2",      "-1",  "-1",  "-1",       /* CP60 */
      "15000", "9000",   "2200", "-1",   "7|8",    "-1",  "-1",  "-1",       /* CP39S | CP39S_HK */
      "15000", "9000",   "2200", "-1",   "4|5",    "-1",  "-1",  "-1",       /* CP62_LX | CP62_XW */
      "9000",  "9000",   "1100", "-1",   "10^2",   "-1",  "-1",  "-1",       /* CK30_LP:CUSTOMIZED_ONE */
      "15000", "9000",   "3000", "-1",   "10",     "-1",  "-1",  "-1",       /* CK30_LP */
      "15000", "9000",   "3000", "-1",   "255",    "-1",  "-1",  "-1",       /* CK30_LP:extra */
      "15000", "9000",   "2500", "-1",   "9",      "-1",  "-1",  "-1",       /* CK30_LX */
      "15000", "9000",   "4700", "-1",   "6",      "-1",  "-1",  "-1";       /* CP62R */`;
    const values = [
      ["5000", "5500", "1000", "0x1", "-1", "-1", "5", "-1"],
      ["15000", "9000", "1500", "-1", "6", "-1", "5", "-1"],
      ["9000", "9000", "1000", "-1", "10", "-1", "5", "-1"],
      ["9000", "9000", "1000", "-1", "255", "-1", "5", "-1"],
      ["15000", "9000", "2000", "-1", "-1", "-1", "5", "-1"],
      ["15000", "9000", "1500", "-1", "7|8", "-1", "-1", "0xa"],
      ["15000", "9000", "1900", "-1", "4|5", "-1", "-1", "0xa"],
      ["15000", "9000", "3000", "-1", "6", "-1", "-1", "0xa"],
      ["-1", "-1", "4000", "-1", "3^1", "-1", "-1", "-1"],
      ["9000", "9000", "1100", "-1", "3", "-1", "-1", "-1"],
      ["9000", "9000", "1100", "-1", "2", "-1", "-1", "-1"],
      ["15000", "9000", "2200", "-1", "7|8", "-1", "-1", "-1"],
      ["15000", "9000", "2200", "-1", "4|5", "-1", "-1", "-1"],
      ["9000", "9000", "1100", "-1", "10^2", "-1", "-1", "-1"],
      ["15000", "9000", "3000", "-1", "10", "-1", "-1", "-1"],
      ["15000", "9000", "3000", "-1", "255", "-1", "-1", "-1"],
      ["15000", "9000", "2500", "-1", "9", "-1", "-1", "-1"],
      ["15000", "9000", "4700", "-1", "6", "-1", "-1", "-1"]
    ].flat();
    expect(values).toHaveLength(144);
    for (const examples of [source, source.slice(source.indexOf("=") + 1)]) {
      expect(buildPublicationChangeSet({ ...emptyPublicationDraft(), mode,
        propertyKey: "trx_plim", valueType: "string-list", examples })[0])
        .toMatchObject({ content: { examples: [values] } });
    }
  });

  it("builds standalone subject intent without a parameter definition or published subjectId", () => {
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
        op: "create-subject",
        kind: "driver",
        canonicalKey: "driver:acme,aux",
        selector: { kind: "driver-compatible", value: "acme,aux" },
        nature: "physical-device",
        cardinality: "multiple"
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

  it("sends explicit removal for cleared unit and examples when revising, preserving hidden description", () => {
    const draft = {
      ...emptyPublicationDraft(),
      mode: "revise-definition" as const,
      definitionId: "pdef_01KGPIOINT",
      displayName: "保持电流",
      documentation: "保留的说明",
      unit: "  ",
      examples: ""
    };
    expect(buildPublicationChangeSet(draft)[0]).toMatchObject({
      content: { unit: null, examples: null }
    });
    expect(buildPublicationChangeSet(draft)[0]).not.toHaveProperty("content.description");
    expect(buildCreateDefinitionChangeSet({ ...draft, mode: "create-definition" })[0]).not.toHaveProperty("content.unit");
    expect(buildCreateDefinitionChangeSet({ ...draft, mode: "create-definition" })[0]).not.toHaveProperty("content.examples");
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

  it("warns when permanent erasure rebuilt a historically approved artifact", () => {
    expect(publicationStatusCopy({ ...catalogPublicationJob, effective: true,
      maintenanceRewrites: [{ kind: "definition-erasure", erasedAt: "2026-10-20T00:00:00Z",
        previousArtifactDigest: "sha256:old", currentArtifactDigest: "sha256:new", originalApprovalRetained: true }] })).toEqual({
      tone: "warning", message: "此发布记录的目录内容已因参数彻底删除而重建。原审批记录保留，本次维护不代表重新批准发布。"
    });
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

  it("classifies explicit unit removal as semantic even when marked documentation", async () => {
    const { catalog } = createMockCatalogPorts();
    const created = await catalog.createPublicationCandidate({ changeSet: [{
      op: "revise-definition", definitionId: CATALOG_DEFINITION_ID, class: "documentation",
      content: { displayName: "GPIO interrupt", documentation: "GPIO interrupt", unit: null,
        valueSchema: activeDefinition.currentRevision.valueShape.schema as { type: "integer" } }
    }] }, { catalogReleaseId: CATALOG_RELEASE_ID });
    expect(created.item.riskClass).toBe("high");
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

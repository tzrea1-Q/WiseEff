import { expect, it } from "vitest";
import { sharedDtsiPublicationSource } from "./source";

function draftWithFiles(files: Record<string, string>): Parameters<typeof sharedDtsiPublicationSource>[0] {
  return {
    id: "11111111-1111-4111-8111-111111111111", resourceId: "22222222-2222-4222-8222-222222222222",
    name: "PMIC", revision: 1, updatedAt: "2026-10-30T00:00:00Z", changeDescription: "Import PMIC fragments",
    members: Object.entries(files).map(([sourceName, content], i) => ({
      id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`, sourceName, content,
    })),
  };
}

it.each(["loose members", "included members"])("accepts repeated labels on the same node in %s", async mode => {
  const files: Record<string, string> = {
    "rtc.dtsi": '/ { spmi: spmi { pmic: pmic@0 { rtc { compatible = "vendor,rtc"; interrupt-parent = <&pmic>; }; }; }; };',
    "gpio.dtsi": '/ { spmi: spmi { pmic: pmic@0 { gpio { compatible = "vendor,gpio"; clocks = <&ext_clk>; }; }; }; };',
  };
  if (mode === "included members") files["board.dts"] = '/dts-v1/;\n/include/ "rtc.dtsi"\n/include/ "gpio.dtsi"';
  const draft = draftWithFiles(files);
  const { manifest, members } = await sharedDtsiPublicationSource(draft);
  expect(manifest.compatibleSelectors).toEqual(["vendor,gpio", "vendor,rtc"]);
  expect(manifest.externalReferences).toEqual(["ext_clk"]);
  expect(members).toMatchObject(draft.members);
});

it("locates a real conflict in the included file and identifies both node paths", async () => {
  const draft = draftWithFiles({
    "board.dts": '/dts-v1/;\n/include/ "first.dtsi"\n/include/ "second.dtsi"',
    "first.dtsi": "/ { spmi: spmi { pmic: pmic@0 {}; }; };",
    "second.dtsi": "/ { spmi: spmi {\n  pmic: pmic@1 {};\n}; };",
  });
  await expect(sharedDtsiPublicationSource(draft)).rejects.toMatchObject({
    details: { diagnostics: [{ sourceName: "second.dtsi", line: 2, column: 3,
      message: expect.stringMatching(/pmic.*\/spmi\/pmic@0.*\/spmi\/pmic@1/u) }] },
  });
});

it("detects the same declaration expanded twice in one entry, even through different include chains", async () => {
  const draft = draftWithFiles({
    "board.dts": '/include/ "first.dtsi"\n/include/ "second.dtsi"',
    "first.dtsi": '/include/ "common.dtsi"',
    "second.dtsi": '/ { spmi: spmi {}; };\n/include/ "common.dtsi"',
    "common.dtsi": "/ {\n  spmi: spmi {};\n};",
  });
  await expect(sharedDtsiPublicationSource(draft)).rejects.toMatchObject({
    details: { diagnostics: [{ sourceName: "common.dtsi", line: 2, column: 3,
      message: expect.stringContaining("重复") }] },
  });
});

it("allows separate entries to include the same labelled source once each", async () => {
  const draft = draftWithFiles({
    "first.dts": '/include/ "common.dtsi"',
    "second.dts": '/include/ "common.dtsi"',
    "common.dtsi": '/ { spmi: spmi { clock = <&external>; }; };',
  });
  const { manifest } = await sharedDtsiPublicationSource(draft);
  expect(manifest.externalReferences).toEqual(["external"]);
});

it.each([
  "/ { bus: bus {}; bus: bus {}; };",
  "&first { dev: device {}; }; &second { dev: device {}; };",
])("keeps conflicting labels invalid in %s", async content => {
  await expect(sharedDtsiPublicationSource(draftWithFiles({ "shared.dtsi": content }))).rejects.toMatchObject({
    code: "VALIDATION_FAILED", details: { diagnostics: [expect.objectContaining({ sourceName: "shared.dtsi", line: 1 })] },
  });
});

it("reports an empty assignment at its real source location", async () => {
  const draft: Parameters<typeof sharedDtsiPublicationSource>[0] = {
    id:"11111111-1111-4111-8111-111111111111", resourceId:"22222222-2222-4222-8222-222222222222",
    name:"shared",revision:1,updatedAt:"2026-10-30T00:00:00Z",changeDescription:"首次发布",
    members:[{id:"33333333-3333-4333-8333-333333333333",sourceName:"shared.dtsi",content:"/ {\n  node { status = ; };\n};\n"}]
  };
  await expect(sharedDtsiPublicationSource(draft)).rejects.toMatchObject({
    message: expect.stringMatching(/^shared\.dtsi:2:\d+：属性赋值缺少值。$/),
    details: {diagnostics:[expect.objectContaining({sourceName:"shared.dtsi",line:2,message:"属性赋值缺少值。"})]}
  });
});

it("does not invent a source position for a build setting error", async () => {
  const draft: Parameters<typeof sharedDtsiPublicationSource>[0] = {
    id:"11111111-1111-4111-8111-111111111111", resourceId:"22222222-2222-4222-8222-222222222222",
    name:"shared",revision:1,updatedAt:"2026-10-30T00:00:00Z",changeDescription:"首次发布",
    members:[{id:"33333333-3333-4333-8333-333333333333",sourceName:"shared.dtsi",content:"/ { node {}; };"}],
    buildInputs:{includeSearchPaths:[],defines:{DANGEROUS:"__TIME__"}}
  };
  await expect(sharedDtsiPublicationSource(draft)).rejects.toMatchObject({
    message:expect.stringMatching(/^构建宏 DANGEROUS/),details:{reason:"preprocess-input"}
  });
});

it("does not invent line one for a file-wide preprocessing check", async () => {
  const draft: Parameters<typeof sharedDtsiPublicationSource>[0] = {
    id:"11111111-1111-4111-8111-111111111111", resourceId:"22222222-2222-4222-8222-222222222222",
    name:"shared",revision:1,updatedAt:"2026-10-30T00:00:00Z",changeDescription:"首次发布",
    members:[{id:"33333333-3333-4333-8333-333333333333",sourceName:"shared.dtsi",content:'#define ENABLED 1\n/ { node { text = "??"; }; };\n'}]
  };
  await expect(sharedDtsiPublicationSource(draft)).rejects.toMatchObject({
    message:expect.stringMatching(/^shared\.dtsi：/),details:{reason:"preprocess-input"}
  });
});

it("uses the parser offset instead of matching location-like source text", async () => {
  const draft: Parameters<typeof sharedDtsiPublicationSource>[0] = {
    id:"11111111-1111-4111-8111-111111111111", resourceId:"22222222-2222-4222-8222-222222222222",
    name:"shared",revision:1,updatedAt:"2026-10-30T00:00:00Z",changeDescription:"首次发布",
    members:[{id:"33333333-3333-4333-8333-333333333333",sourceName:"shared.dtsi",content:'/ "at 0" { node {}; };'}]
  };
  await expect(sharedDtsiPublicationSource(draft)).rejects.toMatchObject({
    details:{diagnostics:[expect.objectContaining({sourceName:"shared.dtsi",line:1,column:3})]}
  });
});

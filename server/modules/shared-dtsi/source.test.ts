import { expect, it } from "vitest";
import { sharedDtsiPublicationSource } from "./source";

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

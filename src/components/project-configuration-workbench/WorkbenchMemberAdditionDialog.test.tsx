import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createApiClient, WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createCanonicalMemberAdditionClient } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { WorkbenchMemberAdditionDialog } from "./WorkbenchMemberAdditionDialog";
import type { ParameterCatalogRepository, CatalogSubjectListResponse, CatalogDefinitionListResponse } from "@/application/ports/ParameterCatalogRepository";
import { jsonLeafPaths } from "@/application/project-configuration/jsonRegistration";

afterEach(cleanup);

it("previews removal without browsing versions, cancels and retries with the same reference and explanation",async()=>{
  const user=userEvent.setup(),removed={resourceId:"11111111-1111-4111-8111-111111111111",versionId:"22222222-2222-4222-8222-222222222222",version:1};
  const client={upload:vi.fn(),preview:vi.fn(async()=>({proofToken:"a".repeat(64),configSetId:"set",fileName:"board.dts",format:"dts" as const,members:[],entryFile:"board.dts",includeSearchPaths:["."],overlayOrder:[],diagnostics:[],sharedRemoval:{...removed,name:"Limits"},
    sharedSwitch:{beforeVersion:1,afterVersion:null,dependencies:{before:[{name:"Limits",version:1,mountPath:""}],after:[]},sources:[],effective:[],build:{mode:"release" as const,passed:true as const,includeSearchPaths:["."],defines:{}}},impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:1,retainedBindings:1,sourceReplacements:0}})),apply:vi.fn().mockRejectedValue(new Error("来源已变化，请重新预览。"))};
  const sharedClient={list:vi.fn(),versions:vi.fn()};
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{id:"set",name:"Config"}]} initialConfigSetId="set" availableFiles={[]} removeReference={removed} client={client} sharedClient={sharedClient} onDismiss={vi.fn()} onApplied={vi.fn()} />);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("移除共享引用");
  expect(screen.queryByRole("combobox",{name:"固定版本"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"预览移除引用"}));
  expect(await screen.findByRole("heading",{name:"Config · 移除 Limits · 版本 1（确认后生效）"})).toBeInTheDocument();
  await user.type(screen.getByRole("textbox",{name:"变更说明"}),"Remove unused source");
  await user.click(screen.getByRole("button",{name:"取消本次预览"}));
  await user.click(screen.getByRole("button",{name:"预览移除引用"}));
  expect(await screen.findByRole("textbox",{name:"变更说明"})).toHaveValue("Remove unused source");
  await user.click(screen.getByRole("button",{name:"确认移除引用"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("来源已变化");
  expect(screen.queryByRole("button",{name:"确认移除引用"})).not.toBeInTheDocument();
  expect(client.preview).toHaveBeenLastCalledWith("project","set",{removeSharedReference:{resourceId:removed.resourceId,versionId:removed.versionId},role:"misc",sortOrder:0});
  expect(sharedClient.versions).not.toHaveBeenCalled();
});

it("returns a required dependency to composition instead of offering an ineffective root-source edit",async()=>{
  const user=userEvent.setup(),dismiss=vi.fn(),client={upload:vi.fn(),apply:vi.fn(),preview:vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT","其他直接引用仍依赖此资源",{reason:"shared-removal-dependency"},"request"))};
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{id:"set",name:"Config"}]} initialConfigSetId="set" availableFiles={[]} removeReference={{resourceId:"resource",versionId:"version",version:1}} projectRoot={{fileId:"root",sourceName:"board.dts"}} onRecoverSwitch={vi.fn()} client={client} onDismiss={dismiss} onApplied={vi.fn()}/>);
  await user.click(screen.getByRole("button",{name:"预览移除引用"}));await screen.findByRole("alert");
  expect(screen.queryByRole("button",{name:"编辑项目根文件"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"返回配置组成"}));expect(dismiss).toHaveBeenCalledOnce();
});

it("offers one precise project correction when the broken dependency is already located in the root",async()=>{
  const user=userEvent.setup(),client={upload:vi.fn(),apply:vi.fn(),preview:vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED","找不到覆盖目标节点",{switchConflicts:[{message:"找不到覆盖目标节点（&removed）",sourceName:"board.dts",fileId:"root",line:4}]},"request"))};
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{id:"set",name:"Config"}]} initialConfigSetId="set" availableFiles={[]} removeReference={{resourceId:"resource",versionId:"version",version:1}} projectRoot={{fileId:"root",sourceName:"board.dts"}} onRecoverSwitch={vi.fn()} client={client} onDismiss={vi.fn()} onApplied={vi.fn()}/>);
  await user.click(screen.getByRole("button",{name:"预览移除引用"}));await screen.findByRole("alert");
  expect(screen.getByRole("button",{name:"修正项目源码"})).toBeVisible();
  expect(screen.queryByRole("button",{name:"编辑项目根文件"})).not.toBeInTheDocument();
});

it("locates a blocked project override and retains the task input across correction without retaining its proof", async () => {
  const user=userEvent.setup(), recover=vi.fn(), resourceId="11111111-1111-4111-8111-111111111111",old="22222222-2222-4222-8222-222222222222",target="33333333-3333-4333-8333-333333333333";
  const client={upload:vi.fn(),apply:vi.fn(),preview:vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED","项目覆盖不满足目标约束",{switchConflicts:[{message:"iin_max 超出约束",sourceName:"board.dts",fileId:"root",fileVersionId:"root-v1",line:9,node:"/charger",property:"iin_max"}]},"request"))};
  const props={projectId:"project",configSets:[{id:"set",name:"Config"}],initialConfigSetId:"set",availableFiles:[],switchReference:{resourceId,versionId:old,version:1},
    client,sharedClient:{list:vi.fn(),versions:vi.fn(async()=>({items:[{id:target,resourceId,version:2,name:"Limits",changeDescription:"Next",digest:"fixed",createdAt:"today",createdByUserId:"author"}],total:1}))},onDismiss:vi.fn(),onApplied:vi.fn(),
    switchDraft:{versionId:target,reason:"Keep local decision"},onSwitchDraftChange:vi.fn(),onRecoverSwitch:recover};
  const view=render(<WorkbenchMemberAdditionDialog {...props}/>);
  await user.click(await screen.findByRole("button",{name:"预览版本切换"}));
  expect(await screen.findByText("board.dts:9 · /charger · iin_max")).toBeVisible();
  await user.click(screen.getByRole("button",{name:"重选目标版本"}));
  expect(screen.getByRole("combobox",{name:"固定版本"})).toHaveFocus();
  await user.click(screen.getByRole("button",{name:"预览版本切换"}));
  await user.click(screen.getByRole("button",{name:"修正项目源码"}));
  expect(recover).toHaveBeenCalledWith(expect.objectContaining({fileId:"root",line:9}),{versionId:target,reason:"Keep local decision"});
  view.unmount();render(<WorkbenchMemberAdditionDialog {...props}/>);
  expect(screen.getByRole("combobox",{name:"固定版本"})).toHaveAttribute("data-value",target);
  expect(screen.getByRole("textbox",{name:"变更说明"})).toHaveValue("Keep local decision");
  expect(screen.queryByRole("button",{name:"确认切换版本"})).not.toBeInTheDocument();
});

it("switches an existing reference through the same preview owner and cancels proof without losing the selected version or reason", async () => {
  const user=userEvent.setup(), resourceId="11111111-1111-4111-8111-111111111111",old="22222222-2222-4222-8222-222222222222",next="33333333-3333-4333-8333-333333333333";
  const versions=[old,next].map((id,index)=>({id,resourceId,version:index+1,name:"Limits",changeDescription:`Defaults ${index+1}`,digest:"sha256:fixed",createdAt:"2026-10-25",createdByUserId:"author"}));
  const preview=vi.fn(async()=>({proofToken:"a".repeat(64),configSetId:"set",fileName:"limits.dtsi",format:"dts" as const,members:[],entryFile:"board.dts",includeSearchPaths:["."],overlayOrder:[],diagnostics:[],
    sharedReference:{resourceId,versionId:next,memberId:"member",version:2,digest:"fixed"},
    sharedComposition:[{resourceId,versionId:next,name:"Limits",version:2,digest:"fixed",mountPath:"",direct:true,sources:[{memberId:"member",fileId:"shared",fileVersionId:"v2",sourceName:"limits.dtsi"}]}],
    sharedSwitch:{beforeVersion:1,afterVersion:2,dependencies:{before:[{name:"Limits",version:1,mountPath:""}],after:[{name:"Limits",version:2,mountPath:""}]},
      effective:[{node:"/charger",property:"iin_max",oldShared:"<10>",targetShared:"<20>",before:"<36>",after:"<36>",originBefore:"board.dts",originAfter:"board.dts",localOverride:true}],
      sources:[{sourceName:"board.dts",before:"original project source",after:"original project source",projectOwned:true}],build:{mode:"release" as const,passed:true as const,includeSearchPaths:["."],defines:{}}},
    impact:{parameterChanges:1,nodeAdditions:0,nodeRemovals:0,retainedBindings:2,sourceReplacements:0}}));
  const client={upload:vi.fn(),preview,apply:vi.fn().mockRejectedValue(new Error("Preview changed; prepare again"))};
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{id:"set",name:"Config"}]} initialConfigSetId="set" availableFiles={[]}
    switchReference={{resourceId,versionId:old,version:1}} client={client} sharedClient={{list:vi.fn(),versions:vi.fn(async()=>({items:versions,total:2}))}} onDismiss={vi.fn()} onApplied={vi.fn()} />);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("切换共享版本");
  await user.click(await screen.findByRole("combobox",{name:"固定版本"}));
  expect(screen.getByRole("option",{name:"版本 1 · Defaults 1"})).toHaveAttribute("aria-disabled","true");
  await user.click(screen.getByRole("option",{name:"版本 2 · Defaults 2"}));
  await user.click(screen.getByRole("button",{name:"预览版本切换"}));
  expect(await screen.findByRole("heading",{name:"Config · 版本 1 → 版本 2（确认后生效）"})).toBeInTheDocument();
  expect(screen.queryByText(/此项目的当前配置引用共享版本 2/)).not.toBeInTheDocument();
  const change=screen.getByText("/charger · iin_max").closest("summary")!;
  expect(change).toHaveTextContent("<36>保留本地覆盖");expect(change).not.toHaveTextContent("→");
  expect(screen.queryByText("limits.dtsi")).not.toBeInTheDocument();
  await user.click(change);expect(screen.getByText("<10>")).toBeVisible();expect(screen.getByText("<20>")).toBeVisible();
  await user.click(screen.getByText("配置组成与构建设置"));expect(screen.getByText("Limits · 直接引用")).toBeVisible();
  expect(preview).toHaveBeenCalledWith("project","set",{sharedReference:{resourceId,versionId:next,replaceVersionId:old},role:"misc",sortOrder:0});
  await user.type(screen.getByRole("textbox",{name:"变更说明"}),"Preserve private limits");
  await user.click(screen.getByRole("button",{name:"取消本次预览"}));
  expect(screen.queryByRole("button",{name:"确认切换版本"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"预览版本切换"}));
  expect(await screen.findByRole("textbox",{name:"变更说明"})).toHaveValue("Preserve private limits");
  await user.click(screen.getByRole("button",{name:"确认切换版本"}));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"确认切换版本"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"预览版本切换"}));
  expect(await screen.findByRole("textbox",{name:"变更说明"})).toHaveValue("Preserve private limits");
});

it("requires an explicit published version and clears its proof when the version changes", async () => {
  const user = userEvent.setup(), resourceId = "11111111-1111-4111-8111-111111111111", versionId = "22222222-2222-4222-8222-222222222222";
  const summary = { id: versionId, resourceId, version: 1, name: "Shared limits", changeDescription: "Initial limits", digest: "sha256:fixed", createdAt: "2026-10-24", createdByUserId: "author" };
  const sharedClient = {
    list: vi.fn(async () => ({ items: [{ resourceId, name: "Shared limits", updatedAt: "2026-10-24", sourceName: "limits.dtsi",state:"active" as const,lifecycleRevision:1, draftRevision: null, currentVersion: summary }], total: 1 })),
    versions: vi.fn(async () => ({ items: [summary, { ...summary, id: "33333333-3333-4333-8333-333333333333", version: 2 }], total: 2 }))
  };
  const bodies: Array<Record<string, unknown>> = [];
  const client = createCanonicalMemberAdditionClient(createApiClient({ baseUrl: "", fetchImpl: async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ item: { proofToken: "a".repeat(64), configSetId: "set", fileName: "limits.dtsi", format: "dts", members: [],
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], diagnostics: [],
      sharedReference: { resourceId, versionId, memberId: "member", version: 1, digest: "sha256:fixed" },
      rootEdit: { fileId: "root", baseFileVersionId: "root-v1", sourceName: "board.dts", before: "/dts-v1/; / {};", after: '/dts-v1/;\n/include/ "limits.dtsi"\n/ {};' },
      impact: { parameterChanges: 0, nodeAdditions: 1, nodeRemovals: 0, retainedBindings: 0, sourceReplacements: 0 } } }));
  } }));
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{ id: "set", name: "默认配置" }]} initialConfigSetId="set" availableFiles={[]}
    client={client} sharedClient={sharedClient} onDismiss={vi.fn()} onApplied={vi.fn()} />);
  await user.click(screen.getByRole("combobox", { name: "文件来源" })); await user.click(screen.getByRole("option", { name: "引用共享 DTSI 固定版本" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription("选择共享资源及固定版本，预览配置变化后确认引用。");
  await user.click(await screen.findByRole("combobox", { name: "共享资源" })); await user.click(await screen.findByRole("option", { name: "Shared limits" }));
  expect(screen.getByRole("button", { name: "预览加入配置" })).toBeDisabled();
  await user.click(await screen.findByRole("combobox", { name: "固定版本" })); await user.click(await screen.findByRole("option", { name: "版本 1 · Initial limits" }));
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(await screen.findByText("此项目的当前配置引用共享版本 1；来源成员只读，其他项目不受影响。")).toBeInTheDocument();
  expect(bodies.at(-1)).toMatchObject({ sharedReference: { resourceId, versionId }, role: "misc" });
  expect(screen.getByLabelText("确认后根文件源码")).not.toBeVisible();
  expect(screen.getByRole("group", { name: "加入配置确认" })).toContainElement(screen.getByRole("button", { name: "确认加入配置" }));
  await user.click(screen.getByText("项目根文件 include 变更：board.dts"));
  expect(screen.getByLabelText("确认后根文件源码")).toHaveTextContent('/include/ "limits.dtsi"');
  await user.click(screen.getByText("文件与目标配置"));
  await user.click(screen.getByRole("combobox", { name: "固定版本" })); await user.click(screen.getByRole("option", { name: "版本 2 · Initial limits" }));
  expect(screen.queryByRole("button", { name: "确认加入配置" })).not.toBeInTheDocument();
});

function jsonDialog(options: { definitionFailure?: boolean } = {}) {
  const subject: CatalogSubjectListResponse["items"][number] = { id: "spec-internal", type: "configuration-schema", canonicalName: "电源配置",
    aliases: [], membership: { status: "active", catalogReleaseId: "release" }, registration: { status: "active", id: "registered" },
    definitionCounts: { active: 2, deprecated: 0, retired: 0 } };
  const definition: CatalogDefinitionListResponse["items"][number] = { id: "definition-internal", propertyKey: "limit", lifecycle: "active",
    subject: { id: subject.id, type: subject.type, canonicalName: subject.canonicalName }, registration: subject.registration,
    currentRevision: { id: "revision", definitionId: "definition-internal", revisionNumber: 1, contentDigest: "digest", displayName: "电流上限",
      valueShape: { kind: "json-schema", schema: { type: "number" } }, constraints: { kind: "none" }, documentation: null, unit: null, publishedInCatalogReleaseId: "release" },
    usageSummary: { policyCount: 0, projectCount: 0, currentValueCount: 0 }, links: { revisions: "", timeline: "" } };
  const catalog: Pick<ParameterCatalogRepository, "listSubjects" | "listSubjectDefinitions"> = {
    listSubjects: vi.fn(async () => ({ items: [subject, { ...subject, id: "not-registered", canonicalName: "未登记规范", registration: { status: "unregistered" as const } }], catalogReleaseId: "release", totalCount: 2, hasMore: false, nextCursor: null })),
    listSubjectDefinitions: vi.fn(async () => {
      if (options.definitionFailure) throw new Error("参数定义列表暂不可用。");
      return { items: [definition, { ...definition, id: "other", propertyKey: "enabled", currentRevision: { ...definition.currentRevision, displayName: "启用" } }], catalogReleaseId: "release", totalCount: 2, hasMore: false, nextCursor: null };
    })
  };
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ item: { proofToken: "b".repeat(64), configSetId: "set", fileName: "power.json", format: "json",
      members: [], entryFile: null, includeSearchPaths: [], overlayOrder: [], diagnostics: [],
      impact: { parameterChanges: 1, nodeAdditions: 0, nodeRemovals: 0, retainedBindings: 0, sourceReplacements: 0 } } }), { status: 200 });
  };
  const files = { downloadVersion: vi.fn(async () => ({ contentType: "application/json", bytes: new TextEncoder().encode('{"limits":{"a/b~c":1200},"enabled":true}') })) };
  const client = createCanonicalMemberAdditionClient(createApiClient({ baseUrl: "", fetchImpl }));
  vi.spyOn(client, "upload").mockResolvedValue({ id: "candidate", fileName: "power.json", format: "json" });
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{ id: "set", name: "默认配置" }]} initialConfigSetId="set"
    availableFiles={[{ id: "json", projectId: "project", fileName: "power.json", format: "json", enabled: true, currentVersionId: "v1", updatedAt: "" }]}
    catalogRepository={catalog} fileRepository={files} client={client} onDismiss={vi.fn()} onApplied={vi.fn()} />);
  return { catalog, files, bodies };
}

it("picks a registered spec, searchable definition and escaped JSON field with value preview", async () => {
  const user = userEvent.setup(), { catalog, files, bodies } = jsonDialog();
  await user.click(screen.getByRole("combobox", { name: "文件来源" })); await user.click(screen.getByRole("option", { name: "选择已有项目文件" }));
  await user.click(screen.getByText("登记 JSON 字段为参数（可选）"));
  await user.click(await screen.findByRole("combobox", { name: "配置规范" }));
  expect(screen.queryByRole("option", { name: "未登记规范" })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("option", { name: "电源配置" }));
  await user.type(screen.getByRole("searchbox", { name: "搜索参数定义 1" }), "电流");
  await user.click(screen.getByRole("combobox", { name: "参数定义 1" }));
  expect(screen.queryByRole("option", { name: /启用/ })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("option", { name: "电流上限（limit）" }));
  await user.type(screen.getByRole("searchbox", { name: "搜索JSON 字段 1" }), "a~1b~0c");
  await user.click(screen.getByRole("combobox", { name: "JSON 字段 1" }));
  await user.click(screen.getByRole("option", { name: "/limits/a~1b~0c：1200" }));
  expect(screen.queryByRole("textbox", { name: "字段映射" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(bodies.at(-1)).toMatchObject({ json: { configurationSchemaId: "电源配置", rootPointer: "", mappings: [{ definitionId: "definition-internal", pointer: "/limits/a~1b~0c" }] } });
  expect(files.downloadVersion).toHaveBeenCalledWith("project", "json", "v1");
  expect(catalog.listSubjectDefinitions).toHaveBeenCalledWith("spec-internal", expect.objectContaining({ catalogReleaseId: "release", lifecycle: "active" }));
});

it("reads uploaded JSON leaf paths and offers manual mappings only when definitions fail to load", async () => {
  const user = userEvent.setup(), { bodies } = jsonDialog({ definitionFailure: true });
  const file = new File(['{"limit":5}'], "power.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => '{"limit":5}' });
  await user.upload(screen.getByLabelText("上传文件"), file);
  await user.click(screen.getByText("登记 JSON 字段为参数（可选）"));
  await user.click(await screen.findByRole("combobox", { name: "配置规范" }));
  await user.click(await screen.findByRole("option", { name: "电源配置" }));
  const fallback = await screen.findByRole("textbox", { name: "字段映射" });
  await user.type(fallback, "definition-internal = /limit");
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(bodies.at(-1)).toMatchObject({ candidateId: "candidate", json: { mappings: [{ definitionId: "definition-internal", pointer: "/limit" }] } });
});

it("selects a leaf path from uploaded JSON without entering IDs", async () => {
  const user = userEvent.setup(), { bodies, files } = jsonDialog();
  const file = new File(['{"limit":5}'], "power.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => '{"limit":5}' });
  await user.upload(screen.getByLabelText("上传文件"), file);
  await user.click(screen.getByText("登记 JSON 字段为参数（可选）"));
  await user.click(await screen.findByRole("combobox", { name: "配置规范" }));
  await user.click(await screen.findByRole("option", { name: "电源配置" }));
  await user.click(await screen.findByRole("combobox", { name: "参数定义 1" }));
  await user.click(await screen.findByRole("option", { name: "电流上限（limit）" }));
  await user.click(screen.getByRole("combobox", { name: "JSON 字段 1" }));
  await user.click(screen.getByRole("option", { name: "/limit：5" }));
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(bodies.at(-1)).toMatchObject({ candidateId: "candidate", json: { mappings: [{ definitionId: "definition-internal", pointer: "/limit" }] } });
  expect(files.downloadVersion).not.toHaveBeenCalled();
});

it("enumerates arrays, root values, empty containers and special JSON Pointer characters", () => {
  expect(jsonLeafPaths('{"a/b~c":[null,true],"empty":{}}')).toEqual([
    { pointer: "/a~1b~0c/0", preview: "null" }, { pointer: "/a~1b~0c/1", preview: "true" }, { pointer: "/empty", preview: "{}" }
  ]);
  expect(jsonLeafPaths("5")).toEqual([{ pointer: "", preview: "5" }]);
});
it("retains choices on a refused preview and confirms the complete preview with the keyboard", async () => {
  const user = userEvent.setup(), submitted = vi.fn(), requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let failed = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input), body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ path, body });
    if (path.endsWith("/preview") && !failed) { failed = true; return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "来源已变化，请重新预览。" } }), { status: 409 }); }
    return new Response(JSON.stringify({ item: path.endsWith("/apply") ? { requestId: "request", fileId: "file", fileVersionId: "version", configRevisionId: "revision" } : {
      proofToken: "a".repeat(64), configSetId: "set", fileName: "overlay.dts", format: "dts", members: [
        { fileId: "file", fileVersionId: "version", sourceName: "overlay.dts", format: "dts", role: "overlay", sortOrder: 2, checksum: "digest", sizeBytes: 12 }],
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: ["overlay.dts"], diagnostics: [],
      impact: { parameterChanges: 1, nodeAdditions: 0, nodeRemovals: 0, retainedBindings: 1, sourceReplacements: 0 }
    } }), { status: 200 });
  };
  const client = createCanonicalMemberAdditionClient(createApiClient({ baseUrl: "", fetchImpl }));
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{ id: "set", name: "默认配置" }]} initialConfigSetId="set"
    availableFiles={[{ id: "file", projectId: "project", fileName: "overlay.dts", format: "dts", enabled: true, updatedAt: "" }]}
    client={client} onDismiss={vi.fn()} onApplied={submitted} />);
  await user.click(screen.getByRole("combobox", { name: "文件来源" })); await user.click(screen.getByRole("option", { name: "选择已有项目文件" }));
  await user.click(screen.getByRole("combobox", { name: "文件用途" })); await user.click(screen.getByRole("option", { name: "覆盖层" }));
  await user.clear(screen.getByLabelText("文件顺序")); await user.type(screen.getByLabelText("文件顺序"), "2");
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("来源已变化");
  expect(screen.getByRole("combobox", { name: "文件用途" })).toHaveAttribute("data-value", "overlay");
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(await screen.findByText("参数变化 1 项。")).toBeInTheDocument();
  await user.type(screen.getByLabelText("加入原因"), "Add reviewed overlay");
  screen.getByRole("button", { name: "确认加入配置" }).focus(); await user.keyboard("{Enter}");
  expect(submitted).toHaveBeenCalledOnce();
  expect(requests.at(-1)?.body).toMatchObject({ role: "overlay", sortOrder: 2, fileId: "file", proofToken: "a".repeat(64) });
});

it("allows a JSON source member without forcing parameter registration and shows its zero-admission preview", async () => {
  const user = userEvent.setup(); let submitted: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ item: { proofToken: "b".repeat(64), configSetId: "set", fileName: "metadata.json", format: "json",
      members: [{ fileId: "json", fileVersionId: "version", sourceName: "metadata.json", format: "json", role: "misc", sortOrder: 0, checksum: "digest", sizeBytes: 12 }],
      entryFile: null, includeSearchPaths: [], overlayOrder: [], diagnostics: [{ severity: "warning", code: "json-unregistered", message: "未登记为参数，将产生 0 个新 Binding。" }],
      impact: { parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0, retainedBindings: 0, sourceReplacements: 0 } } }), { status: 200 });
  };
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{ id: "set", name: "默认配置" }]} initialConfigSetId="set"
    availableFiles={[{ id: "json", projectId: "project", fileName: "metadata.json", format: "json", enabled: true, updatedAt: "" }]}
    client={createCanonicalMemberAdditionClient(createApiClient({ baseUrl: "", fetchImpl }))} onDismiss={vi.fn()} onApplied={vi.fn()} />);
  await user.click(screen.getByRole("combobox", { name: "文件来源" })); await user.click(screen.getByRole("option", { name: "选择已有项目文件" }));
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(await screen.findByText("未登记为参数，将产生 0 个新 Binding。")).toBeInTheDocument();
  expect(submitted).toMatchObject({ fileId: "json", role: "misc" });
  expect(submitted).not.toHaveProperty("json");
});

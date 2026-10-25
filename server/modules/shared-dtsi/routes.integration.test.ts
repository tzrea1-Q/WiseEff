import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { registerSharedDtsiRoutes } from "./routes";
import JSZip from "jszip";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerOperationsRoutes } from "../operations/routes";

const source = '/ { battery: battery { compatible = "test,battery"; status = "disabled"; }; };\n';
const auth = makeTestAuthContext({ organizationId: "org-shared-dtsi", userId: "user-shared-dtsi" });
type Draft = { id: string; resourceId: string; name: string; revision: number;
  members: { id: string; sourceName: string; content: string }[] };

describe("shared DTSI draft HTTP workflow (PostgreSQL API login)", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  const token = `shared_dtsi_${process.pid}`;
  function server(actor = auth) {
    const router = createRouter();
    registerOperationsRoutes(router, { db: api });
    registerSharedDtsiRoutes(router, { db: api, getCurrentAuthContext: () => actor });
    return createHttpServer(router);
  }
  const call = (path: string, method = "GET", body?: unknown, actor = auth) =>
    requestJson<{ item: Draft; items: Draft[]; error: { code: string } }>(server(actor), `/api/v2/shared-dtsi${path}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  const publicationCall = <T>(path: string, method = "GET", body?: unknown, actor = auth) =>
    requestJson<T>(server(actor), `/api/v2/shared-dtsi${path}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("shared-dtsi-t01");
    db = createPostgresDatabase(lane.url);
    await db.query("insert into organizations(id,name) values ('org-shared-dtsi','Shared source'),('org-other-dtsi','Other')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('user-shared-dtsi','org-shared-dtsi','Source author','Admin',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-dtsi-role','user-shared-dtsi','org-shared-dtsi','admin')");
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(logins.apiUrl);
    expect((await api.query<{ rolsuper: boolean; rolinherit: boolean }>("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0])
      .toEqual({ rolsuper: false, rolinherit: false });
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); });

  it("creates, reopens, updates and discards an exact source draft with stable member identity", async () => {
    const created = await call("", "POST", { name: "Battery common", sourceName: "battery.dtsi", content: source });
    expect(created.status, created.bodyText).toBe(201);
    const draft = created.body.item;
    expect(draft).toMatchObject({ name: "Battery common", revision: 1, members: [{ sourceName: "battery.dtsi", content: source }] });
    expect((await call("")).body.items).toEqual([expect.objectContaining({ resourceId: draft.resourceId, name: draft.name })]);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
    const content = source.replace("disabled", "okay");
    const updated = await call(`/${draft.resourceId}/draft`, "PUT", { name: "Battery common", sourceName: "inc/battery.dtsi", content, expectedRevision: 1 });
    expect(updated.status, updated.bodyText).toBe(200);
    expect(updated.body.item).toMatchObject({ id: draft.id, resourceId: draft.resourceId, revision: 2,
      members: [{ id: draft.members[0]!.id, sourceName: "inc/battery.dtsi", content }] });
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 2 })).status).toBe(200);
    expect((await call(`/${draft.resourceId}`)).status).toBe(404);
  });

  it("publishes real headers, value/function macros and conditional source with frozen original bytes", async () => {
    const members = [{ sourceName: "common.dtsi", content: '\uFEFF// 🧪 original\r\n#include "defs.h"\r\n/ { battery: battery { compatible = "test,battery";\r\n#if ENABLED\r\n flags = <BIT(3)>;\r\n#else\r\n flags = <0>;\r\n#endif\r\n}; };\r\n' },
      { sourceName: "defs.h", content: '#define ENABLED 1\n#define BIT(x) (1U << (x))\n' }];
    const created = await call("", "POST", { name: "CPP original project", members, changeDescription: "固定头文件与宏输入" });
    expect(created.status, created.bodyText).toBe(201);
    const draft = created.body.item;
    type Preview = import("../contracts/dtoSchemas/sharedDtsi").SharedDtsiPublicationPreview;
    const preview = await publicationCall<{ item: Preview }>(`/${draft.resourceId}/publication-preview`, "POST", { expectedRevision: 1 });
    expect(preview.status, preview.bodyText).toBe(201);
    expect(preview.body.item.manifest.buildInputs.preprocessing).toMatchObject({ schemaVersion: "dts-cpp/v1", compilerVersion: "14.2.0", language: "c17", locale: "C" });
    expect(preview.body.item.manifest.includeGraph).toEqual([{ sourceName: "common.dtsi", target: "defs.h", line: 2, column: 1 }]);
    const repeated = await publicationCall<{ item: Preview }>(`/${draft.resourceId}/publication-preview`, "POST", { expectedRevision: 1 });
    expect(repeated.status, repeated.bodyText).toBe(201);
    expect(repeated.body.item.digest).toBe(preview.body.item.digest);
    const published = await publicationCall<{ item: import("../contracts/dtoSchemas/sharedDtsi").SharedDtsiVersion }>(`/${draft.resourceId}/publications`, "POST", { previewId: preview.body.item.id, idempotencyKey: "native-cpp-publication" });
    expect(published.status, published.bodyText).toBe(201);
    expect(published.body.item.members).toEqual(expect.arrayContaining(members.map(member => expect.objectContaining(member))));
    expect(published.body.item.manifest.buildInputs.preprocessing).toEqual(preview.body.item.manifest.buildInputs.preprocessing);
    expect((await publicationCall<{ item: unknown }>(`/${draft.resourceId}/versions/${published.body.item.id}`)).body.item).toEqual(published.body.item);
  });

  it("formats each CPP diagnostic location once while retaining the exact header line", async () => {
    const sourceName="include/dt-bindings/power.h";
    const draft=(await call("","POST",{name:"Located CPP error",changeDescription:"Repair original header",members:[
      {sourceName:"main.dtsi",content:`#include "${sourceName}"\n/ { value = <VALUE>; };\n`},
      {sourceName,content:"// Original header\n#define VALUE __TIME__\n"}]})).body.item;
    const preview=await publicationCall<{error:{message:string;details:{diagnostics:{sourceName:string;line:number;column:number;message:string}[]}}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    expect(preview.status,preview.bodyText).toBe(400);
    expect(preview.body.error.message.startsWith(`${sourceName}:2:1：`)).toBe(true);
    expect(preview.body.error.message.split(sourceName)).toHaveLength(2);
    expect(preview.body.error.details.diagnostics).toEqual([expect.objectContaining({sourceName,line:2,column:1,message:expect.stringContaining("冻结")})]);
    expect(preview.body.error.details.diagnostics[0]!.message).not.toContain(sourceName);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
  });

  it("freezes declared include roots and external defines without flattening original header directories", async () => {
    const members = [{ sourceName: "lib/common.dtsi", content: '#include <dt-bindings/power.h>\n/ { battery {\n#if ENABLED\n limit = <POWER_LIMIT>;\n#else\n limit = <99>;\n#endif\n}; };\n' },
      { sourceName: "include/dt-bindings/power.h", content: "#define POWER_LIMIT 37\n" }];
    const buildInputs = { includeSearchPaths: ["include"], defines: { ENABLED: "1" } };
    const created = await call("", "POST", { name: "Declared CPP inputs", members, buildInputs, changeDescription: "保留原始构建输入" });
    expect(created.status, created.bodyText).toBe(201);
    expect(created.body.item).toMatchObject({ buildInputs });
    const draft = created.body.item;
    const preview = await publicationCall<{ item: import("../contracts/dtoSchemas/sharedDtsi").SharedDtsiPublicationPreview }>(`/${draft.resourceId}/publication-preview`, "POST", { expectedRevision: 1 });
    expect(preview.status, preview.bodyText).toBe(201);
    expect(preview.body.item.manifest.buildInputs).toMatchObject(buildInputs);
    expect(preview.body.item.manifest.buildInputs.preprocessing).toMatchObject({ defines: buildInputs.defines });
    const updated = await call(`/${draft.resourceId}/draft`, "PUT", { name: draft.name, members: draft.members, changeDescription: "改变条件输入", expectedRevision: 1,
      buildInputs: { ...buildInputs, defines: { ENABLED: "0" } } });
    expect(updated.status, updated.bodyText).toBe(200);
    expect((await publicationCall(`/${draft.resourceId}/publications`, "POST", { previewId: preview.body.item.id, idempotencyKey: "stale-build-inputs" })).status).toBe(409);
    const next = await publicationCall<{ item: import("../contracts/dtoSchemas/sharedDtsi").SharedDtsiPublicationPreview }>(`/${draft.resourceId}/publication-preview`, "POST", { expectedRevision: 2 });
    expect(next.status, next.bodyText).toBe(201);
    expect(next.body.item.digest).not.toBe(preview.body.item.digest);
    const published = await publicationCall<{ item: import("../contracts/dtoSchemas/sharedDtsi").SharedDtsiVersion }>(`/${draft.resourceId}/publications`, "POST", { previewId: next.body.item.id, idempotencyKey: "declared-build-inputs" });
    expect(published.status, published.bodyText).toBe(201);
    expect(published.body.item.members).toEqual(expect.arrayContaining(members.map(member => expect.objectContaining(member))));
    const reopened = await call(`/${draft.resourceId}/draft`, "POST", { baseVersionId: published.body.item.id });
    expect(reopened.status, reopened.bodyText).toBe(201);
    expect(reopened.body.item).toMatchObject({ buildInputs: { ...buildInputs, defines: { ENABLED: "0" } } });
    const consumer=await call("","POST",{name:"CPP dependency consumer",sourceName:"consumer.dtsi",content:'#include <dt-bindings/power.h>\n#include "vendor/lib/common.dtsi"\n',
      buildInputs:{includeSearchPaths:[],defines:{CONSUMER:"1"}},dependencies:[{resourceId:draft.resourceId,versionId:published.body.item.id,mountPath:"vendor"}],changeDescription:"Keep each resource declaration owned"});
    expect(consumer.status,consumer.bodyText).toBe(201);
    const combined=await publicationCall<{item:import("../contracts/dtoSchemas/sharedDtsi").SharedDtsiPublicationPreview}>(`/${consumer.body.item.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    expect(combined.status,combined.bodyText).toBe(201);
    expect(combined.body.item.manifest.buildInputs).toMatchObject({includeSearchPaths:[],defines:{CONSUMER:"1"},preprocessing:{defines:{CONSUMER:"1",ENABLED:"0"}}});
    expect(combined.body.item.manifest.members.map(member=>member.sourceName)).toEqual(["consumer.dtsi"]);
    const combinedVersion=await publicationCall<{item:import("../contracts/dtoSchemas/sharedDtsi").SharedDtsiVersion}>(`/${consumer.body.item.resourceId}/publications`,"POST",{previewId:combined.body.item.id,idempotencyKey:"cpp-dependency-settings"});
    expect(combinedVersion.status,combinedVersion.bodyText).toBe(201);
    const ownDraft=await call(`/${consumer.body.item.resourceId}/draft`,"POST",{baseVersionId:combinedVersion.body.item.id});
    expect(ownDraft.body.item).toMatchObject({buildInputs:{includeSearchPaths:[],defines:{CONSUMER:"1"}}});
  });

  it("keeps real health responsive and refuses concurrent CPP work while a bounded native expansion runs", async () => {
    const header = ['#define G0 1', ...Array.from({ length: 28 }, (_, index) => `#define G${index + 1} G${index} G${index}`)].join("\n");
    const slowDraft = (await call("", "POST", { name: "Bounded CPP", changeDescription: "限制验证", members: [
      { sourceName: "slow.dtsi", content: '#include "defs.h"\n/ { node { value = <G28>; }; };\n' }, { sourceName: "defs.h", content: header }] })).body.item;
    const other = (await call("", "POST", { name: "Concurrent CPP", changeDescription: "稍后预览", sourceName: "other.dtsi", content: '#define V 7\n/ { node { value = <V>; }; };\n' })).body.item;
    let settled = false;
    const pending = publicationCall(`/${slowDraft.resourceId}/publication-preview`, "POST", { expectedRevision: 1 }).finally(() => { settled = true; });
    const run = promisify(execFile), deadline = performance.now() + 5000;
    let compilerRunning = false;
    while (!compilerRunning && !settled && performance.now() < deadline) {
      const result = await run("docker", ["ps", "--no-trunc", "--filter", `label=wiseeff.dts.cpp.owner=${process.pid}`, "--format", "{{.Command}}"], { timeout: 1000, maxBuffer: 8192 });
      compilerRunning = result.stdout.split("\n").some(line => line.includes("/usr/local/bin/gcc") && !line.includes("-fdirectives-only"));
    }
    expect(compilerRunning).toBe(true); expect(settled).toBe(false);
    const healthStarted = performance.now();
    const health = await requestJson(server(), "/health/live");
    const elapsed = performance.now() - healthStarted;
    expect(health.status, `${elapsed.toFixed(1)}ms`).toBe(200);
    console.info(`Native CPP health response: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000); expect(settled).toBe(false);
    const busy = await publicationCall<{ error: { details: { reason: string } } }>(`/${other.resourceId}/publication-preview`, "POST", { expectedRevision: 1 });
    expect(busy.status, busy.bodyText).toBe(409);
    expect(busy.body.error.details.reason).toBe("preprocess-busy");
    const limited = await pending;
    expect(limited.status, limited.bodyText).toBe(400);
    expect((await call(`/${slowDraft.resourceId}`)).body.item).toEqual(slowDraft);
    expect((await call(`/${other.resourceId}`)).body.item).toEqual(other);
    const containers = await run("docker", ["ps", "-a", "--filter", `label=wiseeff.dts.cpp.owner=${process.pid}`, "--format", "{{.Names}}"], { timeout: 1000, maxBuffer: 8192 });
    expect(containers.stdout.trim()).toBe("");
  });

  it("imports a complete relative file set, publishes its closure and retains member identity on rename", async () => {
    const files = [{ sourceName: "lib/common.dtsi", content: '/include/ "parts/node.dtsi"\n&host { status = "okay"; };\n' },
      { sourceName: "lib/parts/node.dtsi", content: '/ { battery: battery { compatible = "test,battery"; }; };\r\n' },
      { sourceName: "include/constants.h", content: "#define VOLTAGE 42\r\n" }];
    const created = await call("", "POST", { name: "Complete library", members: files, changeDescription: "完整库依赖" });
    expect(created.status, created.bodyText).toBe(201);
    const draft = created.body.item;
    expect(draft.members).toEqual(expect.arrayContaining(files.map(file => expect.objectContaining(file))));
    const renamed = draft.members.map(member => ({ ...member,
      sourceName: member.sourceName === "lib/parts/node.dtsi" ? "lib/parts/renamed.dtsi" : member.sourceName,
      content: member.sourceName === "lib/common.dtsi" ? member.content.replace("node.dtsi", "renamed.dtsi") : member.content }));
    const saved = await call(`/${draft.resourceId}/draft`, "PUT", { name: draft.name, members: renamed, changeDescription: "保留身份重命名", expectedRevision: 1 });
    expect(saved.status, saved.bodyText).toBe(200);
    expect(saved.body.item.members.find(member => member.sourceName.endsWith("renamed.dtsi"))?.id)
      .toBe(draft.members.find(member => member.sourceName.endsWith("node.dtsi"))!.id);
    const preview = await publicationCall<{ item: { id: string; manifest: { members: { sourceName: string; role: string }[]; externalReferences: string[]; includeGraph: unknown[] } } }>(
      `/${draft.resourceId}/publication-preview`, "POST", { expectedRevision: 2 });
    expect(preview.status, preview.bodyText).toBe(201);
    expect(preview.body.item.manifest.externalReferences).toEqual(["host"]);
    expect(preview.body.item.manifest.members).toContainEqual(expect.objectContaining({sourceName:"include/constants.h",role:"header"}));
    expect(preview.body.item.manifest.includeGraph).toEqual([{sourceName:"lib/common.dtsi",target:"lib/parts/renamed.dtsi",line:1,column:1}]);
    const published = await publicationCall<{ item: { id: string; members: Draft["members"] } }>(`/${draft.resourceId}/publications`, "POST", {
      previewId: preview.body.item.id, idempotencyKey: "complete-library" });
    expect(published.status, published.bodyText).toBe(201);
    expect(published.body.item.members).toEqual(expect.arrayContaining(renamed.map(member=>expect.objectContaining(member))));
    expect((await call(`/${draft.resourceId}/draft`, "POST", { baseVersionId: published.body.item.id })).body.item.members)
      .toEqual(saved.body.item.members);
  });

  it("freezes an authorized transitive dependency closure and retains original source members", async () => {
    const publish=async(name:string,sourceName:string,content:string,dependencies:unknown[]=[])=>{
      const draft=await call("","POST",{name,sourceName,content,dependencies,changeDescription:"Fixed dependency"});
      expect(draft.status,draft.bodyText).toBe(201);
      const preview=await publicationCall<{item:{id:string}}>(`/${draft.body.item.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect(preview.status,preview.bodyText).toBe(201);
      const version=await publicationCall<{item:{id:string;resourceId:string;manifest:{dependencies:unknown[];dependencyClosure:{name:string;mountPath:string}[]};members:{sourceName:string;content:string}[]}}>(`/${draft.body.item.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:`dep-${draft.body.item.resourceId}`});
      expect(version.status,version.bodyText).toBe(201);return version.body.item;
    };
    const leaf=await publish("Dependency leaf","leaf.dtsi",'/ { leaf: leaf { status = "okay"; }; };');
    const pin={resourceId:leaf.resourceId,versionId:leaf.id,mountPath:""};
    const middle=await publish("Dependency middle","middle.dtsi",'/include/ "leaf.dtsi"\n&leaf { value = <42>; };',[pin]);
    expect(middle.manifest.dependencies).toEqual([pin]);
    const root=await publish("Dependency root","root.dtsi",'/include/ "middle/middle.dtsi"\n',[{resourceId:middle.resourceId,versionId:middle.id,mountPath:"middle"}]);
    expect(root.members).toHaveLength(1);
    expect(root.members[0]!.content).toBe('/include/ "middle/middle.dtsi"\n');
    expect(root.manifest.dependencyClosure).toEqual(expect.arrayContaining([
      expect.objectContaining({name:"Dependency middle",mountPath:"middle"}),
      expect.objectContaining({name:"Dependency leaf",mountPath:"middle"})]));
    expect((await call(`/${root.resourceId}/draft`,"POST",{baseVersionId:root.id})).body.item).toHaveProperty("dependencies",[{resourceId:middle.resourceId,versionId:middle.id,mountPath:"middle"}]);
  });

  it("imports original ZIP bytes and refuses unsafe archives without saving a partial resource", async () => {
    const zip = new JSZip();
    zip.file("lib/main.dtsi", '/include/ "node.dtsi"\n');
    zip.file("lib/node.dtsi", source);
    zip.file("headers/voltage.h", "\uFEFF#define VALUE 42\r\n");
    const archive = { name:"source.zip", contentBase64:await zip.generateAsync({type:"base64",compression:"DEFLATE"}) };
    const created = await call("", "POST", {name:"ZIP library",archive,changeDescription:"原始归档"});
    expect(created.status,created.bodyText).toBe(201);
    expect(created.body.item.members).toContainEqual(expect.objectContaining({sourceName:"headers/voltage.h",content:"\uFEFF#define VALUE 42\r\n"}));
    for (const [path,options] of [["../escape.dtsi",{}],["/absolute.dtsi",{}],["link.dtsi",{unixPermissions:0o120777}],["nested.zip",{}],["a/./duplicate.dtsi",{}]] as const) {
      const unsafe=new JSZip();unsafe.file(path,source,options);
      const result=await call("","POST",{name:"Unsafe ZIP",archive:{name:"unsafe.zip",contentBase64:await unsafe.generateAsync({type:"base64",platform:"UNIX"})}});
      expect(result.status,result.bodyText).toBe(400);
    }
    expect((await call("?q=Unsafe%20ZIP")).body.items).toEqual([]);
  });

  it("retains incomplete drafts and rejects cycles, version/path/label collisions and inaccessible fixed dependencies",async()=>{
    const publish=async(name:string,content:string)=>{
      const draft=(await call("","POST",{name,sourceName:"shared.dtsi",content,changeDescription:"Dependency diagnostics"})).body.item;
      const preview=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect(preview.status,preview.bodyText).toBe(201);
      const published=await publicationCall<{item:{id:string;resourceId:string}}>(`/${draft.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:draft.resourceId});
      expect(published.status,published.bodyText).toBe(201);return published.body.item;
    };
    const leaf=await publish("Diagnostic leaf",'/ { duplicate: leaf {}; };');
    const other=await publish("Diagnostic other",'/ { other: other {}; };');
    const pin={resourceId:leaf.resourceId,versionId:leaf.id,mountPath:"vendor"};
    const successorDraft=(await call(`/${leaf.resourceId}/draft`,"POST",{baseVersionId:leaf.id})).body.item;
    const successorSave=await call(`/${leaf.resourceId}/draft`,"PUT",{name:"Diagnostic leaf",members:successorDraft.members,expectedRevision:1,changeDescription:"Retain exact predecessor"});
    expect(successorSave.status,successorSave.bodyText).toBe(200);
    const successorPreview=await publicationCall<{item:{id:string}}>(`/${leaf.resourceId}/publication-preview`,"POST",{expectedRevision:2});
    const successor=await publicationCall<{item:{id:string}}>(`/${leaf.resourceId}/publications`,"POST",{previewId:successorPreview.body.item.id,idempotencyKey:"diagnostic-leaf-v2"});
    expect(successor.status,successor.bodyText).toBe(201);
    for(const [dependencies,content,match] of [
      [[pin,{...pin,mountPath:"different"}],'/ { root {}; };',"版本或挂载路径冲突"],
      [[pin,{...pin,versionId:successor.body.item.id}],'/ { root {}; };',"版本或挂载路径冲突"],
      [[pin,{resourceId:other.resourceId,versionId:other.id,mountPath:"vendor"}],'/ { root {}; };',"挂载路径重复"],
      [[pin],'/ { duplicate: local {}; };',"标签"],
      [[{...pin,resourceId:"99999999-9999-4999-8999-999999999999"}],'/ { root {}; };',"不存在"],
      [[pin],'/include/ "vendor/missing.dtsi"\n',"缺少依赖文件"]
    ] as const) {
      const draft=await call("","POST",{name:"Incomplete dependency",sourceName:"root.dtsi",content,dependencies,changeDescription:"Retain incomplete input"});
      expect(draft.status,draft.bodyText).toBe(201);
      const preview=await publicationCall<{error:{message:string}}>(`/${draft.body.item.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect([400,404]).toContain(preview.status);expect(preview.body.error.message).toContain(match);
      expect((await call(`/${draft.body.item.resourceId}`)).body.item).toEqual(draft.body.item);
      expect((await publicationCall<{items:unknown[]}>(`/${draft.body.item.resourceId}/versions`)).body.items).toEqual([]);
    }
    const editable=await call(`/${leaf.resourceId}/draft`,"POST",{baseVersionId:successor.body.item.id});
    const saved=await call(`/${leaf.resourceId}/draft`,"PUT",{name:"Diagnostic leaf",members:editable.body.item.members,expectedRevision:1,
      dependencies:[{...pin,mountPath:"self"}],changeDescription:"Cycle diagnostic"});
    expect(saved.status,saved.bodyText).toBe(200);
    const cycle=await publicationCall<{error:{message:string}}>(`/${leaf.resourceId}/publication-preview`,"POST",{expectedRevision:2});
    expect(cycle.status).toBe(400);expect(cycle.body.error.message).toContain("循环");
  });

  it("bounds the complete resource dependency depth before publishing a partial closure",async()=>{
    let previous:{resourceId:string;versionId:string;mountPath:string}|undefined;
    for(let depth=0;depth<17;depth++) {
      const created=await call("","POST",{name:`Bounded resource ${depth}`,sourceName:`depth-${depth}.dtsi`,content:`/ { depth_${depth} {}; };`,
        changeDescription:"Bounded closure",dependencies:previous?[previous]:[]});
      expect(created.status,created.bodyText).toBe(201);
      const preview=await publicationCall<{item:{id:string};error:{message:string}}>(`/${created.body.item.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      if(depth===16) {expect(preview.status,preview.bodyText).toBe(400);expect(preview.body.error.message).toContain("16 层");
        expect((await call(`/${created.body.item.resourceId}`)).body.item).toEqual(created.body.item);break;}
      expect(preview.status,preview.bodyText).toBe(201);
      const published=await publicationCall<{item:{id:string}}>(`/${created.body.item.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:`depth-${depth}`});
      expect(published.status,published.bodyText).toBe(201);previous={resourceId:created.body.item.resourceId,versionId:published.body.item.id,mountPath:""};
    }
  });

  it("replaces an existing draft from ZIP with CAS and matching member identity",async()=>{
    const draft=(await call("","POST",{name:"ZIP replacement",sourceName:"main.dtsi",content:source})).body.item;
    const zip=new JSZip();zip.file("main.dtsi",source.replace("disabled","okay"));zip.file("include/constants.h","#define V 42\n");
    const input={name:draft.name,archive:{name:"source.zip",contentBase64:await zip.generateAsync({type:"base64"})},expectedRevision:1};
    const saved=await call(`/${draft.resourceId}/draft`,"PUT",input);
    expect(saved.status,saved.bodyText).toBe(200);
    expect(saved.body.item).toMatchObject({revision:2,members:expect.arrayContaining([expect.objectContaining({id:draft.members[0]!.id,sourceName:"main.dtsi",content:source.replace("disabled","okay")})])});
    expect((await call(`/${draft.resourceId}/draft`,"PUT",input)).status).toBe(409);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(saved.body.item);
  });

  it("publishes native external node-path requirements and distinguishes locally provided targets",async()=>{
    for(const [content,externalReferences] of [
      ['&{/soc} { clocks = <&{/soc/clock}>; status = "okay"; };',["&{/soc/clock}","&{/soc}"]],
      ['/ { soc { clock {}; }; };\n&{/soc} { clocks = <&{/soc/clock}>; };',[]]
    ] as const) {
      const draft=(await call("","POST",{name:"Native paths",sourceName:"paths.dtsi",content,changeDescription:"原生节点路径"})).body.item;
      const preview=await publicationCall<{item:{id:string;manifest:{externalReferences:string[]}}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect(preview.status,preview.bodyText).toBe(201);
      expect(preview.body.item.manifest.externalReferences).toEqual(externalReferences);
      const version=await publicationCall<{item:{members:{content:string}[]}}>(`/${draft.resourceId}/publications`,"POST",{
        previewId:preview.body.item.id,idempotencyKey:`path-${draft.resourceId}`});
      expect(version.status,version.bodyText).toBe(201);
      expect(version.body.item.members[0]!.content).toBe(content);
    }
    const draft=(await call("","POST",{name:"Invalid path",sourceName:"paths.dtsi",content:'// invalid\n&{/soc/../clock} { status = "okay"; };',changeDescription:"拒绝无效路径"})).body.item;
    const preview=await publicationCall<{error:{details:{diagnostics:{line:number;sourceName:string}[]}}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    expect(preview.status,preview.bodyText).toBe(400);
    expect(preview.body.error.details.diagnostics).toContainEqual(expect.objectContaining({sourceName:"paths.dtsi",line:2}));
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
  });

  it("locates dependency failures without discarding the editable library draft", async () => {
    const cases=[
      {members:[{sourceName:"lib.dtsi",content:'// original comment\n/include/ "missing.dtsi"\n'}],file:"lib.dtsi",line:2,match:"missing.dtsi"},
      {members:[{sourceName:"lib.dtsi",content:'/include/ "leaf.dtsi"\n/include/ "cycle.dtsi"\n'},{sourceName:"leaf.dtsi",content:source},
        {sourceName:"cycle.dtsi",content:'// cycle edge\n/include/ "lib.dtsi"\n'}],file:"lib.dtsi",line:2,match:"循环"},
      {members:[{sourceName:"lib.dtsi",content:'// escape\n/include/ "../outside.dtsi"\n'}],file:"lib.dtsi",line:2,match:"逃逸"},
      {members:[{sourceName:"lib.dtsi",content:'/include/ "leaf.dtsi"\n/include/ "leaf.dtsi"\n'},{sourceName:"leaf.dtsi",content:source}],file:"leaf.dtsi",line:1,match:"重复"},
      {members:[{sourceName:"lib.dtsi",content:'// header\n#include HEADER\n'},{sourceName:"header.h",content:"#define V 1\n"}],file:"lib.dtsi",line:2,match:"字面路径"},
      {members:[{sourceName:"lib.dtsi",content:'// original syntax error\n/ { value = %; };'}],file:"lib.dtsi",line:2,match:"Unexpected character"}
    ];
    for (const candidate of cases) {
      const created=await call("","POST",{name:"Repairable library",members:candidate.members,changeDescription:"依赖诊断"});
      expect(created.status,created.bodyText).toBe(201);
      const draft=created.body.item;
      const preview=await publicationCall<{error:{details:{diagnostics:{sourceName:string;line:number;message:string}[]}}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect(preview.status,preview.bodyText).toBe(400);
      expect(preview.body.error.details.diagnostics).toContainEqual(expect.objectContaining({sourceName:candidate.file,line:candidate.line,message:expect.stringContaining(candidate.match)}));
      expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
    }
  });

  it("bounds library include nesting and expanded bytes independently of source size",async()=>{
    const depthMembers=Array.from({length:17},(_,index)=>({sourceName:`depth-${String(index).padStart(2,"0")}.dtsi`,
      content:index===0?source:`/include/ "depth-${String(index-1).padStart(2,"0")}.dtsi"\n`}));
    const expansionMembers=[{sourceName:"root.dtsi",content:'/include/ "large.dtsi"\n'.repeat(17)},
      {sourceName:"large.dtsi",content:`/*${"x".repeat(2*1024*1024-32)}*/\n${'/ {};'}\n`}];
    for(const members of [depthMembers,expansionMembers]) {
      const created=await call("","POST",{name:"Bounded library",members,changeDescription:"限制依赖展开"});
      expect(created.status,created.bodyText).toBe(201);
      const response=await publicationCall(`/${created.body.item.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect(response.status,response.bodyText).toBe(400);
    }
  });

  it("refuses foreign and ambiguous member identities while retaining the complete draft",async()=>{
    const original=(await call("","POST",{name:"Identity library",members:[{sourceName:"a.dtsi",content:source},{sourceName:"b.dtsi",content:"&battery { status = \"okay\"; };"}]})).body.item;
    const first=original.members[0]!;
    for(const members of [[{...first,id:"99999999-9999-4999-8999-999999999999"}],
      [{...first,sourceName:"renamed.dtsi"},{sourceName:first.sourceName,content:first.content}]]) {
      const result=await call(`/${original.resourceId}/draft`,"PUT",{name:original.name,members,expectedRevision:1});
      expect(result.status,result.bodyText).toBe(400);
      expect((await call(`/${original.resourceId}`)).body.item).toEqual(original);
    }
  });

  it("reads a pre-multifile immutable manifest with additive defaults",async()=>{
    const draft=(await call("","POST",{name:"Existing published library",sourceName:"legacy.dtsi",content:source})).body.item;
    const versionId="77777777-7777-4777-8777-777777777777",member=draft.members[0]!;
    // A persisted T02 revision is a compatibility fixture, not a write through the new publisher.
    const manifest={schemaVersion:"shared-dtsi/v1",members:[{id:member.id,sourceName:member.sourceName,checksum:"sha256:legacy",sizeBytes:Buffer.byteLength(source),role:"include"}],externalReferences:[]};
    await db.query(`insert into public.shared_dtsi_revisions(id,resource_id,organization_id,version,name,draft_revision,change_description,manifest,digest,created_by_user_id)
      values ($1,$2,$3,1,$4,1,'Legacy source',$5::jsonb,'sha256:legacy-version',$6)`,[versionId,draft.resourceId,auth.organization.id,draft.name,JSON.stringify(manifest),auth.user.id]);
    await db.query(`insert into public.shared_dtsi_revision_members(revision_id,member_id,resource_id,organization_id,source_name,content,checksum,size_bytes)
      values($1,$2,$3,$4,$5,$6,'sha256:legacy',$7)`,[versionId,member.id,draft.resourceId,auth.organization.id,member.sourceName,member.content,Buffer.byteLength(source)]);
    const result=await publicationCall<{item:{manifest:unknown;digest:string}}>(`/${draft.resourceId}/versions/${versionId}`);
    expect(result.status,result.bodyText).toBe(200);
    expect(result.body.item).toMatchObject({digest:"sha256:legacy-version",manifest:{...manifest,includeGraph:[],buildInputs:{includeSearchPaths:[]}}});
  });

  it("publishes a frozen source version, reads history without a draft, and replays the same request", async () => {
    const created = await call("", "POST", { name: "Published battery", sourceName: "battery.dtsi", content: source,
      changeDescription: "首次发布电池公共声明" });
    expect(created.status, created.bodyText).toBe(201);
    const draft = created.body.item;
    const preview = await publicationCall<{ item: { id: string; draftRevision: number; changeDescription: string } }>(
      `/${draft.resourceId}/publication-preview`, "POST", { expectedRevision: draft.revision });
    expect(preview.status, preview.bodyText).toBe(201);
    expect(preview.body.item).toMatchObject({ draftRevision: 1, changeDescription: "首次发布电池公共声明" });
    const request = { previewId: preview.body.item.id, idempotencyKey: "publish-first-battery" };
    type Published = { item: { id: string; version: number; changeDescription: string; members: Draft["members"] } };
    const published = await publicationCall<Published>(`/${draft.resourceId}/publications`, "POST", request);
    expect(published.status, published.bodyText).toBe(201);
    expect(published.body.item).toMatchObject({ version: 1, changeDescription: "首次发布电池公共声明",
      members: [{ id: draft.members[0]!.id, sourceName: "battery.dtsi", content: source }] });
    expect((await call(`/${draft.resourceId}`)).status).toBe(404);
    const detail = await publicationCall<{ item: { draftRevision: number | null; currentVersion: { id: string } } }>(`/${draft.resourceId}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.item).toMatchObject({ draftRevision: null, currentVersion: { id: published.body.item.id } });
    expect((await call("")).body.items).toContainEqual(expect.objectContaining({ resourceId: draft.resourceId, name: "Published battery" }));
    expect((await publicationCall<Published>(`/${draft.resourceId}/versions/${published.body.item.id}`)).body).toEqual(published.body);
    const replay = await publicationCall<Published>(`/${draft.resourceId}/publications`, "POST", request);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(published.body);
    const history = await publicationCall<{ items: { id: string }[] }>(`/${draft.resourceId}/versions`);
    expect(history.body.items.map(item => item.id)).toEqual([published.body.item.id]);
  });

  it("refuses stale or unauthorized publication and serializes competing previews", async () => {
    const input={name:"Guarded publication",sourceName:"guarded.dtsi",content:source,changeDescription:"共享默认状态"};
    const draft=(await call("","POST",input)).body.item;
    type Preview={item:{id:string}};
    const first=await publicationCall<Preview>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    await call(`/${draft.resourceId}/draft`,"PUT",{...input,content:source.replace("disabled","okay"),expectedRevision:1});
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:first.body.item.id,idempotencyKey:"stale-publish"})).status).toBe(409);
    const next=await publicationCall<Preview>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:2});
    const reader={...auth,roles:[],permissions:["parameter:view"] as typeof auth.permissions};
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:next.body.item.id,idempotencyKey:"denied-publish"},reader)).status).toBe(403);
    const other=makeTestAuthContext({organizationId:"org-other-dtsi",userId:"user-other-dtsi"});
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:next.body.item.id,idempotencyKey:"foreign-publish"},other)).status).toBe(404);
    const competing=await publicationCall<Preview>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:2});
    const results=await Promise.all([next.body.item.id,competing.body.item.id].map((previewId,i)=>publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId,idempotencyKey:`race-publish-${i}`})));
    expect(results.map(result=>result.status).sort()).toEqual([201,409]);
    const versions=await publicationCall<{items:{version:number}[]}>(`/${draft.resourceId}/versions`);
    expect(versions.body.items.map(item=>item.version)).toEqual([1]);
  });

  it("retains immutable published source after creating and discarding another draft", async () => {
    const draft=(await call("","POST",{name:"Retained history",sourceName:"history.dtsi",content:source,changeDescription:"保留公共历史"})).body.item;
    const preview=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    type Version={item:{id:string;members:Draft["members"]}};
    const published=await publicationCall<Version>(`/${draft.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:"retained-history"});
    const newDraft=await publicationCall<{item:Draft}>(`/${draft.resourceId}/draft`,"POST",{baseVersionId:published.body.item.id});
    expect(newDraft.status,newDraft.bodyText).toBe(201);
    expect(newDraft.body.item.id).not.toBe(draft.id);
    expect(newDraft.body.item.members[0]!.id).toBe(draft.members[0]!.id);
    const changed=await call(`/${draft.resourceId}/draft`,"PUT",{name:"Renamed draft",sourceName:"inc/renamed.dtsi",content:source.replace("disabled","okay"),changeDescription:"修改后续草稿",expectedRevision:1});
    expect(changed.status).toBe(200);
    expect(changed.body.item.members[0]!.id).toBe(draft.members[0]!.id);
    expect((await call(`/${draft.resourceId}/draft`,"DELETE",{expectedRevision:2})).status).toBe(200);
    expect((await publicationCall<{item:{name:string}}>(`/${draft.resourceId}/detail`)).body.item.name).toBe("Retained history");
    expect((await publicationCall<Version>(`/${draft.resourceId}/versions/${published.body.item.id}`)).body).toEqual(published.body);
    await expect(api.query("update public.shared_dtsi_revisions set name='changed' where id=$1",[published.body.item.id])).rejects.toThrow();
    await expect(api.query("delete from public.shared_dtsi_resources where id=$1",[draft.resourceId])).rejects.toThrow();
    expect((await publicationCall<Version>(`/${draft.resourceId}/versions/${published.body.item.id}`)).body).toEqual(published.body);
    await publicationCall(`/${draft.resourceId}/draft`,"POST",{baseVersionId:published.body.item.id});
    await call(`/${draft.resourceId}/draft`,"PUT",{name:"Retained history",sourceName:"history.dtsi",content:source.replace("disabled","okay"),changeDescription:"更新默认状态",expectedRevision:1});
    const next=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:2});
    const second=await publicationCall<Version>(`/${draft.resourceId}/publications`,"POST",{previewId:next.body.item.id,idempotencyKey:"retained-history-second"});
    expect(second.status,second.bodyText).toBe(201);
    type History={items:{id:string}[];total:number};
    const newest=await publicationCall<History>(`/${draft.resourceId}/versions?limit=1&offset=0`);
    const oldest=await publicationCall<History>(`/${draft.resourceId}/versions?limit=1&offset=1`);
    expect(newest.body).toMatchObject({items:[{id:second.body.item.id}],total:2});
    expect(oldest.body).toMatchObject({items:[{id:published.body.item.id}],total:2});
    expect((await publicationCall(`/${draft.resourceId}/versions?limit=101`)).status).toBe(400);
    const replay=await publicationCall<Version>(`/${draft.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:"retained-history"});
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(published.body);
    expect((await publicationCall<{item:{currentVersion:{id:string}}}>(`/${draft.resourceId}/detail`)).body.item.currentVersion.id).toBe(second.body.item.id);
  });

  it("serializes publication and discard without inverted source and preview locks",async()=>{
    const draft=(await call("","POST",{name:"Publication discard race",sourceName:"race.dtsi",content:source,changeDescription:"并发发布与丢弃"})).body.item;
    const preview=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    const role=(await api.query<{role:string}>("select current_user as role")).rows[0]!.role;
    const waitForLockCount=(count:number)=>vi.waitFor(async()=>{
      const waiting=(await db.query<{count:string}>("select count(*) from pg_stat_activity where datname=current_database() and usename=$1 and wait_event_type='Lock'",[role])).rows[0]!.count;
      expect(Number(waiting)).toBeGreaterThanOrEqual(count);
    },{timeout:5000,interval:10});
    const requests:Promise<{status:number;bodyText:string}>[]=[];
    let results:PromiseSettledResult<{status:number;bodyText:string}>[]=[];
    try {
      await db.transaction(async gate=>{
        await gate.query("select id from public.shared_dtsi_publication_previews where id=$1 for update",[preview.body.item.id]);
        requests.push(publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:"publish-discard-race"}));
        await waitForLockCount(1);
        requests.push(call(`/${draft.resourceId}/draft`,"DELETE",{expectedRevision:1}));
        await waitForLockCount(2);
      });
    } finally {results=await Promise.allSettled(requests);}
    expect(results.map(result=>result.status==="fulfilled"?result.value.status:-1)).toEqual([201,404]);
    expect((await publicationCall<{items:{version:number}[]}>(`/${draft.resourceId}/versions`)).body.items.map(version=>version.version)).toEqual([1]);
  },15_000);

  it("keeps drafts on invalid source or audit failure and allows a safe publication retry", async () => {
    for (const content of ["/ { broken {",'/include/ "missing.dtsi"\n/ {};', '#include "missing.h"\n/ {};', '# /**/ include "missing.h"\n/ {};', '/ { label: a {}; label: b {}; };']) {
      const draft=(await call("","POST",{name:"Invalid draft",sourceName:"invalid.dtsi",content,changeDescription:"检查语法与依赖"})).body.item;
      const rejected=await publicationCall(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect(rejected.status,rejected.bodyText).toBe(400);
      expect((await call(`/${draft.resourceId}`)).body.item.members[0]!.content).toBe(content);
      await call(`/${draft.resourceId}/draft`,"DELETE",{expectedRevision:1});
    }
    const draft=(await call("","POST",{name:"Atomic publication",sourceName:"atomic.dtsi",content:source,changeDescription:"审计原子提交"})).body.item;
    const preview=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    const request={previewId:preview.body.item.id,idempotencyKey:"atomic-publish"};
    await db.query(`create function public.reject_shared_publication_audit() returns trigger language plpgsql as $$begin
      if new.kind='shared-dtsi-publication' then raise exception 'Publication audit unavailable'; end if; return new; end$$;
      create trigger reject_shared_publication_audit before insert on public.audit_events for each row execute function public.reject_shared_publication_audit()`);
    try {
      expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",request)).status).toBe(500);
      expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
      expect((await publicationCall<{items:unknown[]}>(`/${draft.resourceId}/versions`)).body.items).toEqual([]);
    } finally { await db.query("drop trigger reject_shared_publication_audit on public.audit_events; drop function public.reject_shared_publication_audit()"); }
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",request)).status).toBe(201);
  });

  it("isolates resource reads and writes and denies read-only or inactive writers", async () => {
    const created = await call("", "POST", { name: "Private organization source", sourceName: "battery.dtsi", content: source });
    const draft = created.body.item;
    const other = makeTestAuthContext({ organizationId: "org-other-dtsi", userId: "user-other-dtsi" });
    expect((await call("", "GET", undefined, other)).body.items).toEqual([]);
    expect((await call(`/${draft.resourceId}`, "GET", undefined, other)).status).toBe(404);
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 }, other)).status).toBe(404);
    const reader = { ...auth, roles: [], permissions: ["parameter:view"] as typeof auth.permissions };
    expect((await call(`/${draft.resourceId}`, "GET", undefined, reader)).status).toBe(200);
    expect((await call("", "POST", { name: "Denied", sourceName: "denied.dtsi", content: "" }, reader)).status).toBe(403);
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 }, { ...auth, user: { ...auth.user, isActive: false } })).status).toBe(403);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 });
  });

  it("serializes competing updates and refuses stale saves and discards without losing source", async () => {
    const draft = (await call("", "POST", { name: "Concurrent source", sourceName: "battery.dtsi", content: source })).body.item;
    const updates = await Promise.all(["first", "second"].map(name => call(`/${draft.resourceId}/draft`, "PUT", {
      name, sourceName: "battery.dtsi", content: `// ${name}\n${source}`, expectedRevision: 1
    })));
    expect(updates.map(result => result.status).sort()).toEqual([200, 409]);
    const current = (await call(`/${draft.resourceId}`)).body.item;
    expect(current.revision).toBe(2);
    expect(current.members[0]!.content).toBe(`// ${current.name}\n${source}`);
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 })).status).toBe(409);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(current);
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 2 });
  });

  it("accepts incomplete draft text but rejects unsafe paths and undeclared fields", async () => {
    for (const sourceName of ["../battery.dtsi", "/battery.dtsi", "inc\\battery.dtsi", "battery.dts"]) {
      expect((await call("", "POST", { name: "Invalid path", sourceName, content: source })).status).toBe(400);
    }
    expect((await call("", "POST", { name: "Forged scope", sourceName: "battery.dtsi", content: source, organizationId: "org-other-dtsi" })).status).toBe(400);
    const draft = (await call("", "POST", { name: "Incomplete source", sourceName: "battery.dtsi", content: "/ { unfinished {" })).body.item;
    expect((await call(`/${draft.resourceId}`)).body.item.members[0]!.content).toBe("/ { unfinished {");
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 });
  });

  it("rolls back a source write when its audit fails and keeps suspended resources readable", async () => {
    await db.query(`create function public.reject_shared_dtsi_audit() returns trigger language plpgsql as $$begin
      if new.kind='shared-dtsi-draft' then raise exception 'Shared source audit unavailable'; end if; return new; end$$;
      create trigger reject_shared_dtsi_audit before insert on public.audit_events for each row execute function public.reject_shared_dtsi_audit()`);
    try {
      expect((await call("", "POST", { name: "Rollback probe", sourceName: "battery.dtsi", content: source })).status).toBe(500);
      expect((await call("?q=Rollback")).body.items).toEqual([]);
    } finally {
      await db.query("drop trigger reject_shared_dtsi_audit on public.audit_events; drop function public.reject_shared_dtsi_audit()");
    }
    const draft = (await call("", "POST", { name: "Suspended source", sourceName: "battery.dtsi", content: source })).body.item;
    await db.query("update organizations set status='suspended' where id='org-shared-dtsi'");
    try {
      expect((await call(`/${draft.resourceId}`)).status).toBe(200);
      expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 })).status).toBe(403);
    } finally { await db.query("update organizations set status='active' where id='org-shared-dtsi'"); }
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 });
  });
});

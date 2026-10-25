import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { registerParameterFileRoutes } from "./routes";
import { readConfigSetPackage } from "./configSetPackage";
import { configSetPackageManifestName } from "../contracts/dtoSchemas/configSetPackage";

describe("complete source package public import boundary", () => {
  it("recognizes the project package preview route before requiring its runtime", async () => {
    const router = createRouter();
    registerParameterFileRoutes(router, { getCurrentAuthContext: () => makeTestAuthContext() });
    const zip = new JSZip();
    zip.file("board.dts", '/dts-v1/; / { model = "original"; };');
    const result = await requestJson(createHttpServer(router), "/api/v1/projects/new-project/config-set-import/preview", {
      method: "POST", body: JSON.stringify({ archive: { name: "configuration.zip", contentBase64: await zip.generateAsync({ type: "base64" }) }, ownership: "reuse", name: "Imported" })
    });
    expect(result.status).toBe(500);
    expect(result.bodyText).toContain("storage");
  });

  it("retains exact BOM/CRLF comments and directories while ignoring archived project and approval identities", async () => {
    const source = '\uFEFF/dts-v1/;\r\n// original comment\r\n/ { model = "original"; };\r\n';
    const zip = new JSZip();
    zip.file("boards/vendor/board.dts", source);
    zip.file(configSetPackageManifestName, JSON.stringify({ projectId:"forged-project", organizationId:"foreign", bindingId:"old-binding", approvalId:"old-approval",
      sourcePackage:{schemaVersion:"wiseeff-config-set/v1", entryFile:"boards/vendor/board.dts",includeSearchPaths:["."], overlayOrder:[],
        declaredBuildInputs:{includeSearchPaths:["."],defines:{}},resolvedBuildInputs:{includeSearchPaths:["."],defines:{}},
        members:[{sourceName:"boards/vendor/board.dts",format:"dts",role:"base",sortOrder:0,checksum:`sha256:${createHash("sha256").update(source).digest("hex")}`,
          fileId:"old-file",fileVersionId:"old-version", bindingId:"old-binding"}], sharedClosure:[],jsonSources:[]}}));
    const archive={name:"config.zip",contentBase64:await zip.generateAsync({type:"base64"})};
    const imported = await readConfigSetPackage(archive);
    expect(imported.contents.get("boards/vendor/board.dts")).toBe(source);
    expect(JSON.stringify(imported.manifest)).not.toMatch(/forged-project|foreign|old-binding|old-approval|old-file|old-version/u);
    zip.file("boards/vendor/board.dts", source.replace("original", "tampered"));
    await expect(readConfigSetPackage({ ...archive,contentBase64:await zip.generateAsync({type:"base64"}) })).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    zip.file("../outside.dtsi", source);
    await expect(readConfigSetPackage({ ...archive,contentBase64:await zip.generateAsync({type:"base64"}) })).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
});

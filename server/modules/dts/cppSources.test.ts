import { describe, expect, it } from "vitest";
import { prepareDtsSources } from "./cppSources";
import { resolveDtsConfigSetAsync as resolveDtsConfigSet } from "./configSetResolver";

const input = (content: string, header = "") => ({ entryFile: "board.dts", includeSearchPaths: [], overlayOrder: [],
  files: new Map([["board.dts", { fileVersionId: "board-v1", content }], ["defs.h", { fileVersionId: "defs-v1", content: header }]]) });

describe("controlled original DTS preprocessing", () => {
  it("retains the legacy source path without requiring a compiler", async () => {
    expect(await prepareDtsSources(input('/dts-v1/; / { node { value = <7>; }; };'))).toBeNull();
  });
  it.each(["__DATE__", "__TIME__", "__TIMESTAMP__", "__FILE__", "__BASE_FILE__"])("refuses unfrozen %s before any compiler execution", async macro => {
    await expect(prepareDtsSources(input('#include "defs.h"\n/ { node { value = <VALUE>; }; };', `#define VALUE ${macro}`)))
      .rejects.toThrow(/冻结|frozen/u);
  });
  it.each(['#line 1 "board.dts"', '#include "/etc/passwd"', '#include "../outside.h"', '#include HEADER', '#include_next "defs.h"', '#pragma GCC dependency "outside.h"', '#embed "outside.h"'])
    ("refuses unsafe file/remapping directives even in inactive headers: %s", async directive => {
      await expect(prepareDtsSources(input('#include "defs.h"\n/ {};', `#if 0\n${directive}\n#endif`))).rejects.toThrow();
    });
  it("does not let a header character literal conceal a forged source location", async () => {
    await expect(prepareDtsSources(input('#include "defs.h"\n/ {};', '#define CHARACTER \'/*\'\n#line 1 "board.dts"\n')))
      .rejects.toMatchObject({ code: "preprocess-input", fileName: "defs.h", message: expect.stringContaining("#line") });
  });
  it("rejects computed volatile tokens and unsafe earlier include search candidates before launch", async () => {
    await expect(prepareDtsSources(input('#include "defs.h"\n/ {};','#define JOIN(a,b) a##b\n#define VOLATILE JOIN(__TI,ME__)'))).rejects.toMatchObject({code:"preprocess-input"});
    await expect(prepareDtsSources({...input('/ {};'),defines:{VALUE:"__TIME__"}})).rejects.toMatchObject({code:"preprocess-input"});
    await expect(prepareDtsSources({...input('#include "../defs.h"\n/ {};'),includeSearchPaths:["safe"],
      files:new Map([["board.dts",{fileVersionId:"board",content:'#include "../defs.h"\n/ {};'}],["defs.h",{fileVersionId:"header",content:"#define A 1"}]])})).rejects.toMatchObject({code:"preprocess-input"});
  });
});

describe("native pinned CPP original-source proof", () => {
  it.each(["missing_target", "{/missing}"])("locates unresolved overlay &%s in its original included source", async target => {
    const source = `// 🧪 exact original location\r\n\r\n&${target} { value = <LIMIT>; };\r\n`;
    const manifest = input('#include "defs.h"\n/dts-v1/;\n/include/ "parts/requirements.dtsi"\n/ {};\n', "#define LIMIT 7\n");
    manifest.files.set("parts/requirements.dtsi", { fileVersionId: "requirements-v1", content: source });
    const result = await resolveDtsConfigSet({ ...manifest, requireExactOrigins: true });
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: target === "missing_target" ? "dangling-reference" : "target-unresolved",
      fileName: "parts/requirements.dtsi", offset: source.indexOf("&"),
    })]);
  });
  it.each([["LF", "\n", ""], ["BOM/CRLF", "\r\n", "\uFEFF"]])("keeps UTF-16 spans after an inactive astral comment (%s)", async (_name, newline, prefix) => {
    const content = prefix + ['#define V 1', '#if 0', '// 😀', '#endif', '// 🧪 active', '/ { node { value = <V>; }; };', ''].join(newline!);
    const result = await resolveDtsConfigSet({ ...input(content), requireExactOrigins: true });
    expect(result.diagnostics).toEqual([]);
    const start = content.indexOf("<V>"), end = start + "<V>".length;
    const property = result.effective.nodesByLocator.get("/node")!.properties.get("value")!;
    expect(property.value).toMatchObject({kind:"cells",groups:[[{kind:"integer",value:"1"}]]});
    expect(property.sourceChain[0]!.origin).toEqual({fileVersionId:"board-v1",start,end,mode:"expanded-v1"});
    const originalNode = result.preprocessing!.originalDocuments.get("board.dts")!.topLevel[0]!.children[0]!;
    if (originalNode.kind !== "node") throw new Error("expected original node");
    expect(originalNode.children[0]).toMatchObject({kind:"property",rawText:"<V>",span:{start,end}});
    expect(content.slice(start,end)).toBe("<V>");
  });
  it("retains original macro invocations, conditional occurrences and exact UTF-16 spans", async () => {
    const content = '\uFEFF// 🧪 原始源码\r\n#include "defs.h"\r\n/dts-v1/;\r\n/ {\r\n #address-cells = <1>;\r\n first {\r\n#if 0\r\nvalue = <99>;\r\n#else\r\nvalue = <PAIR(3, BIT(3))>;\r\n#endif\r\n };\r\n second { value = <PAIR(3, BIT(3))>; };\r\n};\r\n';
    const manifest = input(content, '#define BIT(x) (1U << (x))\n#define PAIR(a,b) a b\n');
    const result = await resolveDtsConfigSet({ ...manifest, requireExactOrigins: true });
    expect(result.diagnostics).toEqual([]);
    const first = result.effective.nodesByLocator.get("/first")!.properties.get("value")!;
    expect(first.value).toMatchObject({ kind: "cells", groups: [[{ value: "3" }, { value: "8" }]] });
    expect(first.normalizedValue).toBe("<3 8>");
    expect(first.sourceChain[0]!.origin).toEqual({ fileVersionId: "board-v1", start: content.indexOf("<PAIR"), end: content.indexOf("<PAIR") + "<PAIR(3, BIT(3))>".length, mode: "expanded-v1" });
    const original = result.preprocessing!.originalDocuments.get("board.dts")!.topLevel[0]!.children[1]!;
    expect(original.kind).toBe("node");
    if (original.kind !== "node") throw new Error("original node missing");
    expect(original.children).toHaveLength(1);
    expect(original.children[0]).toMatchObject({ kind: "property", rawText: "<PAIR(3, BIT(3))>" });
    expect(result.sourceFiles).toEqual(expect.arrayContaining(["board.dts", "defs.h"]));
    expect(manifest.files.get("board.dts")!.content).toBe(content);
    const again = (await prepareDtsSources(manifest))!;
    expect(again.receipt).toEqual(result.preprocessing!.receipt);
    expect([...again.documents.values()].map(document => document.text).join("\n")).not.toContain("wiseeff-cpp-");
    expect((await resolveDtsConfigSet({ ...manifest, preprocessing: { ...again.receipt, inputDigest: `sha256:${"0".repeat(64)}` } })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: "preprocess-stale", severity: "error" }));
  });

  it("composes native include and C headers through one frozen semantic expansion", async () => {
    const manifest = input('#include "defs.h"\n/dts-v1/;\n/include/ "nodes.dtsi"\n', "#define LIMIT 37\n");
    manifest.files.set("nodes.dtsi", { fileVersionId: "node-v1", content: '/ { node { value = <LIMIT>; }; };\n' });
    const result = await resolveDtsConfigSet(manifest);
    expect(result.diagnostics).toEqual([]);
    expect(result.effective.nodesByLocator.get("/node")!.properties.get("value")!.sourceChain[0]).toMatchObject({
      fileName: "nodes.dtsi", rawText: "<37>", origin: { fileVersionId: "node-v1", mode: "expanded-v1" }
    });
  });

  it("refuses generated declarations with a source/local override correction", async () => {
    const result = await resolveDtsConfigSet(input('#include "defs.h"\n/ { node { MAKE; }; };\n', "#define MAKE value = <7>\n"));
    expect(result.effective.nodesByLocator.size).toBe(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "preprocess-origin", message: expect.stringContaining("本地覆盖") }));
  });

  it.each([
    input('#include "defs.h"\n/dts-v1/;\n', '/ { header_node { value = <7>; }; };\n'),
    input('#define ENABLED 1\n/ { node { value = <\n#if ENABLED\n7\n#endif\n>; }; };\n')
  ])("refuses declarations in headers and property ranges crossing preprocessing directives", async manifest => {
    const result = await resolveDtsConfigSet(manifest);
    expect(result.effective.nodesByLocator.size).toBe(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "preprocess-origin" }));
  });

  it("bounds exponential macro expansion without returning an active graph", async () => {
    const header = ['#define G0 1', ...Array.from({ length: 28 }, (_, index) => `#define G${index + 1} G${index} G${index}`)].join("\n");
    const result = await resolveDtsConfigSet(input('#include "defs.h"\n/ { node { value = <G28>; }; };\n', header));
    expect(result.effective.nodesByLocator.size).toBe(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "preprocess-limit" }));
  });
});

import { describe,expect,it } from "vitest";
import { lexDts,parseDts,parseDtsValue,renderDtsValue,resolveDts,resolveDtsConfigSet,serializeDts } from "./index";

describe("native absolute node-path references",()=>{
  it("parses overlay and cell paths and retains their exact source spans and layout",()=>{
    const source='/ { soc { clock@0 {}; }; };\r\n&{/soc} { clocks = <&{/soc/clock@0} 1>; };\r\n';
    const document=parseDts(source),overlay=document.topLevel[1]!;
    expect(overlay.refTarget).toBe("{/soc}");
    expect(source.slice(overlay.span.start,overlay.span.end)).toBe('&{/soc} { clocks = <&{/soc/clock@0} 1>; };');
    expect(serializeDts(document)).toBe(source);
    const raw='<&{ /soc/clock@0 } /* keep */ 1>',value=parseDtsValue("clocks",raw).value;
    expect(value).toEqual({kind:"cells",bits:32,groups:[[{kind:"phandle",label:"{/soc/clock@0}"},{kind:"integer",raw:"1",value:"1"}]]});
    expect(renderDtsValue(value,raw)).toBe(raw);
    expect(renderDtsValue(value)).toBe("<&{/soc/clock@0} 1>");
    expect(lexDts(source).filter(token=>token.kind==="directive")).toEqual([]);
    const resolved=resolveDts(document);
    expect(resolved.nodes.find(node=>node.nodePath==="soc")?.phandleRefs).toEqual([{fromProperty:"clocks",targetLabel:"{/soc/clock@0}"}]);
    expect(resolved.nodes.some(node=>node.nodePath.includes("{"))).toBe(false);
  });

  it("composes actual path targets with original property proof across members",()=>{
    const overlay='/* original */\n&{/soc} { status = "okay"; clocks = <&{/soc/clock@0}>; };\n';
    const result=resolveDtsConfigSet({entryFile:"board.dts",includeSearchPaths:[],overlayOrder:["overlay.dtsi"],requireExactOrigins:true,files:new Map([
      ["board.dts",{fileVersionId:"base-v1",content:'/ { soc { clock@0 {}; status = "disabled"; }; };'}],
      ["overlay.dtsi",{fileVersionId:"overlay-v1",content:overlay}]
    ])});
    expect(result.diagnostics).toEqual([]);
    const property=result.effective.nodesByLocator.get("/soc")!.properties.get("status")!;
    expect(property.normalizedValue).toBe('"okay"');
    const origin=property.sourceChain.at(-1)!.origin!;
    expect(origin.fileVersionId).toBe("overlay-v1");
    expect(overlay.slice(origin.start,origin.end)).toBe('"okay"');
    expect([...result.effective.nodesByLocator.keys()]).toEqual(["/","/soc","/soc/clock@0"]);
  });

  it.each(["soc","/soc/../clock","/soc//clock","/soc/","","/soc name"])("rejects invalid path %s at the native parser and value boundaries",path=>{
    expect(()=>parseDts(`&{${path}} { status = "okay"; };`)).toThrow();
    expect(()=>parseDtsValue("clocks",`<&{${path}}>`)).toThrow();
    const result=resolveDtsConfigSet({entryFile:"board.dts",includeSearchPaths:[],overlayOrder:[],files:new Map([
      ["board.dts",{fileVersionId:"v1",content:`/include/ "invalid.dtsi"`}],["invalid.dtsi",{fileVersionId:"v2",content:`&{${path}} { status = "okay"; };`}]
    ])});
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"target-unresolved",severity:"error",fileName:"invalid.dtsi"}));
  });

  it.each(['&{/absent} { status = "okay"; };','/ { soc { clocks = <&{/absent}>; }; };'])("refuses missing project path targets without synthetic anchors",content=>{
    const result=resolveDtsConfigSet({entryFile:"board.dts",includeSearchPaths:[],overlayOrder:[],requireExactOrigins:true,
      files:new Map([["board.dts",{fileVersionId:"v1",content}]])});
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"target-unresolved",severity:"error"}));
    expect([...result.effective.nodesByLocator.keys()].some(key=>key.includes("absent"))).toBe(false);
    expect(()=>resolveDts(content)).toThrow(/absent/u);
  });
});

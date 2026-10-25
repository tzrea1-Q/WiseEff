import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ensureOverlayProperty } from "./overlayWriteback";
import { parseDts } from "../dts";

describe("exact occurrence source patch", () => {
  it("patches a proven original CST while preserving every original preprocessing directive", () => {
    const source='#if 1\n&{/soc} { rate = <1>; untouched = <7>; };\n#endif\n';
    const preparedDocument=parseDts(source.replace(/^#.*$/gmu,line=>" ".repeat(line.length)));
    const start=source.indexOf("<1>");
    expect(ensureOverlayProperty(source,{propertyKey:"rate",rawText:null,action:"remove-override",targetRef:"{/soc}",preparedDocument,
      expectedChecksum:createHash("sha256").update(source).digest("hex"),occurrenceSpan:{start,end:start+3},expectedRawText:"<1>"}))
      .toBe('#if 1\n&{/soc} {  untouched = <7>; };\n#endif\n');
  });
  it("removes only the exact local declaration and leaves lower statements and comments untouched", () => {
    const source = '/* keep */ &{/soc} { rate = <1>; untouched = <7>; };\n&{/soc} { /* intentional */ rate = <1>; };\n';
    const start=source.lastIndexOf("<1>");
    expect(ensureOverlayProperty(source,{propertyKey:"rate",action:"remove-override",rawText:null,targetRef:"{/soc}",
      expectedChecksum:createHash("sha256").update(source).digest("hex"),occurrenceSpan:{start,end:start+3},expectedRawText:"<1>"}))
      .toBe('/* keep */ &{/soc} { rate = <1>; untouched = <7>; };\n&{/soc} { /* intentional */  };\n');
    expect(() => ensureOverlayProperty(source,{propertyKey:"rate",action:"remove-override",rawText:null,targetRef:"{/soc}",
      expectedChecksum:createHash("sha256").update(source).digest("hex")})).toThrow("精确的本项目属性声明");
  });
  it("writes the exact path-reference occurrence without changing its native target or cell reference",()=>{
    const source='/* original */\n&{/soc} { rate = <1>; clocks = <&{/soc/clock}>; };\n';
    const start=source.indexOf("<1>");
    const patched=ensureOverlayProperty(source,{propertyKey:"rate",rawText:"<2>",action:"set",targetRef:"{/soc}",
      expectedChecksum:createHash("sha256").update(source).digest("hex"),occurrenceSpan:{start,end:start+3},expectedRawText:"<1>"});
    expect(patched).toBe('/* original */\n&{/soc} { rate = <2>; clocks = <&{/soc/clock}>; };\n');
    expect(ensureOverlayProperty("",{propertyKey:"rate",rawText:"<3>",action:"set",targetRef:"{/soc}",
      expectedChecksum:createHash("sha256").update("").digest("hex")})).toBe("\n&{/soc} {\n\trate = <3>;\n};\n");
  });
  it("replaces a pinned root property without inventing a ref, but refuses unlocated insertion", () => {
    const source = "/dts-v1/;\n/ { rate = <1>; untouched = <7>; };\n";
    const input = { propertyKey: "rate", rawText: "<22>", action: "set" as const, targetRef: "",
      expectedChecksum: createHash("sha256").update(source).digest("hex") };
    const start = source.indexOf("<1>");
    expect(ensureOverlayProperty(source, { ...input, occurrenceSpan: { start, end: start + 3 } }))
      .toBe("/dts-v1/;\n/ { rate = <22>; untouched = <7>; };\n");
    expect(() => ensureOverlayProperty(source, input)).toThrow("explicit target ref");
    expect(() => ensureOverlayProperty(source, { ...input, occurrenceSpan: { start: 0, end: 3 } })).toThrow("span is stale");
  });
});

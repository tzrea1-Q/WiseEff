import { describe, expect, it } from "vitest";
import { parseDts } from "../dts";
import { sharedDtsiDeclarationSemantics } from "./comparison";

describe("ordered shared fragment declarations",()=>{
  const semantics=(source:string)=>sharedDtsiDeclarationSemantics(parseDts(source).topLevel);
  it("ignores trivia and numeric spelling but retains separate paths, deletes and ordered overrides",()=>{
    expect(semantics('/ { a { value = <0x2a>; }; };')).toBe(semantics('/ { /* comment */ a { value=<42>; }; };'));
    expect(semantics('/ { a { compatible="test,same"; value=<1>; }; b { compatible="test,same"; value=<2>; }; };'))
      .not.toBe(semantics('/ { a { compatible="test,same"; value=<2>; }; b { compatible="test,same"; value=<1>; }; };'));
    const before=semantics('/ { a { value=<1>; /delete-property/ value; value=<2>; }; };');
    const after=semantics('/ { a { value=<1>; value=<2>; /delete-property/ value; }; };');
    expect(before).not.toBe(after);
    expect(before).toContain('value = <1>;\n    /delete-property/ value;\n    value = <2>;');
    expect(semantics('&{/soc/a} { status="disabled"; };')).toContain('&{/soc/a}');
  });
});

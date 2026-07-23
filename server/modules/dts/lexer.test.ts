import { describe, expect, it } from "vitest";
import { lexDts, type DtsToken } from "./lexer";

function kinds(tokens: DtsToken[]): string[] {
  return tokens.filter((t) => t.kind !== "eof").map((t) => t.kind);
}

function values(tokens: DtsToken[]): string[] {
  return tokens.filter((t) => t.kind !== "eof").map((t) => t.value);
}

describe("lexDts", () => {
  it("tokenizes identifiers including hyphen and vendor comma names", () => {
    const tokens = lexDts("vendor,led-type = <1>;");
    expect(values(tokens)).toEqual(["vendor,led-type", "=", "<", "1", ">", ";"]);
    expect(kinds(tokens)).toEqual(["ident", "eq", "lt", "number", "gt", "semi"]);
  });

  it("tokenizes @ & : and braces/semicolons/commas", () => {
    const tokens = lexDts("lab:chip@6E { prop = <&ref 1>; };");
    expect(values(tokens)).toContain("lab");
    expect(values(tokens)).toContain(":");
    expect(values(tokens)).toContain("chip");
    expect(values(tokens)).toContain("@");
    expect(values(tokens)).toContain("6E");
    expect(values(tokens)).toContain("{");
    expect(values(tokens)).toContain("&");
    expect(values(tokens)).toContain("ref");
    expect(values(tokens)).toContain("}");
    expect(kinds(tokens)).toEqual([
      "ident",
      "colon",
      "ident",
      "at",
      "number",
      "lbrace",
      "ident",
      "eq",
      "lt",
      "amp",
      "ident",
      "number",
      "gt",
      "semi",
      "rbrace",
      "semi",
    ]);
  });

  it("tokenizes decimal and hexadecimal numbers", () => {
    const tokens = lexDts("<42 0x220022 0xB>");
    expect(values(tokens)).toEqual(["<", "42", "0x220022", "0xB", ">"]);
    expect(kinds(tokens).filter((k) => k === "number")).toHaveLength(3);
  });

  it("tokenizes negative integers", () => {
    const tokens = lexDts("<-1>");
    expect(values(tokens)).toEqual(["<", "-1", ">"]);
  });

  it("tokenizes parenthesized negative integers (dtc 1.8+ cell form)", () => {
    const tokens = lexDts("<(-1) 42>");
    expect(values(tokens)).toEqual(["<", "(", "-1", ")", "42", ">"]);
  });

  it("tokenizes strings with escapes and internal comment-like text", () => {
    const tokens = lexDts(`path = "a/*not*/b\\n";`);
    const str = tokens.find((t) => t.kind === "string");
    expect(str?.value).toBe(`"a/*not*/b\\n"`);
  });

  it("tokenizes /bits/ /dts-v1/ /plugin/ /include/ directives", () => {
    const tokens = lexDts(`/dts-v1/; /plugin/; /include/ "pin.dtsi" /bits/ 8 <0x19>;`);
    expect(values(tokens).filter((v) => v.startsWith("/"))).toEqual([
      "/dts-v1/",
      "/plugin/",
      "/include/",
      "/bits/",
    ]);
    expect(kinds(tokens).filter((k) => k === "directive")).toHaveLength(4);
  });

  it("tokenizes bare root slash as slash token", () => {
    const tokens = lexDts("/ { board_id = <0>; };");
    expect(tokens[0]).toMatchObject({ kind: "slash", value: "/" });
  });

  it("strips comments before tokenizing and keeps spans aligned to source length", () => {
    const source = "a = <1>; /* skip */ b = <2>; // trail\n";
    const tokens = lexDts(source);
    expect(values(tokens)).toEqual(["a", "=", "<", "1", ">", ";", "b", "=", "<", "2", ">", ";"]);
    for (const token of tokens) {
      if (token.kind === "eof") continue;
      expect(token.span.start).toBeGreaterThanOrEqual(0);
      expect(token.span.end).toBeGreaterThan(token.span.start);
      expect(token.span.end).toBeLessThanOrEqual(source.length);
    }
  });

  it("tokenizes #address-cells style names", () => {
    const tokens = lexDts("#address-cells = <1>;");
    expect(tokens[0]).toMatchObject({ kind: "ident", value: "#address-cells" });
  });
});

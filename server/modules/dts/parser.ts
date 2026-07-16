import { lexDts, type DtsToken } from "./lexer";
import type {
  DtsDeleteNodeCst,
  DtsDeletePropertyCst,
  DtsDirective,
  DtsDocument,
  DtsNodeCst,
  DtsPropertyCst,
  DtsValue,
  DtsValueType,
} from "./types";
import { classifyDtsValue } from "./valueTyping";
import { parseDtsValue } from "./valueAst";

/**
 * `parseDtsValue` covers the DTS forms exercised by our fixtures; fall back to a value shaped
 * like the legacy `valueType` classification for any unrecognized RHS so an unusual real-world
 * property never aborts the whole document parse.
 */
function safeParseDtsValue(name: string, rawText: string, valueType: DtsValueType): DtsValue {
  try {
    return parseDtsValue(name, rawText).value;
  } catch {
    switch (valueType) {
      case "bool":
        return { kind: "boolean", present: true };
      case "empty":
        return { kind: "empty" };
      case "string-list":
        return { kind: "strings", values: [] };
      case "bytes":
        return { kind: "bytes", values: [] };
      default:
        return { kind: "mixed", segments: [] };
    }
  }
}

class Parser {
  private readonly tokens: DtsToken[];
  private readonly source: string;
  private i = 0;

  constructor(source: string) {
    this.source = source;
    this.tokens = lexDts(source);
  }

  parse(): DtsDocument {
    const directives: DtsDirective[] = [];
    const topLevel: DtsNodeCst[] = [];
    const orphanProperties: import("./types").DtsPropertyCst[] = [];

    while (!this.check("eof")) {
      if (this.check("directive")) {
        directives.push(this.parseDirective());
        continue;
      }
      if (this.looksLikeNode() || this.check("slash") || this.check("amp")) {
        topLevel.push(this.parseNode());
        continue;
      }
      // Top-level properties (fragment-style) attach to a synthetic root for indexing.
      orphanProperties.push(this.parseProperty());
    }

    if (orphanProperties.length > 0) {
      topLevel.unshift({
        kind: "node",
        name: "/",
        labels: [],
        isOverlayRoot: true,
        children: orphanProperties,
        span: {
          start: orphanProperties[0].span.start,
          end: orphanProperties[orphanProperties.length - 1].span.end,
        },
      });
    }

    return { directives, topLevel, source: this.source };
  }

  private peek(offset = 0): DtsToken {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }

  private check(kind: DtsToken["kind"], offset = 0): boolean {
    return this.peek(offset).kind === kind;
  }

  private at(...kinds: Array<DtsToken["kind"]>): boolean {
    return kinds.includes(this.peek().kind);
  }

  private advance(): DtsToken {
    const token = this.peek();
    if (token.kind !== "eof") {
      this.i += 1;
    }
    return token;
  }

  private expect(kind: DtsToken["kind"], message?: string): DtsToken {
    const token = this.peek();
    if (token.kind !== kind) {
      throw new Error(message ?? `Expected ${kind} but found ${token.kind} (${token.value}) at ${token.span.start}`);
    }
    return this.advance();
  }

  private parseDirective(): DtsDirective {
    const tok = this.expect("directive");
    if (tok.value === "/include/") {
      const argTok = this.expect("string", "/include/ requires a string argument");
      const arg = argTok.value.slice(1, -1);
      return {
        kind: "directive",
        name: tok.value,
        arg,
        unsupported: true,
        span: { start: tok.span.start, end: argTok.span.end },
      };
    }
    // /dts-v1/; /plugin/; trailing semi is typical
    if (this.check("semi")) {
      const semi = this.advance();
      return {
        kind: "directive",
        name: tok.value,
        unsupported: false,
        span: { start: tok.span.start, end: semi.span.end },
      };
    }
    return {
      kind: "directive",
      name: tok.value,
      unsupported: false,
      span: { ...tok.span },
    };
  }

  private parseNode(): DtsNodeCst {
    const start = this.peek().span.start;
    const labels: string[] = [];

    // Collect leading labels: label:label:name
    while (this.check("ident") && this.check("colon", 1)) {
      labels.push(this.advance().value);
      this.expect("colon");
    }

    let name = "";
    let unitAddress: string | undefined;
    let refTarget: string | undefined;
    let isOverlayRoot = false;

    if (this.check("amp")) {
      this.advance();
      const label = this.expect("ident", "Expected label after &");
      refTarget = label.value;
      name = "";
    } else if (this.check("slash")) {
      this.advance();
      name = "/";
      isOverlayRoot = true;
    } else {
      const nameTok = this.expect("ident", "Expected node name");
      name = nameTok.value;
      if (this.check("at")) {
        this.advance();
        const addr = this.peek();
        if (addr.kind === "number" || addr.kind === "ident") {
          unitAddress = this.advance().value;
        } else {
          throw new Error(`Expected unit address after @ at ${addr.span.start}`);
        }
      }
    }

    this.expect("lbrace");
    const children: Array<DtsNodeCst | DtsPropertyCst | DtsDeletePropertyCst | DtsDeleteNodeCst> = [];

    while (!this.check("rbrace") && !this.check("eof")) {
      if (this.isDeleteDirective()) {
        children.push(this.parseDeleteDirective());
      } else if (this.looksLikeNode()) {
        children.push(this.parseNode());
      } else {
        children.push(this.parseProperty());
      }
    }

    const rbrace = this.expect("rbrace");
    let end = rbrace.span.end;
    if (this.check("semi")) {
      end = this.advance().span.end;
    }

    return {
      kind: "node",
      name,
      unitAddress,
      labels,
      refTarget,
      isOverlayRoot,
      children,
      span: { start, end },
    };
  }

  /**
   * Node forms: `&label {`, `/ {`, `name {`, `name@addr {`, `label:name {`, …
   * Property forms: `name = …;`, `name;`, `#address-cells = …;`
   */
  private looksLikeNode(): boolean {
    let offset = 0;
    // Skip labels label:
    while (this.check("ident", offset) && this.check("colon", offset + 1)) {
      offset += 2;
    }
    if (this.check("amp", offset)) return true;
    if (this.check("slash", offset)) return true;
    if (!this.check("ident", offset)) return false;
    offset += 1;
    if (this.check("at", offset)) {
      offset += 1;
      if (this.check("number", offset) || this.check("ident", offset)) {
        offset += 1;
      }
    }
    return this.check("lbrace", offset);
  }

  /** `/delete-node/` and `/delete-property/` are node-body statements, not property values. */
  private isDeleteDirective(): boolean {
    return (
      this.check("directive") &&
      (this.peek().value === "/delete-node/" || this.peek().value === "/delete-property/")
    );
  }

  private parseDeleteDirective(): DtsDeletePropertyCst | DtsDeleteNodeCst {
    const tok = this.advance();
    const nameTok = this.expect("ident", `Expected identifier after ${tok.value}`);
    let unitAddress: string | undefined;
    if (tok.value === "/delete-node/" && this.check("at")) {
      this.advance();
      const addr = this.peek();
      if (addr.kind === "number" || addr.kind === "ident") {
        unitAddress = this.advance().value;
      } else {
        throw new Error(`Expected unit address after @ at ${addr.span.start}`);
      }
    }
    const semi = this.expect("semi", `Expected ';' after ${tok.value} ${nameTok.value}`);
    const span = { start: tok.span.start, end: semi.span.end };
    if (tok.value === "/delete-property/") {
      return { kind: "delete-property", name: nameTok.value, span };
    }
    return { kind: "delete-node", name: nameTok.value, unitAddress, span };
  }

  private parseProperty(): DtsPropertyCst {
    const nameTok = this.expect("ident", "Expected property name");
    const name = nameTok.value;

    if (this.check("eq")) {
      this.advance();
      const { rawText, span } = this.parsePropertyValue();
      this.expect("semi");
      const classified = classifyDtsValue(rawText, name);
      return {
        kind: "property",
        name,
        valueType: classified.valueType,
        value: safeParseDtsValue(name, rawText, classified.valueType),
        rawText,
        normalizedValue: classified.normalizedValue,
        span,
      };
    }

    const semi = this.expect("semi", `Expected ';' after property ${name}`);
    const classified = classifyDtsValue("", name);
    return {
      kind: "property",
      name,
      valueType: classified.valueType,
      value: safeParseDtsValue(name, "", classified.valueType),
      rawText: "",
      normalizedValue: classified.normalizedValue,
      // Span covers the name (presence/empty marker); value body is empty.
      span: { start: nameTok.span.start, end: semi.span.start },
    };
  }

  private parsePropertyValue(): { rawText: string; span: { start: number; end: number } } {
    if (this.check("semi")) {
      const pos = this.peek().span.start;
      return { rawText: "", span: { start: pos, end: pos } };
    }

    const startTok = this.peek();
    let depth = 0;
    let end = startTok.span.end;

    while (!this.check("eof")) {
      if (this.check("semi") && depth === 0) break;
      const tok = this.advance();
      if (tok.kind === "lt") depth += 1;
      if (tok.kind === "gt") depth -= 1;
      end = tok.span.end;
    }

    const rawText = this.source.slice(startTok.span.start, end);
    return { rawText, span: { start: startTok.span.start, end } };
  }
}

export function parseDts(source: string): DtsDocument {
  return new Parser(source).parse();
}

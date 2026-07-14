import { stripDtsComments } from "../parameter-files/preprocess";

export type DtsTokenKind =
  | "ident"
  | "number"
  | "string"
  | "at"
  | "amp"
  | "colon"
  | "lt"
  | "gt"
  | "lbrace"
  | "rbrace"
  | "semi"
  | "comma"
  | "eq"
  | "directive"
  | "slash"
  | "eof";

export interface DtsSpan {
  start: number;
  end: number;
}

export interface DtsToken {
  kind: DtsTokenKind;
  value: string;
  span: DtsSpan;
}

const DIRECTIVES = new Set(["/dts-v1/", "/plugin/", "/include/", "/bits/", "/delete-node/", "/delete-property/", "/omit-if-no-ref/"]);

function isNameStart(ch: string): boolean {
  return /[A-Za-z_#]/.test(ch);
}

function isNameContinue(ch: string): boolean {
  return /[A-Za-z0-9_,.+#-]/.test(ch);
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

function isHexDigit(ch: string): boolean {
  return /[0-9A-Fa-f]/.test(ch);
}

/** Lex DTS source into a token stream. Comments are stripped first (length-preserving). */
export function lexDts(source: string): DtsToken[] {
  const text = stripDtsComments(source);
  const tokens: DtsToken[] = [];
  let i = 0;

  const push = (kind: DtsTokenKind, start: number, end: number, value = text.slice(start, end)) => {
    tokens.push({ kind, value, span: { start, end } });
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    if (ch === "/") {
      // Try directive: /name/
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_-]/.test(text[j])) {
        j += 1;
      }
      if (j > i + 1 && text[j] === "/") {
        const value = text.slice(i, j + 1);
        if (DIRECTIVES.has(value) || /^\/[A-Za-z0-9_-]+\//.test(value)) {
          push("directive", i, j + 1, value);
          i = j + 1;
          continue;
        }
      }
      // Bare root slash
      push("slash", i, i + 1, "/");
      i += 1;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      push("string", i, j);
      i = j;
      continue;
    }

    if (ch === "0" && (text[i + 1] === "x" || text[i + 1] === "X")) {
      let j = i + 2;
      while (j < text.length && isHexDigit(text[j])) {
        j += 1;
      }
      push("number", i, j);
      i = j;
      continue;
    }

    // Digits, or bare hex unit-address tokens like 6E / 77 (may include A-F).
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < text.length && isHexDigit(text[j])) {
        j += 1;
      }
      // Stop before name-continuation that is not hex (rare); keep hex run as number.
      push("number", i, j);
      i = j;
      continue;
    }

    if (isNameStart(ch)) {
      let j = i + 1;
      while (j < text.length && isNameContinue(text[j])) {
        j += 1;
      }
      push("ident", i, j);
      i = j;
      continue;
    }

    const single: Record<string, DtsTokenKind> = {
      "@": "at",
      "&": "amp",
      ":": "colon",
      "<": "lt",
      ">": "gt",
      "{": "lbrace",
      "}": "rbrace",
      ";": "semi",
      ",": "comma",
      "=": "eq",
    };

    if (ch in single) {
      push(single[ch], i, i + 1, ch);
      i += 1;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at offset ${i}`);
  }

  tokens.push({ kind: "eof", value: "", span: { start: text.length, end: text.length } });
  return tokens;
}

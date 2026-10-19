import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { foldService, StreamLanguage } from "@codemirror/language";
import type { DtsEditorFold } from "./dtsEditorFolds";

/** Presentation only. DTS acceptance remains owned by the server/toolchain. */
export const dtsEditorLanguage = StreamLanguage.define({
  name: "dts",
  startState: () => ({ comment: false, quote: "", depth: 0 }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo("*/")) { stream.match("*/"); state.comment = false; }
      else stream.skipToEnd();
      return "comment";
    }
    if (state.quote) {
      const quote = state.quote;
      while (!stream.eol()) {
        const char = stream.next();
        if (char === "\\") stream.next();
        else if (char === quote) { state.quote = ""; break; }
      }
      return quote === "'" ? "character" : "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match("/*")) { state.comment = true; return "comment"; }
    if (stream.peek() === '"' || stream.peek() === "'") {
      state.quote = stream.next() as string;
      return state.quote === "'" ? "character" : "string";
    }
    if (stream.match(/^\/[\w-]+\//) || stream.match(/^#[\w-]+/)) return "keyword";
    if (stream.match(/^&(?:\{[^}]*\}|[\w.-]+)/)) return "variableName.special";
    if (stream.match(/^[\w.,+?#-]+(?=\s*:)/)) return "labelName";
    if (stream.match(/^-?(?:0[xX][\da-fA-F]+|\d+)(?:[uUlL]+)?\b/)) return "number";
    if (stream.match(/^[\w.,+?#-]+/)) return "propertyName";
    const char = stream.next();
    if (char === "{") state.depth += 1;
    if (char === "}") state.depth = Math.max(0, state.depth - 1);
    return "punctuation";
  },
  indent: (state, textAfter, context) => Math.max(0, state.depth - (/^\s*}/.test(textAfter) ? 1 : 0)) * context.unit,
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } }
});

export const setDtsEditorFolds = StateEffect.define<readonly DtsEditorFold[]>();

const dtsFolds = StateField.define<readonly DtsEditorFold[]>({
  create: () => [],
  update(ranges, transaction) {
    if (transaction.docChanged) {
      // An edited pair waits for fresh analysis; never fold a stale or deleted node.
      ranges = ranges.filter((range) => !transaction.changes.touchesRange(range.from - 1, range.to + 1))
        .map((range) => ({ from: transaction.changes.mapPos(range.from), to: transaction.changes.mapPos(range.to) }));
    }
    for (const effect of transaction.effects) if (effect.is(setDtsEditorFolds)) ranges = effect.value;
    return ranges;
  }
});

export const dtsEditorFolding: Extension = [
  dtsFolds,
  foldService.of((state, lineStart, lineEnd) => {
    const ranges = state.field(dtsFolds);
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges[middle].from <= lineStart) low = middle + 1;
      else high = middle;
    }
    const range = ranges[low];
    return range && range.from <= lineEnd && range.to > lineEnd ? range : null;
  })
];

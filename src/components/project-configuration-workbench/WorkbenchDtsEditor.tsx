import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { ChangeSet, Compartment, EditorState, MapMode, StateEffect, StateField, type ChangeDesc, type Extension, type Text } from "@codemirror/state";
import {
  Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter,
  keymap, lineNumbers, type DecorationSet
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, foldGutter, foldKeymap, foldedRanges, indentOnInput, syntaxHighlighting, unfoldEffect } from "@codemirror/language";
import { SearchQuery, closeSearchPanel, findNext, getSearchQuery, openSearchPanel, search, searchKeymap, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import type { DtsViewerFocusSpan } from "@/components/parameter-topology/ProjectPrimaryDtsViewer";
import { dtsEditorFolding, dtsEditorLanguage, setDtsEditorFolds } from "./dtsEditorLanguage";
import { collectDtsEditorFolds, type DtsEditorFold } from "./dtsEditorFolds";
import "./WorkbenchDtsEditor.css";

export type WorkbenchDtsEditorMeta = { sessionKey: string; generation: number; dirty: boolean };
export type WorkbenchDtsEditorSnapshot = WorkbenchDtsEditorMeta & {
  text: string;
  selection: { anchor: number; head: number };
  firstVisibleLine: number;
  normalizedLineEndings: boolean;
};
export type WorkbenchDtsEditorHandle = {
  getSnapshot(): WorkbenchDtsEditorSnapshot | null;
  flush(): WorkbenchDtsEditorSnapshot | null;
  focus(): void;
  revealLine(line: number, column?: number): void;
  openSearch(): void;
};
export type WorkbenchDtsEditorProps = {
  sessionKey: string;
  /** Initial/recovered source. An existing session changes only when resetKey changes. */
  text: string;
  /** Authoritative source for dirty comparison when text restores a local draft. */
  baseText?: string;
  /** Opt in to acknowledging a newly saved authoritative baseline without resetting the editor. */
  baselineRevision?: string | number;
  sessions?: WorkbenchDtsEditorSessions;
  initialSelection?: { anchor: number; head: number };
  initialVisibleLine?: number;
  resetKey?: string | number;
  readOnly: boolean;
  ariaLabel?: string;
  className?: string;
  focusSpan?: DtsViewerFocusSpan | null;
  focusLine?: number | null;
  findQuery?: string;
  findNextToken?: number;
  onVisibleLineChange?: (line: number) => void;
  onDirtyChange?: (meta: WorkbenchDtsEditorMeta) => void;
  onChange?: (snapshot: WorkbenchDtsEditorSnapshot) => void;
  onSave?: (snapshot: WorkbenchDtsEditorSnapshot) => void;
};

type EditorSession = {
  key: string;
  resetKey?: string | number;
  state: EditorState;
  initialDoc: Text;
  initialText: string;
  base: Text;
  baselineRevision?: string | number;
  changes: ChangeDesc;
  generation: number;
  lineSeparator: string;
  normalizedLineEndings: boolean;
  scrollTop: number;
  scrollLeft: number;
  mode: Compartment;
  attributes: Compartment;
  runtime: Compartment;
};

export type WorkbenchDtsEditorSessions = Map<string, EditorSession>;

const focusedRange = StateEffect.define<{ from: number; to: number } | null>();
const focusDecoration = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(focusedRange)) value = effect.value && effect.value.to > effect.value.from
        ? Decoration.set([Decoration.mark({ class: "workbench-dts-editor__focused-range", attributes: { "data-focused": "true" } }).range(effect.value.from, effect.value.to)])
        : Decoration.none;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const highlighting = HighlightStyle.define([
  { tag: tags.comment, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: [tags.string, tags.character], color: "var(--success)" },
  { tag: [tags.number, tags.special(tags.variableName)], color: "var(--info)" },
  { tag: [tags.keyword, tags.labelName], color: "var(--accent)" },
  { tag: tags.propertyName, color: "var(--configuration-source-text)" }
]);

const phrases = {
  "Find": "查找", "Replace": "替换", "next": "下一处", "previous": "上一处", "all": "全部",
  "match case": "区分大小写", "regexp": "正则表达式", "by word": "整词匹配", "replace": "替换",
  "replace all": "全部替换", "close": "关闭", "Go to line": "跳转到行", "go": "跳转",
  "folded code": "已折叠源码", "unfold": "展开", "Fold line": "折叠此行", "Unfold line": "展开此行"
};

function linePosition(doc: Text, line: number, column = 1) {
  const target = doc.line(Math.max(1, Math.min(doc.lines, line)));
  return Math.min(target.to, target.from + Math.max(0, column - 1));
}

function visibleLine(editor: EditorView) {
  return editor.state.doc.lineAt(editor.lineBlockAtHeight(editor.scrollDOM.scrollTop).from).number;
}

function initialChanges(before: Text, after: Text): ChangeDesc {
  if (before.eq(after)) return ChangeSet.empty(before.length);
  const left = before.toString();
  const right = after.toString();
  let from = 0;
  let commonEnd = 0;
  while (from < Math.min(left.length, right.length) && left[from] === right[from]) from += 1;
  while (commonEnd < Math.min(left.length, right.length) - from && left[left.length - commonEnd - 1] === right[right.length - commonEnd - 1]) commonEnd += 1;
  // ponytail: restored drafts use one conservative changed span; draft semantic ranges can refine navigation later.
  return ChangeSet.of({ from, to: left.length - commonEnd, insert: right.slice(from, right.length - commonEnd) }, left.length);
}

export const WorkbenchDtsEditor = forwardRef<WorkbenchDtsEditorHandle, WorkbenchDtsEditorProps>(function WorkbenchDtsEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  const view = useRef<EditorView | null>(null);
  const localSessions = useRef<WorkbenchDtsEditorSessions>(new Map());
  const active = useRef<EditorSession | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const worker = useRef<Worker | null>(null);
  const analysisId = useRef(0);
  const lastFindToken = useRef(props.findNextToken);

  useLayoutEffect(() => { callbacks.current = props; });

  const getSnapshot = useCallback((): WorkbenchDtsEditorSnapshot | null => {
    const editor = view.current;
    const session = active.current;
    if (!editor || !session) return null;
    const unchanged = editor.state.doc.eq(session.initialDoc);
    const text = unchanged ? session.initialText : editor.state.doc.toString();
    const selection = editor.state.selection.main;
    const firstVisibleLine = visibleLine(editor);
    return {
      sessionKey: session.key, generation: session.generation, dirty: !editor.state.doc.eq(session.base),
      text: unchanged || session.lineSeparator === "\n" ? text : text.replace(/\n/g, session.lineSeparator),
      selection: { anchor: selection.anchor, head: selection.head }, firstVisibleLine,
      normalizedLineEndings: !unchanged && session.normalizedLineEndings
    };
  }, []);

  const flush = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    const snapshot = getSnapshot();
    if (snapshot) callbacks.current.onChange?.(snapshot);
    return snapshot;
  }, [getSnapshot]);

  const analyze = useCallback(() => {
    const editor = view.current;
    const session = active.current;
    if (!editor || !session) return;
    const text = editor.state.doc.toString();
    analysisId.current += 1;
    if (worker.current) worker.current.postMessage({ sessionKey: session.key, generation: session.generation, analysisId: analysisId.current, text });
    // ponytail: without Worker, the bounded file is scanned only after a pause; use idle chunks if that fallback becomes slow.
    else editor.dispatch({ effects: setDtsEditorFolds.of(collectDtsEditorFolds(text)) });
  }, []);

  const revealRange = useCallback((from: number, to: number) => {
    const editor = view.current;
    if (!editor) return;
    const effects: StateEffect<unknown>[] = [focusedRange.of({ from, to }), EditorView.scrollIntoView(from, { y: "center" })];
    foldedRanges(editor.state).between(from, from, (start, end) => {
      if (start < from && end > from) effects.push(unfoldEffect.of({ from: start, to: end }));
    });
    editor.dispatch({ effects });
  }, []);

  const revealLine = useCallback((line: number, column = 1) => {
    const editor = view.current;
    if (!editor) return;
    const pos = linePosition(editor.state.doc, line, column);
    revealRange(pos, editor.state.doc.lineAt(pos).to);
  }, [revealRange]);

  const runtimeExtensions = useCallback((): Extension => [
    EditorView.domEventHandlers({
      blur: () => { flush(); },
      paste: (_event, target) => target.state.readOnly,
      drop: (_event, target) => target.state.readOnly,
      scroll: (_event, target) => { callbacks.current.onVisibleLineChange?.(visibleLine(target)); }
    }),
    EditorView.updateListener.of((update) => {
      const current = active.current;
      if (!current) return;
      current.state = update.state;
      if (update.docChanged) {
        current.changes = current.changes.composeDesc(update.changes);
        current.generation += 1;
        callbacks.current.onDirtyChange?.({ sessionKey: current.key, generation: current.generation, dirty: !update.state.doc.eq(current.base) });
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; flush(); analyze(); }, 350);
      }
    })
  ], [flush, analyze]);

  useImperativeHandle(ref, () => ({
    getSnapshot, flush, revealLine,
    focus: () => view.current?.focus(),
    openSearch: () => { if (view.current) openSearchPanel(view.current); }
  }));

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    try {
      if (typeof Worker !== "undefined") worker.current = new Worker(new URL("./dtsEditorFolding.worker.ts", import.meta.url), { type: "module" });
    } catch { worker.current = null; }
    if (worker.current) {
      worker.current.onmessage = (event: MessageEvent<{ sessionKey: string; generation: number; analysisId: number; folds: DtsEditorFold[] }>) => {
        const session = active.current;
        if (session?.key === event.data.sessionKey && session.generation === event.data.generation && analysisId.current === event.data.analysisId) {
          view.current?.dispatch({ effects: setDtsEditorFolds.of(event.data.folds) });
        }
      };
      worker.current.onerror = () => { worker.current?.terminate(); worker.current = null; };
    }
    const editor = new EditorView({ parent: element });
    view.current = editor;
    const saveKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      const snapshot = flush();
      if (snapshot && !editor.state.readOnly) callbacks.current.onSave?.(snapshot);
    };
    element.addEventListener("keydown", saveKeyDown, true);
    return () => {
      flush();
      if (active.current) {
        active.current.state = editor.state;
        active.current.scrollTop = editor.scrollDOM.scrollTop;
        active.current.scrollLeft = editor.scrollDOM.scrollLeft;
      }
      element.removeEventListener("keydown", saveKeyDown, true);
      editor.destroy();
      view.current = null;
      active.current = null;
      worker.current?.terminate();
      worker.current = null;
    };
  }, [flush]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const previous = active.current;
    if (previous) {
      // A same-file reset is an explicit recovery/discard decision by the owner.
      // Replaying the old buffer here would overwrite that newly chosen document.
      if (previous.key !== props.sessionKey || previous.resetKey === props.resetKey) flush();
      else if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
      previous.state = editor.state;
      previous.scrollTop = editor.scrollDOM.scrollTop;
      previous.scrollLeft = editor.scrollDOM.scrollLeft;
    }
    const sessions = props.sessions ?? localSessions.current;
    let session = sessions.get(props.sessionKey);
    let restoreLine: number | undefined;
    if (!session || session.resetKey !== props.resetKey) {
      const initial = callbacks.current;
      const mode = new Compartment();
      const attributes = new Compartment();
      const runtime = new Compartment();
      const separators = new Set(initial.text.match(/\r\n|\r|\n/g));
      const lineSeparator = separators.size === 1 ? [...separators][0] : "\n";
      let initialState = EditorState.create({
        doc: initial.text,
        extensions: [
          mode.of([EditorState.readOnly.of(initial.readOnly), EditorView.editable.of(true)]),
          attributes.of(EditorView.contentAttributes.of({ "aria-label": initial.ariaLabel ?? "DTS 源码", "aria-readonly": String(initial.readOnly), tabindex: "0", spellcheck: "false" })),
          // Read-only applies to every document transaction, not just keyboard commands.
          EditorState.changeFilter.of((transaction) => !transaction.startState.readOnly),
          EditorState.phrases.of(phrases),
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(),
          dtsEditorLanguage, dtsEditorFolding, foldGutter(), bracketMatching(), indentOnInput(), syntaxHighlighting(highlighting),
          focusDecoration, search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
          runtime.of(runtimeExtensions())
        ]
      });
      if (initial.initialSelection) {
        const clamp = (position: number) => Math.max(0, Math.min(initialState.doc.length, position));
        initialState = initialState.update({ selection: { anchor: clamp(initial.initialSelection.anchor), head: clamp(initial.initialSelection.head) } }).state;
      }
      restoreLine = initial.initialVisibleLine;
      const base = initial.baseText === undefined ? initialState.doc : EditorState.create({ doc: initial.baseText }).doc;
      session = {
        key: props.sessionKey, resetKey: props.resetKey, state: initialState, initialDoc: initialState.doc, initialText: initial.text, base, baselineRevision:initial.baselineRevision,
        changes: initialChanges(base, initialState.doc), generation: 0, lineSeparator,
        normalizedLineEndings: separators.size > 1, scrollTop: 0, scrollLeft: 0, mode, attributes, runtime
      };
      sessions.set(props.sessionKey, session);
    } else {
      session.state = session.state.update({ effects: session.runtime.reconfigure(runtimeExtensions()) }).state;
    }
    active.current = session;
    editor.setState(session.state);
    editor.scrollDOM.scrollTop = session.scrollTop;
    editor.scrollDOM.scrollLeft = session.scrollLeft;
    if (restoreLine && restoreLine > 1) editor.dispatch({ effects: EditorView.scrollIntoView(linePosition(editor.state.doc, restoreLine), { y: "start" }) });
    analyze();
    callbacks.current.onDirtyChange?.({ sessionKey: session.key, generation: session.generation, dirty: !session.state.doc.eq(session.base) });
  }, [props.sessionKey, props.resetKey, props.sessions, flush, analyze, runtimeExtensions]);

  useLayoutEffect(() => {
    const session=active.current, editor=view.current;
    if(!session || !editor || props.baselineRevision===undefined || props.baselineRevision===session.baselineRevision || props.baseText===undefined)return;
    session.baselineRevision=props.baselineRevision;
    session.base=EditorState.create({doc:props.baseText}).doc;
    session.changes=initialChanges(session.base,editor.state.doc);
    callbacks.current.onDirtyChange?.({sessionKey:session.key,generation:session.generation,dirty:!editor.state.doc.eq(session.base)});
  },[props.sessionKey,props.resetKey,props.baselineRevision,props.baseText]);

  useLayoutEffect(() => {
    const editor = view.current;
    const session = active.current;
    if (!editor || !session) return;
    const searchWasOpen = searchPanelOpen(editor.state);
    if (searchWasOpen) closeSearchPanel(editor);
    editor.dispatch({ effects: [
      session.mode.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(true)]),
      session.attributes.reconfigure(EditorView.contentAttributes.of({ "aria-label": props.ariaLabel ?? "DTS 源码", "aria-readonly": String(props.readOnly), tabindex: "0", spellcheck: "false" }))
    ] });
    if (searchWasOpen) openSearchPanel(editor);
  }, [props.readOnly, props.ariaLabel, props.sessionKey, props.resetKey, props.sessions]);

  const focusLine = props.focusSpan ? null : props.focusLine;
  useLayoutEffect(() => {
    const editor = view.current;
    const session = active.current;
    const span = props.focusSpan;
    const line = span?.startLine ?? focusLine;
    if (!editor || !session) return;
    if (!line || line < 1 || line > session.base.lines) { editor.dispatch({ effects: focusedRange.of(null) }); return; }
    const baseFrom = linePosition(session.base, line, span?.startColumn);
    const baseTo = span ? linePosition(session.base, span.endLine, span.endColumn ?? session.base.line(Math.min(session.base.lines, span.endLine)).length + 1)
      : session.base.line(line).to;
    const from = session.changes.mapPos(baseFrom, 1, MapMode.TrackAfter);
    const to = session.changes.mapPos(baseTo, -1, MapMode.TrackBefore);
    if (from === null || to === null || to < from) { editor.dispatch({ effects: focusedRange.of(null) }); return; }
    revealRange(from, to);
  }, [props.focusSpan, focusLine, props.sessionKey, props.resetKey, props.sessions, revealRange]);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor || props.findQuery === undefined) return;
    const query = new SearchQuery({ search: props.findQuery, literal: true, caseSensitive: true });
    if (getSearchQuery(editor.state).eq(query)) return;
    // Navigation search lists results first. A selected result or explicit next
    // command owns scrolling, so updating highlights must not move the source.
    editor.dispatch({ effects: setSearchQuery.of(query) });
  }, [props.findQuery, props.sessionKey, props.resetKey, props.sessions]);

  useLayoutEffect(() => {
    if (props.findNextToken !== lastFindToken.current && view.current) findNext(view.current);
    lastFindToken.current = props.findNextToken;
  }, [props.findNextToken]);

  return <div ref={host} className={`workbench-dts-editor${props.className ? ` ${props.className}` : ""}`} data-testid="workbench-dts-editor" />;
});

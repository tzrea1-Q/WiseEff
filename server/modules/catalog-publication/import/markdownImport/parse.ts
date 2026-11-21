import type { Definition, Subject, SubjectKind, SyntaxDiagnostic, SyntaxTree } from "./types";

type TableState = "header" | "separator" | "rows" | "body";

/** Parse only document syntax. Catalog resolution and content rules are separate stages. */
export function parseMarkdown(document: string): SyntaxTree {
  const subjects: Subject[] = [];
  const diagnostics: SyntaxDiagnostic[] = [];
  let subject: Subject | undefined;
  let definition: Definition | undefined;
  let state: TableState = "header";
  let body: string[] = [];
  let fence = "";
  let dtsSection: { line: number; lines: { text: string; line: number }[] } | undefined;

  const problem = (field: string, message: string, line: number) => {
    diagnostics.push({
      subjectHeading: subject?.heading ?? "",
      definitionHeading: definition?.heading ?? "",
      field,
      message,
      line,
      ...(subject ? { subjectLine: subject.line } : {}),
      ...(definition ? { definitionLine: definition.line } : {}),
    });
  };
  const finishDtsSection = () => {
    if (!dtsSection || !definition) return;
    const { line, lines } = dtsSection;
    dtsSection = undefined;
    const blocks: NonNullable<Definition["dtsExamples"]>["blocks"] = [];
    const nonblank = lines.filter((item) => item.text.trim());
    const clearLine = nonblank.length === 1 && /^[ \t]*-[ \t]*$/u.test(nonblank[0]!.text) ? nonblank[0]!.line : undefined;
    let open: { fence: string; line: number; content: string[]; dts: boolean } | undefined;
    for (const item of clearLine ? [] : lines) {
      if (open) {
        if (closesFence(item.text, open.fence)) {
          if (open.dts) blocks.push({ text: open.content.join("\n"), line: open.line,
            contentLine: open.line + Math.max(0, open.content.findIndex((text) => text.trim()) + 1) });
          open = undefined;
        } else open.content.push(item.text);
        continue;
      }
      const match = /^[ \t]*(`{3,}|~{3,})([^\r]*)$/u.exec(item.text);
      if (match) {
        open = { fence: match[1]!, line: item.line, content: [], dts: match[2]!.trim() === "dts" };
        if (!open.dts) problem("DTS 示例", "DTS 示例代码围栏的语言须为 dts。", item.line);
      } else if (item.text.trim()) problem("DTS 示例", "DTS 示例区只能填写 dts 代码块，清空时只写一行 -。", item.line);
    }
    if (open) problem("DTS 示例", "DTS 示例代码围栏未闭合。", open.line);
    if (!nonblank.length) problem("DTS 示例", "请至少填写一个 dts 代码块。", line);
    definition.dtsExamples ??= { line, blocks, ...(clearLine !== undefined ? { clearLine } : {}) };
  };
  const finish = () => {
    if (!definition) return;
    finishDtsSection();
    if (state === "header" || state === "separator") {
      problem("字段表", "请按模板填写字段表及表头分隔行。", definition.line);
    }
    definition.documentation = body.join("\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/gu, "");
    definition = undefined;
    body = [];
    fence = "";
  };
  const beginBody = (text: string, line: number) => {
    if (dtsSection && /^ {0,3}#{1,3}(?:[ \t]|$)/u.test(text)) finishDtsSection();
    if (text === "### DTS 示例") {
      if (definition?.dtsExamples) problem("DTS 示例", "每条定义只能填写一个 DTS 示例区。", line);
      dtsSection = { line, lines: [] };
      return;
    }
    if (dtsSection) {
      dtsSection.lines.push({ text, line });
      fence = /^[ \t]*(`{3,}|~{3,})([^\r]*)$/u.exec(text)?.[1] ?? "";
      return;
    }
    body.push(text);
    if (definition && text.trim() && definition.documentationLine === undefined) {
      definition.documentationLine = line;
    }
    fence = /^\s*(`{3,}|~{3,})/u.exec(text)?.[1] ?? "";
  };

  for (const [index, text] of document.replace(/\r\n/gu, "\n").split("\n").entries()) {
    const line = index + 1;
    // Downloaded guides are visible blockquotes before the data; body quotes remain definition content.
    if (!subject && /^>($|\s)/u.test(text)) continue;
    if (fence && definition) {
      if (dtsSection) dtsSection.lines.push({ text, line });
      else body.push(text);
      if (closesFence(text, fence)) fence = "";
      continue;
    }
    if (/^#\s/u.test(text)) {
      finish();
      const match = /^# (Driver|NodeType|ConfigurationSchema) `([^`]+)`\s*$/u.exec(text);
      const kinds: Record<string, SubjectKind> = {
        Driver: "driver", NodeType: "node-type", ConfigurationSchema: "configuration-schema",
      };
      subject = {
        heading: text, line, kind: match ? kinds[match[1]] : null,
        selector: match?.[2] ?? "", metadataLines: [], definitions: [],
      };
      subjects.push(subject);
      if (!match) problem("主体", "主体标题格式无效。", line);
      continue;
    }
    if (/^##\s/u.test(text)) {
      finish();
      if (!subject) {
        subject = { heading: "", line, kind: null, selector: "", metadataLines: [], definitions: [] };
        subjects.push(subject);
      }
      const match = /^## `([^`]+)`\s+(.+?)\s*$/u.exec(text);
      definition = {
        heading: text, line, propertyKey: match?.[1] ?? "", displayName: match?.[2] ?? "",
        fields: [], documentation: "",
      };
      subject.definitions.push(definition);
      state = "header";
      if (!match || !subject.heading) problem("标题", "定义标题格式无效或缺少主体标题。", line);
      continue;
    }
    if (!definition) {
      if (text.trim() && subject) subject.metadataLines.push({ text, line });
      else if (text.trim()) problem("文档", "主体标题之前不能包含内容。", line);
      continue;
    }
    if (state === "body") {
      beginBody(text, line);
      continue;
    }
    if (state === "header" && !text.trim()) continue;
    if (state === "header" && !/^\|\s*字段\s*\|\s*值\s*\|\s*$/u.test(text.trim())) {
      problem("字段表", "定义标题后必须先填写字段表。", line);
      state = "body";
      beginBody(text, line);
      continue;
    }
    if (state === "rows" && !text.trim().startsWith("|")) {
      state = "body";
      beginBody(text, line);
      continue;
    }
    const cells = /^\|\s*((?:\\.|[^|\\])*?)\s*\|\s*((?:\\.|[^|\\])*?)\s*\|\s*$/u.exec(text.trim());
    if (!cells) {
      problem("字段表", "字段表格式无效。", line);
      continue;
    }
    const [, name, value] = cells;
    if (state === "header") {
      state = "separator";
    } else if (state === "separator") {
      if (/^:?-{3,}:?$/u.test(name) && /^:?-{3,}:?$/u.test(value)) state = "rows";
      else problem("字段表", "请按模板填写字段表头。", line);
    } else {
      definition.fields.push({ name,
        value: value === "\\-" ? "-" : value.replace(/\\\\|\\\|/gu, (escape) => escape.slice(1)),
        ...(value === "\\-" ? { literalDash: true } : {}), line });
    }
  }
  finish();
  return { subjects, diagnostics };
}

function closesFence(text: string, fence: string): boolean {
  return new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`, "u").test(text);
}

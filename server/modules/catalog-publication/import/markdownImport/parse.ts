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
  const finish = () => {
    if (!definition) return;
    if (state === "header" || state === "separator") {
      problem("字段表", "请按模板填写字段表及表头分隔行。", definition.line);
    }
    definition.documentation = body.join("\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/gu, "");
    definition = undefined;
    body = [];
    fence = "";
  };
  const beginBody = (text: string, line: number) => {
    body.push(text);
    if (definition && text.trim() && definition.documentationLine === undefined) {
      definition.documentationLine = line;
    }
    fence = /^\s*(`{3,}|~{3,})/u.exec(text)?.[1] ?? "";
  };

  for (const [index, text] of document.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const line = index + 1;
    // Downloaded guides are visible blockquotes before the data; body quotes remain definition content.
    if (!subject && /^>($|\s)/u.test(text)) continue;
    if (fence && definition) {
      body.push(text);
      if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`, "u").test(text)) fence = "";
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

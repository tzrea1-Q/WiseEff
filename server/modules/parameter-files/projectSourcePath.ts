import posixPath from "node:path/posix";
import { ApiError } from "../../shared/http/errors";
import { lexDts } from "../dts";
import { resolveIncludeTarget } from "../dts/configSetResolver";
import { inspectDtsCppIncludeArguments, inspectDtsCppIncludes, requiresDtsPreprocessing } from "../dts/cppSources";
import { stripDtsComments } from "../dts/preprocess";

type Files = Map<string, { content: string; fileVersionId: string }>;
type Reference = { sourceName: string; target: string; line: number; column: number };

export function retargetProjectIncludes(
  input: { entryFile: string; includeSearchPaths: string[]; overlayOrder: string[]; defines: Record<string, string>; files: Files },
  from: string, to: string, sharedNames: ReadonlySet<string>
) {
  const rename = (name: string) => name === from ? to : name;
  const references: Reference[] = [];
  const affected = new Map<string, Array<{ start: number; end: number; text: string }>>();
  const files: Files = new Map([...input.files].map(([name, file]) => [rename(name), file]));
  const cpp = requiresDtsPreprocessing(input.files, input.defines);
  const refusal = (reference: Reference, message: string): never => {
    throw new ApiError("CONFLICT", message, { diagnostics: [{ ...reference, severity: "error", code: "include-path-correction", message }] });
  };
  const rewrite = (reference: Reference, span?: { start: number; end: number }) => {
    if (!span || sharedNames.has(reference.sourceName)) {
      refusal(reference, "无法安全改写此 include。请先在其所有者的源码中修正引用，再重新预览。");
    }
    const edits = affected.get(reference.sourceName) ?? [];
    const { start, end } = span!;
    const literal = JSON.stringify(posixPath.relative(posixPath.dirname(rename(reference.sourceName)), rename(reference.target)));
    const splices = cpp ? input.files.get(reference.sourceName)!.content.slice(start, end).match(/\\\r?\n/gu) : null;
    edits.push({ start, end, text: splices ? `"${splices.join("")}${literal.slice(1)}` : literal });
    affected.set(reference.sourceName, edits);
    references.push(reference);
  };
  const cppEdges = cpp ? inspectDtsCppIncludeArguments(input) : [];
  if (cpp) {
    for (const { argumentSpan, ...edge } of cppEdges) {
      if (edge.target !== from && posixPath.dirname(rename(edge.sourceName)) === posixPath.dirname(edge.sourceName)) continue;
      rewrite(edge, argumentSpan);
    }
  } else {
    for (const [sourceName, file] of input.files) {
      const tokens = lexDts(stripDtsComments(file.content));
      for (const [index, directive] of tokens.entries()) {
        const argument = tokens[index + 1];
        if (directive.kind !== "directive" || directive.value !== "/include/" || argument?.kind !== "string") continue;
        const path = argument.value.slice(1, -1);
        const prior = resolveIncludeTarget(sourceName, path, input.includeSearchPaths, input.files);
        const updated = resolveIncludeTarget(rename(sourceName), path, input.includeSearchPaths, files);
        const prefix = file.content.slice(0, directive.span.start);
        const location = { sourceName, target: prior.ok ? prior.fileName : path, line: prefix.split("\n").length, column: prefix.length - prefix.lastIndexOf("\n") };
        if (!prior.ok) refusal(location, "当前 include 无法解析，请修正引用后重新预览。");
        if (!updated.ok || updated.fileName !== rename(location.target)) rewrite(location, argument.span);
      }
    }
  }
  for (const [name, edits] of affected) {
    const file = files.get(rename(name))!;
    let content = file.content;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
    }
    files.set(rename(name), { ...file, content });
  }
  if (cpp) {
    const next = inspectDtsCppIncludes({ ...input, files, entryFile: rename(input.entryFile), overlayOrder: input.overlayOrder.map(rename) });
    const byLocation = new Map(next.map(edge => [JSON.stringify([edge.sourceName, edge.line, edge.column]), edge.target]));
    for (const { argumentSpan: _span, ...edge } of cppEdges) {
      if (byLocation.get(JSON.stringify([rename(edge.sourceName), edge.line, edge.column])) !== rename(edge.target)) {
        refusal(edge, "新路径改变了 include 的解析目标，请选择其他路径。");
      }
    }
  }
  return { files, references };
}

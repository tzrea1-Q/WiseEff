import type { ReactNode } from "react";
import { renderMarkdownPreview } from "@/domain/knowledge/markdown";
import "./definition-documentation.css";

export function DefinitionDocumentation({ documentation, empty = null, className }: {
  documentation: string | null | undefined;
  empty?: ReactNode;
  className?: string;
}) {
  if (!documentation?.trim()) return empty;

  return <div className={className ? `definition-documentation ${className}` : "definition-documentation"}
    dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(documentation) }} />;
}

/** Collapse Markdown documentation into one plain-text line for clamped list previews. */
export function definitionDocumentationExcerpt(documentation: string | null | undefined): string {
  return (documentation ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*`{3,}/.test(line) && !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line))
    .map((line) => line
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+)/, "")
      .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g, (_match, bold, italic, code) => bold ?? italic ?? code)
      .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
      .replace(/^\s*\||\|\s*$/g, "")
      .replace(/\s*\|\s*/g, " · "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

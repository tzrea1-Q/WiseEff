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

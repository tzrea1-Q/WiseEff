import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  isValidElement,
  useState
} from "react";
import { Check, Copy } from "lucide-react";

type StreamdownNodeProps<T extends "table" | "th" | "td" | "pre"> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
  children?: ReactNode;
};

function extractTextContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.props && "children" in node.props) {
    return extractTextContent(node.props.children);
  }
  return "";
}

function XiaozeMdPre({ children, className, ...props }: StreamdownNodeProps<"pre">) {
  const [copied, setCopied] = useState(false);

  // Extract language from first code child if available
  const firstChild = isValidElement<{ className?: string }>(children)
    ? children
    : Array.isArray(children) && isValidElement<{ className?: string }>(children[0])
      ? children[0]
      : null;
  const langMatch = firstChild?.props?.className?.match(/language-([a-zA-Z0-9_-]+)/);
  const language = langMatch ? langMatch[1] : "";

  const handleCopy = () => {
    const text = extractTextContent(children);
    if (!text) return;

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  return (
    <div className="xiaoze-code-block" data-testid="xiaoze-code-block">
      <div className="xiaoze-code-block__header">
        <span className="xiaoze-code-block__lang">{language || "代码"}</span>
        <button
          type="button"
          className="xiaoze-code-block__copy"
          onClick={handleCopy}
          aria-label={copied ? "已复制" : "复制代码"}
          title={copied ? "已复制" : "复制代码"}
        >
          {copied ? (
            <>
              <Check size={12} aria-hidden="true" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} aria-hidden="true" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className={className} {...props}>
        {children}
      </pre>
    </div>
  );
}

function XiaozeMdTable({ children, className: _className, style, ...props }: StreamdownNodeProps<"table">) {
  return (
    <div className="xiaoze-md-table-wrapper" data-streamdown="table-wrapper">
      <table
        className="xiaoze-md-table"
        data-streamdown="table"
        style={{ width: "100%", minWidth: 0, ...style }}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

function XiaozeMdTh({ children, className: _className, style, ...props }: StreamdownNodeProps<"th">) {
  return (
    <th
      className="xiaoze-md-table__header"
      data-streamdown="table-header-cell"
      style={{ whiteSpace: "normal", ...style }}
      {...props}
    >
      {children}
    </th>
  );
}

function XiaozeMdTd({ children, className: _className, style, ...props }: StreamdownNodeProps<"td">) {
  return (
    <td
      className="xiaoze-md-table__cell"
      data-streamdown="table-cell"
      style={{ whiteSpace: "normal", wordBreak: "break-word", ...style }}
      {...props}
    >
      {children}
    </td>
  );
}

export const xiaozeStreamdownComponents = {
  table: XiaozeMdTable,
  th: XiaozeMdTh,
  td: XiaozeMdTd,
  pre: XiaozeMdPre
};

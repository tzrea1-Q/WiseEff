import type { ComponentPropsWithoutRef, ReactNode } from "react";

type StreamdownNodeProps<T extends keyof HTMLElementTagNameMap> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
  children?: ReactNode;
};

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
  td: XiaozeMdTd
};

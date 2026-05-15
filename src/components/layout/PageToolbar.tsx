import type { ReactNode } from "react";

export type PageToolbarProps = {
  ariaLabel: string;
  leading?: ReactNode;
  filters?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

export function PageToolbar({ ariaLabel, leading, filters, trailing, className }: PageToolbarProps) {
  const classes = ["page-toolbar", className].filter(Boolean).join(" ");

  return (
    <div className={classes} role="toolbar" aria-label={ariaLabel}>
      <div className="page-toolbar__main">
        {leading ? <div className="page-toolbar__leading">{leading}</div> : null}
        {filters ? <div className="page-toolbar__filters">{filters}</div> : null}
      </div>
      {trailing ? <div className="page-toolbar__trailing">{trailing}</div> : null}
    </div>
  );
}

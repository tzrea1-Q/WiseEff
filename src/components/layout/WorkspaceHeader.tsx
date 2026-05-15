import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type WorkspaceBreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

export type WorkspaceHeaderProps = {
  ariaLabel: string;
  breadcrumb?: WorkspaceBreadcrumbItem[];
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode[];
  actionsAriaLabel?: string;
  children?: ReactNode;
  className?: string;
};

export function WorkspaceHeader({
  ariaLabel,
  breadcrumb,
  eyebrow,
  title,
  description,
  status,
  primaryAction,
  secondaryActions = [],
  actionsAriaLabel,
  children,
  className
}: WorkspaceHeaderProps) {
  const classes = ["workspace-header", className].filter(Boolean).join(" ");
  const hasActions = Boolean(primaryAction || secondaryActions.length > 0);

  return (
    <header className={classes} role="banner" aria-label={ariaLabel}>
      <div className="workspace-header__content">
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className="workspace-header__breadcrumb" aria-label="工作区路径">
            {breadcrumb.map((item, index) => {
              const isLast = index === breadcrumb.length - 1;
              return (
                <span className="workspace-header__breadcrumb-item" key={`${item.label}-${index}`}>
                  {item.onClick && !isLast ? (
                    <button type="button" onClick={item.onClick}>
                      {item.label}
                    </button>
                  ) : (
                    <span aria-current={isLast ? "page" : undefined}>{item.label}</span>
                  )}
                  {!isLast ? <ChevronRight size={13} aria-hidden="true" /> : null}
                </span>
              );
            })}
          </nav>
        ) : null}
        {eyebrow ? <div className="workspace-header__eyebrow">{eyebrow}</div> : null}
        {title ? <div className="workspace-header__title">{title}</div> : null}
        {description ? <p className="workspace-header__description">{description}</p> : null}
        {children ? <div className="workspace-header__context">{children}</div> : null}
      </div>
      {status || hasActions ? (
        <div className="workspace-header__side">
          {status ? <div className="workspace-header__status">{status}</div> : null}
          {hasActions ? (
            <div className="workspace-header__actions" role={actionsAriaLabel ? "toolbar" : undefined} aria-label={actionsAriaLabel}>
              {secondaryActions.map((action, index) => (
                <span className="workspace-header__secondary-action" key={index}>
                  {action}
                </span>
              ))}
              {primaryAction ? <span className="workspace-header__primary-action">{primaryAction}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

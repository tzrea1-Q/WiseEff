import type { ReactNode } from "react";

export type ParamAdminEmptyStateProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
};

/**
 * Shared empty-state card for parameter-admin organization and project views.
 * Keeps copy, spacing, and optional next-step actions consistent.
 */
export function ParamAdminEmptyState({
  message,
  actionLabel,
  onAction,
  children
}: ParamAdminEmptyStateProps) {
  return (
    <div className="param-admin-empty" role="status">
      <p>{message}</p>
      {children}
      {actionLabel && onAction ? (
        <div className="param-admin-empty-actions">
          <button type="button" className="button subtle" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

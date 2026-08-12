import { Settings2, TerminalSquare } from "lucide-react";

import {
  DEBUGGING_ADMIN_UI,
  buildDebuggingAdminPath,
  type DebuggingAdminArea
} from "@/application/debugging/debuggingAdminPath";

export type DebuggingAdminScopeNavProps = {
  active: DebuggingAdminArea;
  onNavigate: (path: string) => void;
};

/**
 * Peer top-level destinations for debugging admin scope.
 * Canonical routes: /debugging-admin (parameter) and /debugging-admin/nodes.
 */
export function DebuggingAdminScopeNav({ active, onNavigate }: DebuggingAdminScopeNavProps) {
  return (
    <nav className="parameter-admin-scope-nav" aria-label={DEBUGGING_ADMIN_UI.scopeNavAria}>
      <button
        type="button"
        className={`parameter-admin-scope-nav__tab${active === "parameter" ? " is-active" : ""}`}
        aria-current={active === "parameter" ? "page" : undefined}
        onClick={() => onNavigate(buildDebuggingAdminPath("parameter"))}
      >
        <Settings2 size={16} aria-hidden="true" />
        {DEBUGGING_ADMIN_UI.parameterScope}
      </button>
      <button
        type="button"
        className={`parameter-admin-scope-nav__tab${active === "nodes" ? " is-active" : ""}`}
        aria-current={active === "nodes" ? "page" : undefined}
        onClick={() => onNavigate(buildDebuggingAdminPath("nodes"))}
      >
        <TerminalSquare size={16} aria-hidden="true" />
        {DEBUGGING_ADMIN_UI.nodesScope}
      </button>
    </nav>
  );
}

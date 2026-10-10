import { Settings2, TerminalSquare } from "lucide-react";
import { ViewSwitch } from "@/components/ui/view-switch";

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
    <ViewSwitch variant="section" ariaLabel={DEBUGGING_ADMIN_UI.scopeNavAria} value={active}
      onValueChange={(value) => onNavigate(buildDebuggingAdminPath(value as DebuggingAdminArea))}
      items={[
        { value: "parameter", label: <><Settings2 size={16} aria-hidden="true" />{DEBUGGING_ADMIN_UI.parameterScope}</> },
        { value: "nodes", label: <><TerminalSquare size={16} aria-hidden="true" />{DEBUGGING_ADMIN_UI.nodesScope}</> }
      ]} />
  );
}

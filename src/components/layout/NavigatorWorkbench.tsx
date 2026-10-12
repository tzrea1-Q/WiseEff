import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { TabPanel } from "@/components/ui/tab-panel";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./navigator-workbench.css";

type TaskState = { kind: "loading" | "empty"; message: string }
  | { kind: "error"; message: string; detail?: string; onRetry: () => void };

type NavigatorWorkbenchProps = {
  pageKey: string;
  toolbar: ReactNode;
  primaryAction?: ReactNode;
  context?: ReactNode;
  notice?: ReactNode;
  navigator: ReactNode;
  navigatorLabel: string;
  taskLabel: string;
  taskClassName?: string;
  taskState?: TaskState;
  panelId?: string;
  tabId?: string;
  inspector?: ReactNode;
  inspectorLabel?: string;
  children?: ReactNode;
};

export function NavigatorWorkbench(props: NavigatorWorkbenchProps) {
  return <WorkbenchSlots key={props.pageKey} {...props} />;
}

function WorkbenchSlots({ pageKey, toolbar, primaryAction, context, notice, navigator, navigatorLabel,
  taskLabel, taskClassName = "", taskState, panelId, tabId, inspector, inspectorLabel = "检查器", children }: NavigatorWorkbenchProps) {
  const navigationId = useId();
  const storageKey = `wiseeff.navigator-workbench.collapsed:${pageKey}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  const toggleNavigator = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      return;
    }
  };
  return (
    <div className="navigator-workbench" data-workbench-page={pageKey} data-navigator-collapsed={collapsed}>
      <div className="navigator-workbench__toolbar" role="group" aria-label="工作台操作">
        <div className="navigator-workbench__controls">{toolbar}</div>
        {primaryAction ? <div className="navigator-workbench__primary">{primaryAction}</div> : null}
      </div>
      {context ? <div className="navigator-workbench__context">{context}</div> : null}
      {notice ? <div className="navigator-workbench__notice">{notice}</div> : null}
      <TabPanel className="navigator-workbench__body" id={panelId} aria-labelledby={tabId}
        role={panelId ? "tabpanel" : undefined}>
        <section className="navigator-workbench__navigator" aria-label={navigatorLabel}>
          <div className="navigator-workbench__navigator-header">
            {!collapsed ? <strong>{navigatorLabel}</strong> : null}
            <Button type="button" variant="ghost" size="icon" aria-expanded={!collapsed}
              aria-controls={navigationId} onClick={toggleNavigator}>
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
              <span className="sr-only">{collapsed ? "展开" : "收起"}{navigatorLabel}</span>
            </Button>
          </div>
          <div id={navigationId} className="navigator-workbench__navigation" hidden={collapsed}>{navigator}</div>
        </section>
        <section className={`navigator-workbench__task ${taskClassName}`} aria-label={taskLabel}>
          {taskState?.kind === "loading" ? <SectionSkeleton label={taskState.message} />
            : taskState?.kind === "empty" ? <SectionEmpty message={taskState.message} />
            : taskState?.kind === "error" ? <SectionError message={taskState.message} detail={taskState.detail} onRetry={taskState.onRetry} />
            : children}
        </section>
        {inspector ? <section className="navigator-workbench__inspector" aria-label={inspectorLabel}>{inspector}</section> : null}
      </TabPanel>
    </div>
  );
}

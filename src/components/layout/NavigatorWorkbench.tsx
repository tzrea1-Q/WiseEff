import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { TabPanel } from "@/components/ui/tab-panel";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./navigator-workbench.css";

type TaskState = { kind: "loading" | "empty"; message: string }
  | { kind: "error"; message: string; detail?: string; onRetry: () => void };

type NavigatorWorkbenchProps = {
  pageKey: string;
  toolbar: ReactNode | ((primaryAction: ReactNode) => ReactNode);
  primaryAction?: ReactNode;
  context?: ReactNode;
  notice?: ReactNode;
  navigator: ReactNode;
  navigatorLabel: string;
  resizableNavigator?: boolean;
  taskLabel: string;
  taskClassName?: string;
  taskState?: TaskState;
  panelId?: string;
  tabId?: string;
  inspector?: ReactNode;
  inspectorHidden?: boolean;
  inspectorOverlay?: boolean;
  inspectorLabel?: string;
  children?: ReactNode;
};

export function NavigatorWorkbench(props: NavigatorWorkbenchProps) {
  return <WorkbenchSlots key={props.pageKey} {...props} />;
}

function WorkbenchSlots({ pageKey, toolbar, primaryAction, context, notice, navigator, navigatorLabel, resizableNavigator = false,
  taskLabel, taskClassName = "", taskState, panelId, tabId, inspector, inspectorHidden = false, inspectorOverlay = false, inspectorLabel = "检查器", children }: NavigatorWorkbenchProps) {
  const navigationId = useId();
  const navigatorRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number; next: number } | null>(null);
  const widthKey = `wiseeff.navigator-workbench.width:${pageKey}`;
  const [maximumWidth, setMaximumWidth] = useState(520);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => {
    try {
      const width = Number(localStorage.getItem(widthKey));
      return Number.isFinite(width) && width >= 240 && width <= 520 ? width : null;
    } catch { return null; }
  });
  const width = Math.min(preferredWidth ?? 288, maximumWidth);
  useEffect(() => {
    if (!resizableNavigator) return;
    const body = navigatorRef.current?.parentElement;
    const measure = () => {
      const available = body?.getBoundingClientRect().width;
      if (available) setMaximumWidth(Math.max(240, Math.floor(Math.min(520, window.innerWidth * 0.42, available - 332))));
    };
    const observer = new ResizeObserver(measure);
    if (body) observer.observe(body);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [resizableNavigator]);
  const updateWidth = (next: number, persist = true) => {
    const bounded = Math.max(240, Math.min(maximumWidth, Math.round(next)));
    setPreferredWidth(bounded);
    if (persist) {
      try { localStorage.setItem(widthKey, String(bounded)); } catch { /* Browser storage is optional. */ }
    }
    return bounded;
  };
  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    updateWidth(drag.current.next);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
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
  const primaryActionSlot = primaryAction ? <div className="navigator-workbench__primary">{primaryAction}</div> : null;
  return (
    <div className="navigator-workbench" data-workbench-page={pageKey} data-navigator-collapsed={collapsed}
      style={resizableNavigator ? { "--navigator-workbench-navigator-width": `${width}px` } as CSSProperties : undefined}>
      <div className="navigator-workbench__toolbar" role="group" aria-label="工作台操作">
        <div className="navigator-workbench__controls">{typeof toolbar === "function" ? toolbar(primaryActionSlot) : toolbar}</div>
        {typeof toolbar !== "function" ? primaryActionSlot : null}
      </div>
      {context ? <div className="navigator-workbench__context">{context}</div> : null}
      {notice ? <div className="navigator-workbench__notice">{notice}</div> : null}
      <TabPanel className="navigator-workbench__body" id={panelId} aria-labelledby={tabId}
        role={panelId ? "tabpanel" : undefined}>
        <section ref={navigatorRef} className="navigator-workbench__navigator" aria-label={navigatorLabel}>
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
        {resizableNavigator && !collapsed ? (
          // A focusable ARIA separator is an interactive window splitter.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
          <div className="navigator-workbench__resize" role="separator" tabIndex={0}
          aria-label={`调整${navigatorLabel}宽度`} aria-orientation="vertical" aria-controls={navigationId}
          aria-valuemin={240} aria-valuemax={maximumWidth} aria-valuenow={width}
          title="拖动调整宽度；方向键微调，Home 恢复默认宽度"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            const currentWidth = navigatorRef.current?.getBoundingClientRect().width || width;
            drag.current = { pointerId: event.pointerId, x: event.clientX, width: currentWidth, next: currentWidth };
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            drag.current.next = updateWidth(drag.current.width + event.clientX - drag.current.x, false);
          }}
          onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}
          onDoubleClick={() => updateWidth(288)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const step = event.shiftKey ? 32 : 8;
            updateWidth(event.key === "Home" ? 288 : event.key === "End" ? maximumWidth : width + (event.key === "ArrowRight" ? step : -step));
          }} />) : null}
        <TabPanel role="region" className={`navigator-workbench__task ${taskClassName}`} aria-label={taskLabel}>
          {taskState?.kind === "loading" ? <SectionSkeleton label={taskState.message} />
            : taskState?.kind === "empty" ? <SectionEmpty message={taskState.message} />
            : taskState?.kind === "error" ? <SectionError message={taskState.message} detail={taskState.detail} onRetry={taskState.onRetry} />
            : children}
        </TabPanel>
        {inspector ? <section className="navigator-workbench__inspector" hidden={inspectorHidden} data-overlay={inspectorOverlay} aria-label={inspectorLabel}>{inspector}</section> : null}
      </TabPanel>
    </div>
  );
}

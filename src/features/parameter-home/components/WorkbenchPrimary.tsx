import { ArrowRight } from "lucide-react";
import type { WorkbenchAction, WorkbenchScenarioEntry, PersonalWorkbenchViewModel } from "../workbench/derivePersonalWorkbench";
import { getNextActionPresentation } from "./nextActionPresentation";
import type { SectionStatus } from "@/application/parameters/dashboardState";
import { SectionError, SectionSkeleton } from "./SectionState";
import "../parameter-home.css";

type WorkbenchPrimaryProps = {
  workbench: PersonalWorkbenchViewModel;
  summaryStatus?: SectionStatus;
  summaryError?: string | null;
  onSummaryRetry?: () => void;
  onNavigate: (path: string) => void;
  onNewProject?: () => void;
};

export function WorkbenchPrimary({
  workbench,
  summaryStatus = "ready",
  summaryError,
  onSummaryRetry = () => undefined,
  onNavigate,
  onNewProject
}: WorkbenchPrimaryProps) {
  if (summaryStatus === "loading" || summaryStatus === "idle") {
    return (
      <section className="parameter-home__workbench" aria-label="个人工作台">
        <SectionSkeleton label="加载待办事项" />
      </section>
    );
  }
  if (summaryStatus === "error") {
    return (
      <section className="parameter-home__workbench" aria-label="个人工作台">
        <SectionError message={summaryError ?? "待办事项加载失败"} onRetry={onSummaryRetry} />
      </section>
    );
  }

  const actionPanel = <NextActionList actions={workbench.nextActions} onNavigate={onNavigate} />;
  const scenarioPanel = (
    <ScenarioEntryPanel entries={workbench.scenarioEntries} onNavigate={onNavigate} onNewProject={onNewProject} />
  );

  return (
    <section className="parameter-home__workbench" aria-label="个人工作台">
      <div className="parameter-home__workbench-grid">
        {scenarioPanel}
        {actionPanel}
      </div>
    </section>
  );
}

function NextActionList({
  actions,
  onNavigate
}: {
  actions: WorkbenchAction[];
  onNavigate: (path: string) => void;
}) {
  return (
    <section className="parameter-home__next-action-panel parameter-home__panel" aria-label="待办事项">
      <div className="parameter-home__panel-head">
        <div>
          <h2>待办事项</h2>
        </div>
      </div>
      <div className="parameter-home__next-action-list">
        {actions.map((action) => {
          const { Icon, tone } = getNextActionPresentation(action);
          return (
          <button
            key={action.id}
            type="button"
            className="parameter-home__next-action-card"
            data-priority={action.priority}
            data-kind={action.kind}
            data-source={action.source}
            data-icon-tone={tone}
            onClick={() => onNavigate(action.path)}
          >
            <span className="parameter-home__next-action-icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className="parameter-home__next-action-body">
              <strong>{action.title}</strong>
              <small>{action.description}</small>
              <em>{action.meta}</em>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          );
        })}
      </div>
    </section>
  );
}

function ScenarioEntryPanel({
  entries,
  onNavigate,
  onNewProject
}: {
  entries: WorkbenchScenarioEntry[];
  onNavigate: (path: string) => void;
  onNewProject?: () => void;
}) {
  return (
    <section className="parameter-home__scenario-panel parameter-home__panel" aria-label="主要功能">
      <div className="parameter-home__panel-head">
        <div>
          <h2>主要功能</h2>
        </div>
      </div>
      <div className="parameter-home__scenario-list">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="parameter-home__scenario-entry"
            aria-label={`打开 ${entry.title}`}
            onClick={() => {
              if (entry.action === "new-project" && onNewProject) {
                onNewProject();
                return;
              }
              onNavigate(entry.path);
            }}
          >
            <span>
              <strong>{entry.title}</strong>
              <small>{entry.description}</small>
            </span>
            <em>
              {entry.metricLabel} <b>{entry.metricValue}</b>
            </em>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

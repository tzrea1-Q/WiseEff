import { ArrowRight, ListChecks, ShieldCheck, Sparkles } from "lucide-react";
import type { WorkbenchAction, WorkbenchScenarioEntry, PersonalWorkbenchViewModel } from "../workbench/derivePersonalWorkbench";
import "../parameter-home.css";

type WorkbenchPrimaryProps = {
  workbench: PersonalWorkbenchViewModel;
  onNavigate: (path: string) => void;
  onNewProject?: () => void;
};

export function WorkbenchPrimary({ workbench, onNavigate, onNewProject }: WorkbenchPrimaryProps) {
  const actionPanel = <NextActionList actions={workbench.nextActions} onNavigate={onNavigate} />;
  const scenarioPanel = (
    <ScenarioEntryPanel entries={workbench.scenarioEntries} onNavigate={onNavigate} onNewProject={onNewProject} />
  );

  return (
    <section className="parameter-home__workbench" aria-label="个人工作台">
      <div className="parameter-home__workbench-grid" data-emphasis={workbench.emphasis}>
        {workbench.emphasis === "action-first" ? (
          <>
            {actionPanel}
            {scenarioPanel}
          </>
        ) : (
          <>
            {scenarioPanel}
            {actionPanel}
          </>
        )}
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
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="parameter-home__next-action-card"
            data-priority={action.priority}
            data-kind={action.kind}
            onClick={() => onNavigate(action.path)}
          >
            <span className="parameter-home__next-action-icon" aria-hidden="true">
              {action.kind === "todo" ? (
                <ListChecks size={18} />
              ) : action.kind === "recommendation" ? (
                <Sparkles size={18} />
              ) : (
                <ShieldCheck size={18} />
              )}
            </span>
            <span className="parameter-home__next-action-body">
              <strong>{action.title}</strong>
              <small>{action.description}</small>
              <em>{action.meta}</em>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
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

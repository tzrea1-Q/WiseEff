import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Project } from "../../mockData";

export type ProjectChipProps = {
  label: "基准项目" | "对比项目";
  tone: "base" | "target";
  projects: Project[];
  selectedProjectId: string;
  disabledProjectId: string;
  onSelect: (projectId: string) => void;
};

export function ProjectChip({ label, tone, projects, selectedProjectId, disabledProjectId, onSelect }: ProjectChipProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (!normalizedQuery) {
          return true;
        }

        return `${project.code} ${project.name}`.toLowerCase().includes(normalizedQuery);
      }),
    [normalizedQuery, projects]
  );

  return (
    <div className="project-chip" data-tone={tone}>
      <button
        aria-expanded={open}
        aria-label={`${label} ${selectedProject.code} ${selectedProject.name}`}
        className="project-chip__trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="project-chip__dot" aria-hidden="true" />
        <span className="project-chip__code">{selectedProject.code}</span>
        <span className="project-chip__name">{selectedProject.name}</span>
      </button>

      {open ? (
        <div className="project-chip__popover">
          <label className="project-chip__search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              placeholder="搜索项目"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ul className="project-chip__list" role="listbox" aria-label={`${label}列表`}>
            {filteredProjects.length > 0 ? (
              filteredProjects.map((project) => {
                const disabled = project.id === disabledProjectId;

                return (
                  <li
                    aria-disabled={disabled}
                    aria-selected={project.id === selectedProjectId}
                    data-disabled={disabled || undefined}
                    key={project.id}
                    role="option"
                    onClick={() => {
                      if (disabled) {
                        return;
                      }

                      onSelect(project.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="project-chip__option">
                      <span className="project-chip__option-code">{project.code}</span>
                      <span className="project-chip__option-name">{project.name}</span>
                      {disabled ? <span className="project-chip__option-hint">当前对侧项目</span> : null}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="project-chip__empty">没有匹配项目</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

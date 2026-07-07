import type { ReactNode } from "react";
import "../parameter-home.css";

type PanelProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3";
};

export function Panel({ title, subtitle, actions, children, className, headingLevel = "h2" }: PanelProps) {
  const Heading = headingLevel;
  return (
    <section className={["parameter-home__panel", className].filter(Boolean).join(" ")}>
      <div className="parameter-home__panel-head">
        <div>
          <Heading>{title}</Heading>
          {subtitle ? <span className="parameter-home__panel-subtitle">{subtitle}</span> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

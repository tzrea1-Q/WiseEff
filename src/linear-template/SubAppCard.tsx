import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

export type SubAppCardCta = {
  label: string;
  href: string;
};

export type SubAppCardProps = {
  accent: string;
  icon: LucideIcon;
  kicker: string;
  title: string;
  description: string;
  chips: string[];
  primary: SubAppCardCta;
  secondary: SubAppCardCta;
};

export function SubAppCard({ accent, icon: Icon, kicker, title, description, chips, primary, secondary }: SubAppCardProps) {
  const style = { "--sub-app-accent": accent } as CSSProperties;
  const titleId = `sub-app-card-title-${title}`;
  const descriptionId = `sub-app-card-desc-${title}`;

  return (
    <article className="sub-app-card" style={style} aria-labelledby={titleId}>
      <header className="sub-app-card-head">
        <div className="sub-app-card-identity">
          <span className="sub-app-card-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className="sub-app-card-kicker">{kicker}</span>
        </div>
      </header>
      <div className="sub-app-card-body">
        <h3 id={titleId} className="sub-app-card-title">
          {title}
        </h3>
        <p id={descriptionId} className="sub-app-card-desc">
          {description}
        </p>
        <ul className="sub-app-card-chips" aria-label={`${title} 能力`}>
          {chips.map((chip) => (
            <li key={chip}>{chip}</li>
          ))}
        </ul>
      </div>
      <div className="sub-app-card-ctas" aria-label={`${title} 操作`}>
        <a className="sub-app-card-primary" href={primary.href} aria-describedby={descriptionId}>
          {primary.label}
          <span aria-hidden="true"> →</span>
        </a>
        <a className="sub-app-card-secondary" href={secondary.href}>
          {secondary.label}
          <span aria-hidden="true"> ›</span>
        </a>
      </div>
    </article>
  );
}

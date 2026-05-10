import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

export type SubAppCardCta = {
  label: string;
  href: string;
};

export type SubAppCardBadge = {
  count: number;
  label: string;
};

export type SubAppCardProps = {
  accent: string;
  icon: LucideIcon;
  title: string;
  description: string;
  chips: string[];
  primary: SubAppCardCta;
  secondary: SubAppCardCta;
  badge: SubAppCardBadge;
};

export function SubAppCard({ accent, icon: Icon, title, description, chips, primary, secondary, badge }: SubAppCardProps) {
  const style = { "--sub-app-accent": accent } as CSSProperties;
  const titleId = `sub-app-card-title-${title}`;
  const descriptionId = `sub-app-card-desc-${title}`;

  return (
    <article className="sub-app-card" style={style} aria-labelledby={titleId}>
      <header className="sub-app-card-head">
        <span className="sub-app-card-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <span
          className={`sub-app-card-badge${badge.count === 0 ? " sub-app-card-badge-empty" : ""}`}
          aria-label={badge.label}
        >
          {badge.count === 0 ? "—" : badge.count}
        </span>
      </header>
      <h3 id={titleId} className="sub-app-card-title">
        {title}
      </h3>
      <p id={descriptionId} className="sub-app-card-desc">
        {description}
      </p>
      <ul className="sub-app-card-chips">
        {chips.map((chip) => (
          <li key={chip}>{chip}</li>
        ))}
      </ul>
      <div className="sub-app-card-ctas">
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

type NoEntryPageProps = {
  title: string;
  description: string;
  actionLabel: string;
  actionPath: string;
  onNavigate: (path: string) => void;
};

export function NoEntryPage({ title, description, actionLabel, actionPath, onNavigate }: NoEntryPageProps) {
  return (
    <section className="no-entry-page" role="region" aria-labelledby="no-entry-page-title">
      <span className="eyebrow">404</span>
      <h2 id="no-entry-page-title">{title}</h2>
      <p>{description}</p>
      <button className="button primary" type="button" onClick={() => onNavigate(actionPath)}>
        {actionLabel}
      </button>
    </section>
  );
}

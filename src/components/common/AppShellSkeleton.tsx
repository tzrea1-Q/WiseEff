/**
 * App-bootstrap placeholder shown while the API session probe (`/api/v1/me`)
 * resolves, instead of a blank white screen. Purely decorative chrome: one
 * sidebar rail, one top bar, and a few content panels reusing the shared
 * section-skeleton texture.
 */
export function AppShellSkeleton() {
  return (
    <div className="app-shell-skeleton" role="status" aria-live="polite" aria-label="正在进入工作台">
      <span className="sr-only">正在进入工作台</span>
      <div className="app-shell-skeleton__sidebar" aria-hidden="true">
        <div className="section-skeleton__line wide" />
        <div className="section-skeleton__line medium" />
        <div className="section-skeleton__line medium" />
        <div className="section-skeleton__line wide" />
        <div className="section-skeleton__line medium" />
      </div>
      <div className="app-shell-skeleton__main" aria-hidden="true">
        <div className="app-shell-skeleton__topbar">
          <div className="section-skeleton__line" />
        </div>
        <div className="app-shell-skeleton__content">
          <div className="app-shell-skeleton__panel">
            <div className="section-skeleton">
              <div className="section-skeleton__line wide" />
              <div className="section-skeleton__line medium" />
              <div className="section-skeleton__line wide" />
            </div>
          </div>
          <div className="app-shell-skeleton__panel">
            <div className="section-skeleton">
              <div className="section-skeleton__line medium" />
              <div className="section-skeleton__line wide" />
              <div className="section-skeleton__line medium" />
            </div>
          </div>
          <div className="app-shell-skeleton__panel">
            <div className="section-skeleton">
              <div className="section-skeleton__line wide" />
              <div className="section-skeleton__line medium" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

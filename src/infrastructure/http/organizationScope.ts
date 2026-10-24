/** Bind a client to one URL-local target; resource links cannot replace that target. */
export function withOrganizationScope(path: string, organizationId?: string) {
  if (organizationId === undefined) return path;
  const url = new URL(path, "http://wiseeff.local");
  url.searchParams.set("organizationId", organizationId);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Business navigation preserves the confirmed workspace; platform configuration keeps its own scope. */
export function withBusinessOrganizationScope(path: string, organizationId?: string) {
  return isOrganizationBusinessPath(path) ? withOrganizationScope(path, organizationId) : path;
}

export function isOrganizationBusinessPath(path: string) {
  const pathname = new URL(path, "http://wiseeff.local").pathname;
  const roots = ["/knowledge", "/knowledge-admin", "/logs", "/log-admin", "/parameter-home", "/parameters", "/parameter-review", "/parameter-submissions", "/parameter-admin", "/projects", "/audit", "/feedback", "/feedback-admin"];
  return roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

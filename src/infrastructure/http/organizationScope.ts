/** Bind a client to one URL-local target; resource links cannot replace that target. */
export function withOrganizationScope(path: string, organizationId?: string) {
  if (organizationId === undefined) return path;
  const url = new URL(path, "http://wiseeff.local");
  url.searchParams.set("organizationId", organizationId);
  return `${url.pathname}${url.search}${url.hash}`;
}

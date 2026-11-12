export function changeCenterHref(scope: "mine" | "review", context: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({ scope });
  for (const [key, value] of Object.entries(context)) if (value !== undefined) params.set(key, value);
  return `/parameter-changes?${params}`;
}

export function normalizeLegacyChangeHref(pathname: string, search: string, hash: string) {
  const scope = pathname === "/parameter-submissions" ? "mine" : pathname === "/parameter-review" ? "review" : null;
  if (!scope) return null;
  const parts = search ? search.slice(1).split("&").filter((part) => !new URLSearchParams(part).has("scope")) : [];
  parts.push(`scope=${scope}`);
  return `/parameter-changes?${parts.join("&")}${hash}`;
}

/** Parse effective DTS string lists and the unquoted selectors stored by older revisions. */
export const parseCompatibles = (raw: string | null): string[] => {
  if (!raw) return [];
  const quoted = [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
  if (quoted.length > 0) return quoted;
  return raw.trim() ? [raw.trim()] : [];
};

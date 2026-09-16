import { tokenizeQuery } from "./normalize";
import { matchesProfile } from "./filter";
import type { SearchProfile } from "./types";

export type FilterTreeResult<T> = {
  nodes: T[];
  expandedIds: string[];
};

export function filterTree<T>(
  nodes: readonly T[],
  query: string,
  options: {
    profile: SearchProfile<T>;
    getChildren: (node: T) => readonly T[];
    withChildren: (node: T, children: T[]) => T;
    getId: (node: T) => string;
  }
): FilterTreeResult<T> {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return { nodes: [...nodes], expandedIds: [] };
  }

  const expandedIds: string[] = [];

  const visit = (node: T): T | null => {
    const nextChildren = options
      .getChildren(node)
      .map(visit)
      .filter((child): child is T => child !== null);
    const selfMatches = matchesProfile(node, query, options.profile);
    if (!selfMatches && nextChildren.length === 0) {
      return null;
    }
    if (nextChildren.length > 0) {
      expandedIds.push(options.getId(node));
    }
    return options.withChildren(node, nextChildren);
  };

  return {
    nodes: nodes.map(visit).filter((node): node is T => node !== null),
    expandedIds
  };
}

export function isAncestorPath(ancestor: string, child: string): boolean {
  if (!ancestor || ancestor === child) {
    return false;
  }
  if (ancestor === "/") {
    return child.startsWith("/") && child !== "/";
  }
  return child.startsWith(`${ancestor}/`);
}

export function filterHierarchicalList<T>(
  items: readonly T[],
  query: string,
  profile: SearchProfile<T>,
  getPath: (item: T) => string
): T[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return [...items];
  }

  const matchedPaths = items.filter((item) => matchesProfile(item, query, profile)).map(getPath);
  if (matchedPaths.length === 0) {
    return [];
  }

  return items.filter((item) => {
    const path = getPath(item);
    return matchedPaths.some((matched) => matched === path || isAncestorPath(path, matched));
  });
}

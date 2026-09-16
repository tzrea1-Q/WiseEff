import { flattenSearchValues, tokenizeQuery } from "./normalize";
import { KIND_SCORE, matchPreparedToken, prepareToken, prepareValue, type PreparedValue } from "./match";
import type { FieldMatch, SearchHit, SearchOptions, SearchProfile } from "./types";

type PreparedField = {
  name: string;
  weight: number;
  values: PreparedValue[];
};

type PreparedDocument<T> = {
  item: T;
  index: number;
  fields: PreparedField[];
};

function prepareDocument<T>(item: T, index: number, profile: SearchProfile<T>): PreparedDocument<T> {
  return {
    item,
    index,
    fields: profile.fields.map((field) => ({
      name: field.name,
      weight: field.weight,
      values: flattenSearchValues(field.getValues(item)).map(prepareValue)
    }))
  };
}

function scoreDocument<T>(document: PreparedDocument<T>, tokens: readonly { normalized: string; compact: string }[]): SearchHit<T> | null {
  const matchedByField = new Map<string, FieldMatch>();
  let total = 0;

  for (const token of tokens) {
    let best: FieldMatch | null = null;
    for (const field of document.fields) {
      let bestKindScore = -1;
      let bestKind: FieldMatch["kind"] | null = null;
      for (const value of field.values) {
        const kind = matchPreparedToken(token, value);
        if (!kind) {
          continue;
        }
        const kindScore = KIND_SCORE[kind];
        if (kindScore > bestKindScore) {
          bestKindScore = kindScore;
          bestKind = kind;
        }
      }
      if (!bestKind) {
        continue;
      }
      const score = bestKindScore * field.weight;
      if (!best || score > best.score) {
        best = { field: field.name, kind: bestKind, score };
      }
    }
    if (!best) {
      return null;
    }
    total += best.score;
    const existing = matchedByField.get(best.field);
    if (!existing || best.score > existing.score) {
      matchedByField.set(best.field, best);
    }
  }

  return {
    item: document.item,
    index: document.index,
    score: total,
    matchedFields: [...matchedByField.values()]
  };
}

export type SearchIndex<T> = {
  search: (query: string, options?: SearchOptions) => SearchHit<T>[];
};

export function createSearchIndex<T>(items: readonly T[], profile: SearchProfile<T>): SearchIndex<T> {
  const documents = items.map((item, index) => prepareDocument(item, index, profile));

  return {
    search(query: string, options?: SearchOptions): SearchHit<T>[] {
      const tokens = tokenizeQuery(query).map(prepareToken);
      if (tokens.length === 0) {
        return documents.map((document) => ({
          item: document.item,
          index: document.index,
          score: 0,
          matchedFields: []
        }));
      }

      const hits: SearchHit<T>[] = [];
      for (const document of documents) {
        const hit = scoreDocument(document, tokens);
        if (hit) {
          hits.push(hit);
        }
      }

      if (options?.rank) {
        hits.sort((left, right) => right.score - left.score || left.index - right.index);
      }

      return hits;
    }
  };
}

export function searchItems<T>(
  items: readonly T[],
  query: string,
  profile: SearchProfile<T>,
  options?: SearchOptions
): SearchHit<T>[] {
  return createSearchIndex(items, profile).search(query, options);
}

export function filterItems<T>(
  items: readonly T[],
  query: string,
  profile: SearchProfile<T>,
  options?: SearchOptions
): T[] {
  return searchItems(items, query, profile, options).map((hit) => hit.item);
}

export function matchesProfile<T>(item: T, query: string, profile: SearchProfile<T>): boolean {
  return searchItems([item], query, profile).length > 0;
}

export const SEARCH_FIELD_LABELS: Record<string, string> = {
  name: "名称",
  displayName: "显示名",
  propertyKey: "属性键",
  key: "Key",
  description: "描述",
  explanation: "说明",
  documentation: "文档",
  notes: "备注",
  module: "模块",
  modulePath: "模块路径",
  moduleName: "模块",
  source: "来源",
  sourceFileName: "源文件",
  sourceNodePath: "源节点路径",
  nodePath: "节点路径",
  compatible: "compatible",
  configFormat: "配置格式",
  title: "标题",
  email: "邮箱",
  username: "用户名"
};

export function formatMatchHint(matchedFields: readonly FieldMatch[], visibleFieldNames: readonly string[]): string | null {
  const hidden = matchedFields.filter((match) => !visibleFieldNames.includes(match.field));
  if (hidden.length === 0) {
    return null;
  }
  const best = [...hidden].sort((left, right) => right.score - left.score)[0];
  if (!best) {
    return null;
  }
  return `命中：${SEARCH_FIELD_LABELS[best.field] ?? best.field}`;
}

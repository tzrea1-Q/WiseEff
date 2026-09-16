export type SearchableScalar = string | number | null | undefined;

export type SearchFieldAccessor<T> = {
  name: string;
  weight: number;
  getValues: (item: T) => ReadonlyArray<SearchableScalar | readonly SearchableScalar[]>;
};

export type SearchProfile<T> = {
  fields: readonly SearchFieldAccessor<T>[];
};

export type MatchKind =
  | "exact"
  | "field-prefix"
  | "token-prefix"
  | "substring"
  | "compact-substring"
  | "subsequence";

export type FieldMatch = {
  field: string;
  kind: MatchKind;
  score: number;
};

export type SearchHit<T> = {
  item: T;
  index: number;
  score: number;
  matchedFields: FieldMatch[];
};

export type SearchOptions = {
  /** When true, sort by score descending then original index. Default false so page sort wins. */
  rank?: boolean;
};

export const FIELD_WEIGHT = {
  identity: 5,
  explanation: 3,
  attribution: 2,
  value: 1
} as const;

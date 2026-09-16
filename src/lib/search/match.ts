import { compactSearchText, isIdentifierToken, normalizeSearchText, tokenizeFieldText } from "./normalize";
import type { MatchKind } from "./types";

export const KIND_SCORE: Record<MatchKind, number> = {
  exact: 100,
  "field-prefix": 80,
  "token-prefix": 70,
  substring: 50,
  "compact-substring": 40,
  subsequence: 20
};

export type PreparedValue = {
  normalized: string;
  compact: string;
  tokens: string[];
  compactTokens: string[];
};

export function prepareValue(raw: string): PreparedValue {
  const normalized = normalizeSearchText(raw);
  const tokens = tokenizeFieldText(raw);
  return {
    normalized,
    compact: compactSearchText(raw),
    tokens,
    compactTokens: tokens.map(compactSearchText)
  };
}

export function prepareToken(token: string): { normalized: string; compact: string } {
  return {
    normalized: normalizeSearchText(token),
    compact: compactSearchText(token)
  };
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) {
      i += 1;
    }
  }
  return i === needle.length;
}

export function matchPreparedToken(
  token: { normalized: string; compact: string },
  value: PreparedValue
): MatchKind | null {
  const { normalized: nToken, compact: cToken } = token;
  if (!nToken) {
    return null;
  }

  if (value.normalized === nToken || (cToken.length > 0 && value.compact === cToken)) {
    return "exact";
  }
  if (value.normalized.startsWith(nToken) || (cToken.length > 0 && value.compact.startsWith(cToken))) {
    return "field-prefix";
  }

  const tokenExact = value.tokens.some((fieldToken, index) => {
    if (fieldToken === nToken) {
      return true;
    }
    const compactToken = value.compactTokens[index];
    return Boolean(cToken) && compactToken === cToken;
  });
  if (tokenExact) {
    return "token-prefix";
  }

  const tokenPrefix = value.tokens.some((fieldToken, index) => {
    if (fieldToken.startsWith(nToken)) {
      return true;
    }
    const compactToken = value.compactTokens[index];
    return Boolean(cToken) && compactToken.startsWith(cToken);
  });
  if (tokenPrefix) {
    return "token-prefix";
  }

  if (value.normalized.includes(nToken)) {
    return "substring";
  }

  if (cToken.length >= 3 && value.compact.includes(cToken)) {
    return "compact-substring";
  }

  if (
    isIdentifierToken(nToken) &&
    cToken.length >= 4 &&
    !value.normalized.includes(" ") &&
    isOrderedSubsequence(cToken, value.compact)
  ) {
    return "subsequence";
  }

  return null;
}

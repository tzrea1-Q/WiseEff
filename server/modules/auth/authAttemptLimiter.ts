export type AuthAttemptLimiterOptions = {
  windowMs?: number;
  maxAttempts?: number;
  now?: () => number;
};

export type AuthAttemptDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export type AuthAttemptLimiter = {
  consume(key: string): AuthAttemptDecision;
  reset(key: string): void;
};

const defaultWindowMs = 60_000;
const defaultMaxAttempts = 10;

export function createAuthAttemptLimiter(options: AuthAttemptLimiterOptions = {}): AuthAttemptLimiter {
  const windowMs = options.windowMs ?? defaultWindowMs;
  const maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();

  function prune(key: string, at: number) {
    const next = (attempts.get(key) ?? []).filter((timestamp) => at - timestamp < windowMs);
    if (next.length === 0) {
      attempts.delete(key);
    } else {
      attempts.set(key, next);
    }
    return next;
  }

  return {
    consume(key: string) {
      const at = now();
      const current = prune(key, at);
      if (current.length >= maxAttempts) {
        return { allowed: false, retryAfterMs: Math.max(1, windowMs - (at - current[0])) };
      }
      current.push(at);
      attempts.set(key, current);
      return { allowed: true };
    },
    reset(key: string) {
      attempts.delete(key);
    }
  };
}

export function authAttemptKey(kind: "login" | "register", clientIp: string, username: string) {
  return `${kind}:${clientIp || "unknown"}:${username || "*"}`;
}

// Per-account login lockout (in memory: one hub, one process). The per-IP limit lives in
// @fastify/rate-limit; this stops slow guessing against one phone number from many IPs.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

const failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

/** Seconds until the account unlocks, or 0 if it is not locked. */
export function lockedFor(phone: string): number {
  const f = failures.get(phone);
  if (!f || f.lockedUntil <= Date.now()) return 0;
  return Math.ceil((f.lockedUntil - Date.now()) / 1000);
}

export function recordFailure(phone: string) {
  const now = Date.now();
  const f = failures.get(phone);
  if (!f || now - f.first > WINDOW_MS) {
    failures.set(phone, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  f.count += 1;
  if (f.count >= MAX_FAILURES) f.lockedUntil = now + LOCK_MS;
}

export function clearFailures(phone: string) {
  failures.delete(phone);
}

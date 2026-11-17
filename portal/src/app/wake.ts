import { API_URL } from './api-base';

/** Render sleeps. This is the call that wakes herback. */
export const HERBACK_HEALTH = `${API_URL}/health`;

/** Herback is checked once a minute while a portal stays open. */
export const HEALTH_EVERY_MS = 60_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WakeTarget {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

export function wakeHerback(fetchImpl: FetchLike = fetch): void {
  void fetchImpl(HERBACK_HEALTH, { method: 'GET', cache: 'no-store' }).catch(() => undefined);
}

/** Call herback now, again each minute, and again when this page becomes visible. */
export function armWake(target: WakeTarget = document, fetchImpl: FetchLike = fetch): () => void {
  wakeHerback(fetchImpl);
  const timer = setInterval(() => wakeHerback(fetchImpl), HEALTH_EVERY_MS);
  target.addEventListener('visibilitychange', () => {
    if (target.visibilityState === 'visible') {
      wakeHerback(fetchImpl);
    }
  });
  return () => clearInterval(timer);
}

"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small UI choice that outlives a reload — which view /projects opens in, and
 * whatever comes after it.
 *
 * Modelled on lib/session.ts, and for the same reason: localStorage cannot be
 * read during a server render, so the value has to reach React as a
 * useSyncExternalStore source with a real server snapshot. Resolving it in an
 * effect instead would render the default, then swap — a flash of the wrong
 * view on every load, and a hydration mismatch if the markup differed.
 *
 * Deliberately not for anything that matters. A preference that fails to
 * persist in a private window should be invisible; anything that must survive
 * belongs in Postgres.
 */

const PREFIX = "harness_pref:";

/** Memoised per key: useSyncExternalStore re-reads the snapshot on every render
 *  and would loop forever on a fresh value each time. */
const cached = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function listenersFor(key: string): Set<() => void> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    // Private browsing, or site data blocked. No preference is a fine answer.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // The choice still applies for this page's lifetime.
  }
}

/**
 * @param key       namespaced under `harness_pref:` so it cannot collide with
 *                  the session ids in lib/session.ts.
 * @param fallback  used on the server, on the first client render before
 *                  hydration, and whenever the stored value is not `allowed`.
 * @param allowed   the permitted values. A stale key left by an older build
 *                  must not put the UI into a state it can no longer render.
 */
export function useStoredPreference<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listenersFor(key);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    let value = cached.get(key);
    if (value === undefined) {
      value = read(key) ?? fallback;
      cached.set(key, value);
    }
    return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  }, [key, fallback, allowed]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T) => {
      cached.set(key, next);
      write(key, next);
      for (const listener of listenersFor(key)) listener();
    },
    [key],
  );

  return [value, set];
}

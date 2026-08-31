/**
 * The toast store.
 *
 * Radix's Toast is declarative — one `Toast.Root` per visible toast — but call
 * sites want to fire one from inside a `catch` with no component in scope. So
 * the list of live toasts lives here, in module state, and `components/ui/toast.tsx`
 * subscribes to it.
 *
 * Same external-store shape as `lib/session.ts`, and for the same reason: the
 * snapshot must be a STABLE reference between changes, because
 * useSyncExternalStore re-reads it on every render and a fresh array each time
 * would loop forever.
 *
 * Auto-dismiss is deliberately not implemented here. Radix's `Toast.Root` owns
 * the timer, which is what gives us pause-on-hover, pause-on-focus and swipe
 * dismissal for free; the component removes the record when Radix reports it
 * closed.
 */

import type { ReactNode } from "react";

export type ToastType = "success" | "info" | "warning" | "error" | "loading";

export type ToastActionProps = {
  children: ReactNode;
  onClick?: () => void;
};

export type ToastOptions = {
  type?: ToastType;
  title: string;
  description?: string;
  /** Milliseconds. `Infinity` keeps the toast up until it is dismissed. */
  duration?: number;
  actionProps?: ToastActionProps;
};

export type ToastRecord = ToastOptions & { id: string };

/** A loading toast has no natural end, so it waits for its promise. */
const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 8000;

function defaultDuration(type: ToastType | undefined): number {
  if (type === "loading") return Infinity;
  // Failures are the ones worth reading twice, and are usually longer.
  if (type === "error") return ERROR_DURATION;
  return DEFAULT_DURATION;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let toasts: ToastRecord[] = [];
const listeners = new Set<() => void>();

/**
 * Module-level and never mutated (the store only ever replaces `toasts`
 * wholesale, never pushes into an existing array) — the server snapshot must
 * be reference-stable too, or useSyncExternalStore loops forever.
 */
const SERVER_SNAPSHOT: ToastRecord[] = [];

function emit(next: ToastRecord[]): void {
  toasts = next;
  for (const listener of listeners) listener();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToastsSnapshot(): ToastRecord[] {
  return toasts;
}

export function getServerToastsSnapshot(): ToastRecord[] {
  return SERVER_SNAPSHOT;
}

// ---------------------------------------------------------------------------
// Public API
//
// Shaped after the reference docs: `toast.add({title, description})` plus
// per-type shorthands that also accept a bare string for the common case.
// ---------------------------------------------------------------------------

function normalise(
  input: string | Omit<ToastOptions, "type">,
  type: ToastType,
): ToastOptions {
  return typeof input === "string"
    ? { title: input, type }
    : { ...input, type };
}

function add(options: ToastOptions): string {
  const id = newId();
  emit([
    ...toasts,
    {
      ...options,
      id,
      duration: options.duration ?? defaultDuration(options.type),
    },
  ]);
  return id;
}

function close(id: string): void {
  emit(toasts.filter((t) => t.id !== id));
}

/** Replace a live toast in place — how `promise` swaps loading for the verdict. */
function update(id: string, patch: Partial<ToastOptions>): void {
  emit(
    toasts.map((t) => {
      if (t.id !== id) return t;
      const type = patch.type ?? t.type;
      return {
        ...t,
        ...patch,
        type,
        // A resolved promise must stop being sticky, so re-derive the duration
        // unless the caller pinned one.
        duration: patch.duration ?? defaultDuration(type),
      };
    }),
  );
}

type PromiseMessages<T> = {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((error: unknown) => string);
};

async function promise<T>(
  input: Promise<T>,
  messages: PromiseMessages<T>,
): Promise<T> {
  const id = add({ type: "loading", title: messages.loading });
  try {
    const value = await input;
    update(id, {
      type: "success",
      title:
        typeof messages.success === "function"
          ? messages.success(value)
          : messages.success,
    });
    return value;
  } catch (error) {
    update(id, {
      type: "error",
      title:
        typeof messages.error === "function"
          ? messages.error(error)
          : messages.error,
    });
    // Re-thrown: a toast is feedback, not error handling. The caller still
    // decides what a failure means.
    throw error;
  }
}

export const toast = {
  add,
  close,
  update,
  promise,
  success: (input: string | Omit<ToastOptions, "type">) =>
    add(normalise(input, "success")),
  error: (input: string | Omit<ToastOptions, "type">) =>
    add(normalise(input, "error")),
  warning: (input: string | Omit<ToastOptions, "type">) =>
    add(normalise(input, "warning")),
  info: (input: string | Omit<ToastOptions, "type">) =>
    add(normalise(input, "info")),
  loading: (input: string | Omit<ToastOptions, "type">) =>
    add(normalise(input, "loading")),
};

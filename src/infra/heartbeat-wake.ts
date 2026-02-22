export type HeartbeatRunResult =
  | { status: "ran"; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export type HeartbeatWakeHandler = (opts: { reason?: string }) => Promise<HeartbeatRunResult>;

type WakeTimerKind = "normal" | "retry";

let handler: HeartbeatWakeHandler | null = null;
let handlerGeneration = 0;
let pendingReason: string | null = null;
let scheduled = false;
let running = false;
let timer: NodeJS.Timeout | null = null;
let timerDueAt: number | null = null;
let timerKind: WakeTimerKind | null = null;

const DEFAULT_COALESCE_MS = 250;
const DEFAULT_RETRY_MS = 1_000;

function schedule(coalesceMs: number, kind: WakeTimerKind = "normal") {
  const delay = Number.isFinite(coalesceMs) ? Math.max(0, coalesceMs) : DEFAULT_COALESCE_MS;
  const dueAt = Date.now() + delay;
  if (timer) {
    // Keep retry cooldown as a hard minimum delay to prevent collapsing backoff.
    if (timerKind === "retry") {
      return;
    }
    // If existing timer fires sooner or at the same time, keep it.
    if (typeof timerDueAt === "number" && timerDueAt <= dueAt) {
      return;
    }
    // New request needs to fire sooner — preempt the existing timer.
    clearTimeout(timer);
    timer = null;
    timerDueAt = null;
    timerKind = null;
  }
  timerDueAt = dueAt;
  timerKind = kind;
  timer = setTimeout(async () => {
    timer = null;
    timerDueAt = null;
    timerKind = null;
    scheduled = false;
    const active = handler;
    if (!active) return;
    if (running) {
      scheduled = true;
      schedule(delay, kind);
      return;
    }

    const reason = pendingReason;
    pendingReason = null;
    running = true;
    try {
      const res = await active({ reason: reason ?? undefined });
      if (res.status === "skipped" && res.reason === "requests-in-flight") {
        // The main lane is busy; retry soon.
        pendingReason = reason ?? "retry";
        schedule(DEFAULT_RETRY_MS, "retry");
      }
    } catch {
      // Error is already logged by the heartbeat runner; schedule a retry.
      pendingReason = reason ?? "retry";
      schedule(DEFAULT_RETRY_MS, "retry");
    } finally {
      running = false;
      if (pendingReason || scheduled) {
        schedule(delay, "normal");
      }
    }
  }, delay);
  timer.unref?.();
}

/**
 * Register (or clear) the heartbeat wake handler.
 * Returns a disposer function that clears this specific registration.
 * Stale disposers (from previous registrations) are no-ops, preventing
 * a race where an old runner's cleanup clears a newer runner's handler.
 */
export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null): () => void {
  handlerGeneration += 1;
  const generation = handlerGeneration;
  handler = next;
  if (handler && pendingReason) {
    schedule(DEFAULT_COALESCE_MS, "normal");
  }
  return () => {
    if (handlerGeneration !== generation) {
      return;
    }
    if (handler !== next) {
      return;
    }
    handlerGeneration += 1;
    handler = null;
  };
}

export function requestHeartbeatNow(opts?: { reason?: string; coalesceMs?: number }) {
  pendingReason = opts?.reason ?? pendingReason ?? "requested";
  schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS, "normal");
}

export function hasHeartbeatWakeHandler() {
  return handler !== null;
}

export function hasPendingHeartbeatWake() {
  return pendingReason !== null || Boolean(timer) || scheduled;
}

/**
 * Reset heartbeat wake state after an in-process restart. Clears the
 * running flag left behind by an interrupted heartbeat turn so subsequent
 * wake requests are not blocked indefinitely.
 */
export function resetHeartbeatWakeState(): void {
  running = false;
  scheduled = false;
  pendingReason = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
    timerDueAt = null;
    timerKind = null;
  }
}

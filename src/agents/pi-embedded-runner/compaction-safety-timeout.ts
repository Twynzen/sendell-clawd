import type { SendellConfig } from "../../config/config.js";

export const EMBEDDED_COMPACTION_TIMEOUT_MS = 900_000;

const MAX_SAFE_TIMEOUT_MS = 2_147_000_000;

export function resolveCompactionTimeoutMs(cfg?: SendellConfig): number {
  const raw = cfg?.agents?.defaults?.compaction?.timeoutSeconds;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw) * 1000, MAX_SAFE_TIMEOUT_MS);
  }
  return EMBEDDED_COMPACTION_TIMEOUT_MS;
}

export async function compactWithSafetyTimeout<T>(
  compact: () => Promise<T>,
  timeoutMs: number = EMBEDDED_COMPACTION_TIMEOUT_MS,
  opts?: {
    onCancel?: () => void;
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        opts?.onCancel?.();
      } catch {
        // Best-effort cancellation hook — keep the timeout path intact even if it throws.
      }
      reject(new Error(`Compaction timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    compact().then(
      (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result);
      },
      (err: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

import { EnvHttpProxyAgent, type Dispatcher } from "undici";
import { getLogger } from "../../logging/logger.js";
import {
  closeDispatcher,
  createPinnedDispatcher,
  resolvePinnedHostnameWithPolicy,
  SsrFBlockedError,
  type SsrFPolicy,
} from "./ssrf.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const GUARDED_FETCH_MODE = {
  STRICT: "strict",
  TRUSTED_ENV_PROXY: "trusted_env_proxy",
} as const;

export type GuardedFetchMode = (typeof GUARDED_FETCH_MODE)[keyof typeof GUARDED_FETCH_MODE];

export type GuardedFetchOptions = {
  url: string;
  fetchImpl?: FetchLike;
  init?: RequestInit;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  policy?: SsrFPolicy;
  mode?: GuardedFetchMode;
  pinDns?: boolean;
  auditContext?: string;
};

export type GuardedFetchResult = {
  response: Response;
  finalUrl: string;
  release: () => Promise<void>;
};

type GuardedFetchPresetOptions = Omit<GuardedFetchOptions, "mode">;

const DEFAULT_MAX_REDIRECTS = 3;
const CROSS_ORIGIN_REDIRECT_SAFE_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-language",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "pragma",
  "range",
  "user-agent",
]);

export function withStrictGuardedFetchMode(params: GuardedFetchPresetOptions): GuardedFetchOptions {
  return { ...params, mode: GUARDED_FETCH_MODE.STRICT };
}

export function withTrustedEnvProxyGuardedFetchMode(
  params: GuardedFetchPresetOptions,
): GuardedFetchOptions {
  return { ...params, mode: GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function retainSafeHeadersForCrossOriginRedirect(init?: RequestInit): RequestInit | undefined {
  if (!init?.headers) return init;
  const incoming = new Headers(init.headers);
  const headers = new Headers();
  for (const [key, value] of incoming.entries()) {
    if (CROSS_ORIGIN_REDIRECT_SAFE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  return { ...init, headers };
}

function buildAbortSignal(params: { timeoutMs?: number; signal?: AbortSignal }): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const { timeoutMs, signal } = params;
  if (!timeoutMs && !signal) return { signal: undefined, cleanup: () => {} };

  if (!timeoutMs) return { signal, cleanup: () => {} };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

export async function fetchWithSsrFGuard(params: GuardedFetchOptions): Promise<GuardedFetchResult> {
  const fetcher: FetchLike = params.fetchImpl ?? globalThis.fetch;
  const maxRedirects = params.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const mode = params.mode ?? GUARDED_FETCH_MODE.STRICT;

  const { signal, cleanup } = buildAbortSignal({
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });

  let released = false;
  const release = async (dispatcher?: Dispatcher | null) => {
    if (released) return;
    released = true;
    cleanup();
    await closeDispatcher(dispatcher);
  };

  const visited = new Set<string>();
  let currentUrl = params.url;
  let currentInit = params.init ? { ...params.init } : undefined;
  let redirectCount = 0;

  const logger = getLogger();

  while (true) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      await release();
      throw new Error("Invalid URL: must be http or https");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      await release();
      throw new Error("Invalid URL: must be http or https");
    }

    let dispatcher: Dispatcher | null = null;
    try {
      const pinned = await resolvePinnedHostnameWithPolicy(parsedUrl.hostname, {
        policy: params.policy,
      });

      if (mode === GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY && (process.env.HTTP_PROXY || process.env.HTTPS_PROXY)) {
        dispatcher = new EnvHttpProxyAgent();
      } else if (params.pinDns !== false) {
        dispatcher = createPinnedDispatcher(pinned);
      }

      const init: RequestInit & { dispatcher?: Dispatcher } = {
        ...currentInit,
        redirect: "manual",
        ...(dispatcher ? { dispatcher } : {}),
        ...(signal ? { signal } : {}),
      };

      const response = await fetcher(parsedUrl.toString(), init);

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          await release(dispatcher);
          throw new Error(`Redirect missing location header (${response.status})`);
        }
        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          await release(dispatcher);
          throw new Error(`Too many redirects (limit: ${maxRedirects})`);
        }
        const nextParsedUrl = new URL(location, parsedUrl);
        const nextUrl = nextParsedUrl.toString();
        if (visited.has(nextUrl)) {
          await release(dispatcher);
          throw new Error("Redirect loop detected");
        }
        if (nextParsedUrl.origin !== parsedUrl.origin) {
          currentInit = retainSafeHeadersForCrossOriginRedirect(currentInit);
        }
        visited.add(nextUrl);
        void response.body?.cancel();
        await closeDispatcher(dispatcher);
        currentUrl = nextUrl;
        continue;
      }

      return {
        response,
        finalUrl: currentUrl,
        release: () => release(dispatcher),
      };
    } catch (err) {
      if (err instanceof SsrFBlockedError) {
        const context = params.auditContext ?? "url-fetch";
        logger.warn(`security: blocked URL fetch (${context}) target=${parsedUrl.origin}${parsedUrl.pathname} reason=${err.message}`);
      }
      await release(dispatcher);
      throw err;
    }
  }
}

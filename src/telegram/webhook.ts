import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { webhookCallback } from "grammy";
import type { SendellConfig } from "../config/config.js";
import { isDiagnosticsEnabled } from "../infra/diagnostic-events.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import {
  logWebhookError,
  logWebhookProcessed,
  logWebhookReceived,
  startDiagnosticHeartbeat,
  stopDiagnosticHeartbeat,
} from "../logging/diagnostic.js";
import { resolveTelegramAllowedUpdates } from "./allowed-updates.js";
import { createTelegramBot } from "./bot.js";

function hasValidTelegramWebhookSecret(
  header: string | string[] | undefined,
  expectedSecret: string,
): boolean {
  const value = Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value, "utf-8");
  const expected = Buffer.from(expectedSecret, "utf-8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function startTelegramWebhook(opts: {
  token: string;
  accountId?: string;
  config?: SendellConfig;
  path?: string;
  port?: number;
  host?: string;
  secret?: string;
  runtime?: RuntimeEnv;
  fetch?: typeof fetch;
  abortSignal?: AbortSignal;
  healthPath?: string;
  publicUrl?: string;
}) {
  const path = opts.path ?? "/telegram-webhook";
  const healthPath = opts.healthPath ?? "/healthz";
  const port = opts.port ?? 8787;
  const host = opts.host ?? "0.0.0.0";
  const runtime = opts.runtime ?? defaultRuntime;
  const diagnosticsEnabled = isDiagnosticsEnabled(opts.config);
  const bot = createTelegramBot({
    token: opts.token,
    runtime,
    proxyFetch: opts.fetch,
    config: opts.config,
    accountId: opts.accountId,
  });
  const handler = webhookCallback(bot, "http", {
    secretToken: opts.secret,
  });

  if (diagnosticsEnabled) {
    startDiagnosticHeartbeat();
  }

  const server = createServer((req, res) => {
    if (req.url === healthPath) {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (req.url !== path || req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }
    // Validate secret token BEFORE reading the request body (GHSA-jq3f-vjww-8rq7).
    // Rejecting early prevents unauthenticated callers from forcing body reads.
    if (opts.secret && !hasValidTelegramWebhookSecret(req.headers["x-telegram-bot-api-secret-token"], opts.secret)) {
      res.shouldKeepAlive = false;
      res.setHeader("Connection", "close");
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }
    const startTime = Date.now();
    if (diagnosticsEnabled) {
      logWebhookReceived({ channel: "telegram", updateType: "telegram-post" });
    }
    const handled = handler(req, res);
    if (handled && typeof (handled as Promise<void>).catch === "function") {
      void (handled as Promise<void>)
        .then(() => {
          if (diagnosticsEnabled) {
            logWebhookProcessed({
              channel: "telegram",
              updateType: "telegram-post",
              durationMs: Date.now() - startTime,
            });
          }
        })
        .catch((err) => {
          const errMsg = formatErrorMessage(err);
          if (diagnosticsEnabled) {
            logWebhookError({
              channel: "telegram",
              updateType: "telegram-post",
              error: errMsg,
            });
          }
          runtime.log?.(`webhook handler failed: ${errMsg}`);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
    }
  });

  const publicUrl =
    opts.publicUrl ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}${path}`;

  await bot.api.setWebhook(publicUrl, {
    secret_token: opts.secret,
    allowed_updates: resolveTelegramAllowedUpdates(),
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  runtime.log?.(`webhook listening on ${publicUrl}`);

  const shutdown = () => {
    server.close();
    void bot.stop();
    if (diagnosticsEnabled) {
      stopDiagnosticHeartbeat();
    }
  };
  if (opts.abortSignal) {
    opts.abortSignal.addEventListener("abort", shutdown, { once: true });
  }

  return { server, bot, stop: shutdown };
}

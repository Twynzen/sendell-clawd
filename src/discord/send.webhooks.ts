import { createDiscordClient } from "./send.shared.js";
import type { DiscordReactOpts } from "./send.types.js";

const WEBHOOK_NAME = "Sendell Proxy";
const DISCORD_TEXT_LIMIT = 2000;

type WebhookInfo = { id: string; token: string };

/** Channel-ID → webhook cache (avoids repeated list+create calls). */
const webhookCache = new Map<string, WebhookInfo>();

async function getOrCreateWebhook(
  channelId: string,
  opts: DiscordReactOpts = {},
): Promise<WebhookInfo> {
  const cached = webhookCache.get(channelId);
  if (cached) return cached;

  const { rest, request } = createDiscordClient(opts);

  const webhooks = (await request(
    () =>
      rest.get(`/channels/${channelId}/webhooks`) as Promise<
        Array<{ id: string; token?: string; name: string | null }>
      >,
    "list-webhooks",
  )) as Array<{ id: string; token?: string; name: string | null }>;

  const existing = webhooks?.find((w) => w.name === WEBHOOK_NAME && w.token);
  if (existing) {
    const info: WebhookInfo = { id: existing.id, token: existing.token! };
    webhookCache.set(channelId, info);
    return info;
  }

  const created = (await request(
    () =>
      rest.post(`/channels/${channelId}/webhooks`, {
        body: { name: WEBHOOK_NAME },
      }) as Promise<{ id: string; token?: string }>,
    "create-webhook",
  )) as { id: string; token?: string };

  if (!created?.id || !created?.token) {
    throw new Error(
      `Failed to create webhook in channel ${channelId}. Make sure the bot has MANAGE_WEBHOOKS permission.`,
    );
  }

  const info: WebhookInfo = { id: created.id, token: created.token };
  webhookCache.set(channelId, info);
  return info;
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf("\n", maxLength);
    if (breakAt <= 0) breakAt = maxLength;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^\n/, "");
  }
  return chunks;
}

export async function sendWebhookMessageDiscord(
  channelId: string,
  content: string,
  opts: DiscordReactOpts & { username?: string; avatarUrl?: string } = {},
): Promise<{ ok: true; webhookId: string }> {
  if (!content?.trim()) {
    throw new Error("Message content is required for webhook sends.");
  }

  // Normalize literal \n sequences the model may emit
  content = content.replaceAll("\\n", "\n");

  const webhook = await getOrCreateWebhook(channelId, opts);
  const url = `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}`;

  const chunks =
    content.length > DISCORD_TEXT_LIMIT ? chunkText(content, DISCORD_TEXT_LIMIT) : [content];

  for (const chunk of chunks) {
    const body: Record<string, unknown> = { content: chunk };
    if (opts.username) body.username = opts.username;
    if (opts.avatarUrl) body.avatar_url = opts.avatarUrl;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      // If webhook was deleted, clear cache and retry
      if (response.status === 404) {
        webhookCache.delete(channelId);
      }
      throw new Error(`Webhook send failed (${response.status}): ${errorText}`);
    }
  }

  return { ok: true, webhookId: webhook.id };
}

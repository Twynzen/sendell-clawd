import { fetchChannelInfoDiscord } from "./send.guild.js";
import { isThreadChannelType } from "./send.permissions.js";
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

  // Detect if channelId is a thread/forum post — webhooks must be created
  // on the parent channel, then executed with ?thread_id= query parameter.
  let webhookChannelId = channelId;
  let threadId: string | undefined;

  try {
    const channelInfo = await fetchChannelInfoDiscord(channelId, opts);

    // Forum/media channels (type 15, 16) can't receive webhooks directly —
    // the agent must target a specific thread/post within the forum.
    const FORUM_CHANNEL_TYPES = [15, 16]; // GuildForum, GuildMedia
    if (FORUM_CHANNEL_TYPES.includes(channelInfo.type)) {
      throw new Error(
        `Channel ${channelId} is a forum channel. Webhook sends to forum channels require a specific thread/post ID as the "to" parameter, not the forum channel ID itself. Use the thread ID from the forum post URL.`,
      );
    }

    if (isThreadChannelType(channelInfo.type)) {
      const parentId = (channelInfo as unknown as { parent_id?: string }).parent_id;
      if (parentId) {
        webhookChannelId = parentId;
        threadId = channelId;
      }
    }
  } catch (err) {
    // Re-throw forum channel errors so the agent gets a clear message
    if (err instanceof Error && err.message.includes("forum channel")) throw err;
    // Other lookup failures — fall through to original behavior
  }

  const webhook = await getOrCreateWebhook(webhookChannelId, opts);
  let url = `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}`;
  if (threadId) {
    url += `?thread_id=${threadId}`;
  }

  const chunks =
    content.length > DISCORD_TEXT_LIMIT ? chunkText(content, DISCORD_TEXT_LIMIT) : [content];

  for (const chunk of chunks) {
    const body: Record<string, unknown> = {
      content: chunk,
      allowed_mentions: { parse: ["users", "roles"] },
    };
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
        webhookCache.delete(webhookChannelId);
      }
      throw new Error(`Webhook send failed (${response.status}): ${errorText}`);
    }
  }

  return { ok: true, webhookId: webhook.id };
}

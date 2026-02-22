import type { Api, Model } from "@mariozechner/pi-ai";
import {
  discoverAuthStorage,
  discoverModels,
  type AuthStorage,
  type ModelRegistry,
} from "../pi-model-discovery.js";

import type { SendellConfig } from "../../config/config.js";
import type { ModelDefinitionConfig } from "../../config/types.js";
import { resolveSendellAgentDir } from "../agent-paths.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { normalizeModelCompat } from "../model-compat.js";
import { normalizeProviderId } from "../model-selection.js";

type InlineModelEntry = ModelDefinitionConfig & { provider: string };

/**
 * Built-in model definitions for models not yet in @mariozechner/pi-ai.
 * When pi-ai updates to include these, the registry entry takes precedence
 * (this map is only consulted as a fallback).
 */
const BUILTIN_MODELS: Record<string, Record<string, Omit<Model<Api>, "provider"> & { provider: string }>> = {
  anthropic: {
    "claude-opus-4-6": {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      api: "anthropic-messages" as Api,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      contextWindow: 200000,
      maxTokens: 128000,
    },
    "claude-sonnet-4-6": {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      api: "anthropic-messages" as Api,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 128000,
    },
  },
};

export function buildInlineProviderModels(
  providers: Record<string, { models?: ModelDefinitionConfig[] }>,
): InlineModelEntry[] {
  return Object.entries(providers).flatMap(([providerId, entry]) => {
    const trimmed = providerId.trim();
    if (!trimmed) return [];
    return (entry?.models ?? []).map((model) => ({ ...model, provider: trimmed }));
  });
}

export function buildModelAliasLines(cfg?: SendellConfig) {
  const models = cfg?.agents?.defaults?.models ?? {};
  const entries: Array<{ alias: string; model: string }> = [];
  for (const [keyRaw, entryRaw] of Object.entries(models)) {
    const model = String(keyRaw ?? "").trim();
    if (!model) continue;
    const alias = String((entryRaw as { alias?: string } | undefined)?.alias ?? "").trim();
    if (!alias) continue;
    entries.push({ alias, model });
  }
  return entries
    .sort((a, b) => a.alias.localeCompare(b.alias))
    .map((entry) => `- ${entry.alias}: ${entry.model}`);
}

export function resolveModel(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: SendellConfig,
): {
  model?: Model<Api>;
  error?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
} {
  const resolvedAgentDir = agentDir ?? resolveSendellAgentDir();
  const authStorage = discoverAuthStorage(resolvedAgentDir);
  const modelRegistry = discoverModels(authStorage, resolvedAgentDir);
  const model = modelRegistry.find(provider, modelId) as Model<Api> | null;
  if (!model) {
    const providers = cfg?.models?.providers ?? {};
    const inlineModels = buildInlineProviderModels(providers);
    const normalizedProvider = normalizeProviderId(provider);
    const inlineMatch = inlineModels.find(
      (entry) => normalizeProviderId(entry.provider) === normalizedProvider && entry.id === modelId,
    );
    if (inlineMatch) {
      const normalized = normalizeModelCompat(inlineMatch as Model<Api>);
      return {
        model: normalized,
        authStorage,
        modelRegistry,
      };
    }
    // Check built-in models for recently released models not yet in pi-ai
    const builtinProvider = BUILTIN_MODELS[normalizedProvider];
    if (builtinProvider?.[modelId]) {
      const builtinModel = normalizeModelCompat(builtinProvider[modelId] as Model<Api>);
      return { model: builtinModel, authStorage, modelRegistry };
    }

    const providerCfg = providers[provider];
    if (providerCfg || modelId.startsWith("mock-")) {
      const fallbackModel: Model<Api> = normalizeModelCompat({
        id: modelId,
        name: modelId,
        api: providerCfg?.api ?? "openai-responses",
        provider,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: providerCfg?.models?.[0]?.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        maxTokens: providerCfg?.models?.[0]?.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
      } as Model<Api>);
      return { model: fallbackModel, authStorage, modelRegistry };
    }
    return {
      error: `Unknown model: ${provider}/${modelId}`,
      authStorage,
      modelRegistry,
    };
  }
  return { model: normalizeModelCompat(model), authStorage, modelRegistry };
}

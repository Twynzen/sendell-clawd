import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { SendellConfig } from "../../config/config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import { exportSnapshot } from "../../memory/snapshot.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

const MemorySaveSchema = Type.Object({
  content: Type.String(),
  category: Type.Optional(
    Type.Union([
      Type.Literal("decision"),
      Type.Literal("discovery"),
      Type.Literal("pattern"),
      Type.Literal("bug"),
      Type.Literal("preference"),
      Type.Literal("note"),
    ]),
  ),
  title: Type.Optional(Type.String()),
});

const MemorySnapshotSchema = Type.Object({
  maxDailyNotes: Type.Optional(Type.Number()),
});

export function createMemorySearchTool(options: {
  config?: SendellConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) return null;
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ results: [], disabled: true, error });
      }
      try {
        const results = await manager.search(query, {
          maxResults,
          minScore,
          sessionKey: options.agentSessionKey,
        });
        const status = manager.status();
        return jsonResult({
          results,
          provider: status.provider,
          model: status.model,
          fallback: status.fallback,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ results: [], disabled: true, error: message });
      }
    },
  };
}

/**
 * Identity files that cannot be read via memory_get.
 * These files define the agent's core identity and rules — allowing
 * the agent to read them via the memory tool could enable prompt
 * injection attacks that modify perceived identity/instructions.
 */
const PROTECTED_IDENTITY_FILES = new Set([
  "soul.md",
  "agents.md",
  "identity.md",
  "user.md",
  "tools.md",
  "heartbeat.md",
  "bootstrap.md",
]);

function isProtectedIdentityFile(relPath: string): boolean {
  const basename = relPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return PROTECTED_IDENTITY_FILES.has(basename);
}

export function createMemoryGetTool(options: {
  config?: SendellConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) return null;
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      if (isProtectedIdentityFile(relPath)) {
        return jsonResult({
          path: relPath,
          text: "",
          error: "Access denied: identity files (SOUL.md, AGENTS.md, etc.) cannot be read via memory_get",
        });
      }
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ path: relPath, text: "", disabled: true, error });
      }
      try {
        const result = await manager.readFile({
          relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
        });
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, text: "", disabled: true, error: message });
      }
    },
  };
}

/**
 * Content-hash dedup window: skip saves with identical content within this period.
 */
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function createMemorySaveTool(options: {
  config?: SendellConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) return null;
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  return {
    label: "Memory Save",
    name: "memory_save",
    description:
      "Persist a note to the agent's memory (memory/YYYY-MM-DD.md). Use for important decisions, discoveries, patterns, bugs, or user preferences that should survive across sessions. Content-hash dedup prevents duplicates within 1 hour.",
    parameters: MemorySaveSchema,
    execute: async (_toolCallId, params) => {
      const content = readStringParam(params, "content", { required: true });
      const category = readStringParam(params, "category") ?? "note";
      const title = readStringParam(params, "title") ?? category;

      const memoryDir = path.join(workspaceDir, "memory");
      const dateStr = todayDateStr();
      const filePath = path.join(memoryDir, `${dateStr}.md`);

      try {
        // Ensure memory/ directory exists
        await fs.mkdir(memoryDir, { recursive: true });

        // Content-hash dedup: check if identical content was saved recently
        const hash = contentHash(content);
        const dedupPath = path.join(memoryDir, ".dedup-hashes.json");
        let dedupMap: Record<string, number> = {};
        try {
          const raw = await fs.readFile(dedupPath, "utf-8");
          dedupMap = JSON.parse(raw);
        } catch {
          // No dedup file yet — that's fine
        }

        const now = Date.now();
        const lastSeen = dedupMap[hash];
        if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
          return jsonResult({
            saved: false,
            reason: "duplicate",
            path: `memory/${dateStr}.md`,
            hash,
          });
        }

        // Build the entry
        const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
        const entry = `### [${category}] ${title}\n_${timestamp}_\n\n${content}\n\n---\n`;

        // Append to today's file
        let existing = "";
        try {
          existing = await fs.readFile(filePath, "utf-8");
        } catch {
          // File doesn't exist yet — will create
        }

        const separator = existing && !existing.endsWith("\n") ? "\n" : "";
        await fs.writeFile(filePath, existing + separator + entry, "utf-8");

        // Update dedup map (clean old entries while we're at it)
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(dedupMap)) {
          if (now - v < DEDUP_WINDOW_MS) cleaned[k] = v;
        }
        cleaned[hash] = now;
        await fs.writeFile(dedupPath, JSON.stringify(cleaned), "utf-8");

        return jsonResult({
          saved: true,
          path: `memory/${dateStr}.md`,
          category,
          title,
          hash,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ saved: false, error: message });
      }
    },
  };
}

export function createMemorySnapshotTool(options: {
  config?: SendellConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) return null;
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  return {
    label: "Memory Snapshot",
    name: "memory_snapshot",
    description:
      "Export a portable snapshot of MEMORY.md + recent daily notes to MEMORY_SNAPSHOT.md. Useful before container migrations or as a backup. The snapshot can auto-hydrate on cold boot.",
    parameters: MemorySnapshotSchema,
    execute: async (_toolCallId, params) => {
      const maxDailyNotes = readNumberParam(params, "maxDailyNotes") ?? 7;
      try {
        const result = await exportSnapshot({ workspaceDir, maxDailyNotes });
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

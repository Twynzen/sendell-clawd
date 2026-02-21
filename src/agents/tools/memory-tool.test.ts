import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../memory/index.js", () => {
  return {
    getMemorySearchManager: async () => {
      return {
        manager: {
          search: async () => [],
          readFile: async (opts: { relPath: string }) => ({
            path: opts.relPath,
            text: "mock content",
          }),
          status: () => ({
            files: 0,
            chunks: 0,
            dirty: false,
            workspaceDir: "/tmp",
            dbPath: "/tmp/index.sqlite",
            provider: "local",
            model: "local",
            requestedProvider: "local",
          }),
        },
      };
    },
  };
});

import { createMemoryGetTool, createMemorySaveTool } from "./memory-tool.js";

const baseCfg = {
  agents: {
    defaults: {
      memorySearch: { enabled: true, provider: "local" as const },
      workspace: "",
    },
    list: [{ id: "main", default: true }],
  },
};

describe("PR2 — Identity file protection", () => {
  it("blocks memory_get for SOUL.md", async () => {
    const tool = createMemoryGetTool({ config: baseCfg });
    expect(tool).not.toBeNull();
    const result = await tool!.execute("call_1", { path: "SOUL.md" });
    expect(result.details).toMatchObject({
      text: "",
      error: expect.stringContaining("Access denied"),
    });
  });

  it("blocks memory_get for AGENTS.md (case-insensitive)", async () => {
    const tool = createMemoryGetTool({ config: baseCfg });
    const result = await tool!.execute("call_2", { path: "agents.md" });
    expect(result.details).toMatchObject({
      text: "",
      error: expect.stringContaining("Access denied"),
    });
  });

  it("blocks identity files in subdirectories", async () => {
    const tool = createMemoryGetTool({ config: baseCfg });
    const result = await tool!.execute("call_3", { path: "some/deep/path/IDENTITY.md" });
    expect(result.details).toMatchObject({
      text: "",
      error: expect.stringContaining("Access denied"),
    });
  });

  it("blocks all protected files: user.md, tools.md, heartbeat.md, bootstrap.md", async () => {
    const tool = createMemoryGetTool({ config: baseCfg });
    for (const file of ["USER.md", "TOOLS.md", "HEARTBEAT.md", "BOOTSTRAP.md"]) {
      const result = await tool!.execute(`call_${file}`, { path: file });
      expect(result.details).toMatchObject({ error: expect.stringContaining("Access denied") });
    }
  });

  it("allows normal memory files", async () => {
    const tool = createMemoryGetTool({ config: baseCfg });
    const result = await tool!.execute("call_ok", { path: "memory/2026-02-21.md" });
    expect(result.details).toMatchObject({
      path: "memory/2026-02-21.md",
      text: "mock content",
    });
  });

  it("allows MEMORY.md (not in protected list)", async () => {
    const tool = createMemoryGetTool({ config: baseCfg });
    const result = await tool!.execute("call_mem", { path: "MEMORY.md" });
    expect(result.details).toMatchObject({
      path: "MEMORY.md",
      text: "mock content",
    });
  });
});

describe("PR3 — Memory save tool", () => {
  let tmpDir: string;
  let saveCfg: typeof baseCfg;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendell-test-"));
    saveCfg = {
      agents: {
        defaults: {
          memorySearch: { enabled: true, provider: "local" as const },
          workspace: tmpDir,
        },
        list: [{ id: "main", default: true }],
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates memory_save tool when config is valid", () => {
    const tool = createMemorySaveTool({ config: saveCfg });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("memory_save");
  });

  it("saves structured entry with correct format", async () => {
    const tool = createMemorySaveTool({ config: saveCfg });
    const result = await tool!.execute("call_save", {
      content: "Found that RRF works better than weighted averaging",
      category: "discovery",
      title: "RRF superiority",
    });

    expect(result.details).toMatchObject({
      saved: true,
      category: "discovery",
      title: "RRF superiority",
    });

    // Check the file was created
    const memDir = path.join(tmpDir, "memory");
    const files = await fs.readdir(memDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles).toHaveLength(1);

    // Check file format
    const content = await fs.readFile(path.join(memDir, mdFiles[0]), "utf-8");
    expect(content).toContain("### [discovery] RRF superiority");
    expect(content).toContain("Found that RRF works better than weighted averaging");
    expect(content).toContain("---");
  });

  it("writes to correct daily file (YYYY-MM-DD.md)", async () => {
    const tool = createMemorySaveTool({ config: saveCfg });
    await tool!.execute("call_date", {
      content: "test content",
    });

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const expected = `${y}-${m}-${d}.md`;

    const memDir = path.join(tmpDir, "memory");
    const files = await fs.readdir(memDir);
    expect(files).toContain(expected);
  });

  it("defaults category to 'note' and title to category", async () => {
    const tool = createMemorySaveTool({ config: saveCfg });
    const result = await tool!.execute("call_defaults", {
      content: "Some quick note",
    });

    expect(result.details).toMatchObject({
      saved: true,
      category: "note",
      title: "note",
    });

    const memDir = path.join(tmpDir, "memory");
    const files = await fs.readdir(memDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const content = await fs.readFile(path.join(memDir, mdFiles[0]), "utf-8");
    expect(content).toContain("### [note] note");
  });

  it("dedup: second save with identical content within 1h returns duplicate", async () => {
    const tool = createMemorySaveTool({ config: saveCfg });

    const r1 = await tool!.execute("call_1", {
      content: "Identical content for dedup test",
      category: "bug",
      title: "test dedup",
    });
    expect(r1.details).toMatchObject({ saved: true });

    const r2 = await tool!.execute("call_2", {
      content: "Identical content for dedup test",
      category: "bug",
      title: "test dedup",
    });
    expect(r2.details).toMatchObject({
      saved: false,
      reason: "duplicate",
    });
  });

  it("allows saving different content", async () => {
    const tool = createMemorySaveTool({ config: saveCfg });

    const r1 = await tool!.execute("call_1", {
      content: "First unique content",
      category: "decision",
    });
    expect(r1.details).toMatchObject({ saved: true });

    const r2 = await tool!.execute("call_2", {
      content: "Second unique content",
      category: "pattern",
    });
    expect(r2.details).toMatchObject({ saved: true });

    // Both should be in the file
    const memDir = path.join(tmpDir, "memory");
    const files = await fs.readdir(memDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const content = await fs.readFile(path.join(memDir, mdFiles[0]), "utf-8");
    expect(content).toContain("First unique content");
    expect(content).toContain("Second unique content");
  });

  it("accepts all valid categories", async () => {
    const tool = createMemorySaveTool({ config: saveCfg });
    for (const cat of ["decision", "discovery", "pattern", "bug", "preference", "note"]) {
      const result = await tool!.execute(`call_${cat}`, {
        content: `Content for ${cat}`,
        category: cat,
        title: cat,
      });
      expect(result.details).toMatchObject({ saved: true, category: cat });
    }
  });

  it("returns null when config is missing", () => {
    const tool = createMemorySaveTool({ config: undefined });
    expect(tool).toBeNull();
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHygiene, type HygieneConfig } from "./hygiene.js";

describe("memory hygiene lifecycle (PR4)", () => {
  let tmpDir: string;
  let workspaceDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendell-hygiene-"));
    workspaceDir = path.join(tmpDir, "workspace");
    stateDir = path.join(tmpDir, "state");
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const defaultConfig: HygieneConfig = {
    enabled: true,
    archiveDays: 30,
    purgeDays: 90,
  };

  function dateStr(daysAgo: number): string {
    const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function createMemoryFile(filename: string, content = "test") {
    await fs.writeFile(path.join(workspaceDir, "memory", filename), content);
  }

  async function createArchivedFile(filename: string, content = "test") {
    const dir = path.join(workspaceDir, "memory", "archive");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), content);
  }

  it("archives daily notes older than archiveDays", async () => {
    const oldFile = `${dateStr(35)}.md`;
    const recentFile = `${dateStr(5)}.md`;
    await createMemoryFile(oldFile, "old content");
    await createMemoryFile(recentFile, "recent content");

    const result = await runHygiene({
      workspaceDir,
      config: defaultConfig,
      stateDir,
      force: true,
    });

    expect(result.archived).toContain(oldFile);
    expect(result.archived).not.toContain(recentFile);

    // Old file should be in archive
    const archiveFiles = await fs.readdir(path.join(workspaceDir, "memory", "archive"));
    expect(archiveFiles).toContain(oldFile);

    // Recent file should still be in memory/
    const memoryFiles = await fs.readdir(path.join(workspaceDir, "memory"));
    expect(memoryFiles).toContain(recentFile);

    // Archived file content preserved
    const content = await fs.readFile(
      path.join(workspaceDir, "memory", "archive", oldFile),
      "utf-8",
    );
    expect(content).toBe("old content");
  });

  it("purges archived files older than purgeDays", async () => {
    const veryOldFile = `${dateStr(100)}.md`;
    const moderateOldFile = `${dateStr(50)}.md`;
    await createArchivedFile(veryOldFile, "very old");
    await createArchivedFile(moderateOldFile, "moderate old");

    const result = await runHygiene({
      workspaceDir,
      config: defaultConfig,
      stateDir,
      force: true,
    });

    expect(result.purged).toContain(veryOldFile);
    expect(result.purged).not.toContain(moderateOldFile);

    const archiveFiles = await fs.readdir(path.join(workspaceDir, "memory", "archive"));
    expect(archiveFiles).not.toContain(veryOldFile);
    expect(archiveFiles).toContain(moderateOldFile);
  });

  it("skips when disabled", async () => {
    await createMemoryFile(`${dateStr(35)}.md`);
    const result = await runHygiene({
      workspaceDir,
      config: { ...defaultConfig, enabled: false },
      stateDir,
      force: true,
    });
    expect(result.skipped).toBe(true);
    expect(result.archived).toHaveLength(0);
  });

  it("throttles to once per 24 hours", async () => {
    await createMemoryFile(`${dateStr(35)}.md`);

    // First run: should execute
    const r1 = await runHygiene({ workspaceDir, config: defaultConfig, stateDir });
    expect(r1.skipped).toBe(false);

    // Second run: should skip (within 24h)
    const r2 = await runHygiene({ workspaceDir, config: defaultConfig, stateDir });
    expect(r2.skipped).toBe(true);
  });

  it("force=true bypasses throttle", async () => {
    await createMemoryFile(`${dateStr(35)}.md`);

    await runHygiene({ workspaceDir, config: defaultConfig, stateDir });

    // Add another old file
    await createMemoryFile(`${dateStr(40)}.md`);

    const r2 = await runHygiene({ workspaceDir, config: defaultConfig, stateDir, force: true });
    expect(r2.skipped).toBe(false);
    expect(r2.archived).toHaveLength(1);
  });

  it("ignores non-daily-note files", async () => {
    await createMemoryFile("MEMORY.md", "important");
    await createMemoryFile("aprendizajes.md", "learning");
    await createMemoryFile(".dedup-hashes.json", "{}");

    const result = await runHygiene({
      workspaceDir,
      config: defaultConfig,
      stateDir,
      force: true,
    });

    expect(result.archived).toHaveLength(0);
    expect(result.purged).toHaveLength(0);

    // Original files should still exist
    const files = await fs.readdir(path.join(workspaceDir, "memory"));
    expect(files).toContain("MEMORY.md");
    expect(files).toContain("aprendizajes.md");
  });

  it("handles empty memory directory", async () => {
    const result = await runHygiene({
      workspaceDir,
      config: defaultConfig,
      stateDir,
      force: true,
    });
    expect(result.archived).toHaveLength(0);
    expect(result.purged).toHaveLength(0);
    expect(result.skipped).toBe(false);
  });

  it("respects custom archiveDays and purgeDays", async () => {
    // With archiveDays=7, a 10-day-old file should be archived
    await createMemoryFile(`${dateStr(10)}.md`);
    // With archiveDays=7, a 3-day-old file should NOT be archived
    await createMemoryFile(`${dateStr(3)}.md`);

    const result = await runHygiene({
      workspaceDir,
      config: { enabled: true, archiveDays: 7, purgeDays: 30 },
      stateDir,
      force: true,
    });

    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]).toBe(`${dateStr(10)}.md`);
  });
});

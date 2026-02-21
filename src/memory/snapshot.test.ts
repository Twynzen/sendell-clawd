import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { exportSnapshot, hydrateFromSnapshot } from "./snapshot.js";

describe("memory snapshot/hydration (PR6)", () => {
  let tmpDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sendell-snapshot-"));
    workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("exportSnapshot", () => {
    it("exports MEMORY.md as core memory section", async () => {
      await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Core knowledge here");
      const result = await exportSnapshot({ workspaceDir });

      expect(result.sections).toBe(1);
      const snapshot = await fs.readFile(path.join(workspaceDir, "MEMORY_SNAPSHOT.md"), "utf-8");
      expect(snapshot).toContain("# Core Memory (MEMORY.md)");
      expect(snapshot).toContain("Core knowledge here");
    });

    it("includes recent daily notes", async () => {
      await fs.writeFile(path.join(workspaceDir, "memory", "2026-02-20.md"), "Day 20 notes");
      await fs.writeFile(path.join(workspaceDir, "memory", "2026-02-19.md"), "Day 19 notes");
      const result = await exportSnapshot({ workspaceDir });

      expect(result.sections).toBe(2);
      const snapshot = await fs.readFile(path.join(workspaceDir, "MEMORY_SNAPSHOT.md"), "utf-8");
      expect(snapshot).toContain("# Daily Notes: 2026-02-20");
      expect(snapshot).toContain("Day 20 notes");
      expect(snapshot).toContain("# Daily Notes: 2026-02-19");
    });

    it("limits daily notes to maxDailyNotes", async () => {
      for (let i = 1; i <= 10; i++) {
        const d = String(i).padStart(2, "0");
        await fs.writeFile(path.join(workspaceDir, "memory", `2026-02-${d}.md`), `Day ${i}`);
      }

      const result = await exportSnapshot({ workspaceDir, maxDailyNotes: 3 });
      expect(result.sections).toBe(3);

      const snapshot = await fs.readFile(path.join(workspaceDir, "MEMORY_SNAPSHOT.md"), "utf-8");
      // Should have most recent 3
      expect(snapshot).toContain("2026-02-10");
      expect(snapshot).toContain("2026-02-09");
      expect(snapshot).toContain("2026-02-08");
      // Should NOT have older ones
      expect(snapshot).not.toContain("2026-02-01");
    });

    it("combines MEMORY.md + daily notes", async () => {
      await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Core");
      await fs.writeFile(path.join(workspaceDir, "memory", "2026-02-20.md"), "Daily");
      const result = await exportSnapshot({ workspaceDir });
      expect(result.sections).toBe(2);
    });

    it("handles empty workspace", async () => {
      const result = await exportSnapshot({ workspaceDir });
      expect(result.sections).toBe(0);
    });
  });

  describe("hydrateFromSnapshot", () => {
    it("restores MEMORY.md from snapshot on cold boot", async () => {
      // Create a snapshot
      await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Original core memory");
      await fs.writeFile(path.join(workspaceDir, "memory", "2026-02-20.md"), "Daily note");
      await exportSnapshot({ workspaceDir });

      // Simulate cold boot: remove original files
      await fs.unlink(path.join(workspaceDir, "MEMORY.md"));
      await fs.unlink(path.join(workspaceDir, "memory", "2026-02-20.md"));

      // Non-existent DB path → cold boot
      const dbPath = path.join(tmpDir, "nonexistent.sqlite");
      const result = await hydrateFromSnapshot({ workspaceDir, dbPath });

      expect(result.hydrated).toBe(true);
      expect(result.sections).toBe(2);

      // Check files were restored
      const memory = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf-8");
      expect(memory).toContain("Original core memory");

      const daily = await fs.readFile(path.join(workspaceDir, "memory", "2026-02-20.md"), "utf-8");
      expect(daily).toContain("Daily note");
    });

    it("skips hydration if DB exists (warm boot)", async () => {
      await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Core");
      await exportSnapshot({ workspaceDir });
      await fs.unlink(path.join(workspaceDir, "MEMORY.md"));

      // Create a fake DB file
      const dbPath = path.join(tmpDir, "existing.sqlite");
      await fs.writeFile(dbPath, "fake db");

      const result = await hydrateFromSnapshot({ workspaceDir, dbPath });
      expect(result.hydrated).toBe(false);
    });

    it("does not overwrite existing files", async () => {
      await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Snapshot version");
      await exportSnapshot({ workspaceDir });

      // Write a different MEMORY.md
      await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Current version");

      const dbPath = path.join(tmpDir, "nonexistent.sqlite");
      const result = await hydrateFromSnapshot({ workspaceDir, dbPath });

      // MEMORY.md should NOT be overwritten
      const content = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf-8");
      expect(content).toBe("Current version");
    });

    it("handles missing snapshot gracefully", async () => {
      const dbPath = path.join(tmpDir, "nonexistent.sqlite");
      const result = await hydrateFromSnapshot({ workspaceDir, dbPath });
      expect(result.hydrated).toBe(false);
      expect(result.sections).toBe(0);
    });
  });
});

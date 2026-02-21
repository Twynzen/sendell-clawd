import fs from "node:fs/promises";
import path from "node:path";

const log = {
  info: (...args: unknown[]) => console.log("[memory:snapshot]", ...args),
  warn: (...args: unknown[]) => console.warn("[memory:snapshot]", ...args),
};

const SNAPSHOT_FILE = "MEMORY_SNAPSHOT.md";
const MEMORY_FILE = "MEMORY.md";

/**
 * Export a portable snapshot of core memory files.
 * Combines MEMORY.md + recent daily notes into MEMORY_SNAPSHOT.md.
 */
export async function exportSnapshot(params: {
  workspaceDir: string;
  maxDailyNotes?: number;
}): Promise<{ path: string; sections: number }> {
  const { workspaceDir, maxDailyNotes = 7 } = params;
  const memoryDir = path.join(workspaceDir, "memory");
  const sections: string[] = [];

  // Include MEMORY.md
  const memoryPath = path.join(workspaceDir, MEMORY_FILE);
  try {
    const content = await fs.readFile(memoryPath, "utf-8");
    if (content.trim()) {
      sections.push(`# Core Memory (${MEMORY_FILE})\n\n${content.trim()}`);
    }
  } catch {
    // No MEMORY.md — skip
  }

  // Include recent daily notes (most recent first)
  try {
    const files = await fs.readdir(memoryDir);
    const dailyNotes = files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, maxDailyNotes);

    for (const file of dailyNotes) {
      const content = await fs.readFile(path.join(memoryDir, file), "utf-8");
      if (content.trim()) {
        sections.push(`# Daily Notes: ${file.replace(".md", "")}\n\n${content.trim()}`);
      }
    }
  } catch {
    // No memory/ dir — skip
  }

  const snapshot = sections.join("\n\n---\n\n") + "\n";
  const snapshotPath = path.join(workspaceDir, SNAPSHOT_FILE);
  await fs.writeFile(snapshotPath, snapshot, "utf-8");
  log.info(`exported snapshot: ${sections.length} sections → ${SNAPSHOT_FILE}`);
  return { path: SNAPSHOT_FILE, sections: sections.length };
}

/**
 * Hydrate memory from a snapshot file.
 * Restores MEMORY.md and daily notes from MEMORY_SNAPSHOT.md.
 * Only runs when the SQLite index is missing or empty (cold boot).
 */
export async function hydrateFromSnapshot(params: {
  workspaceDir: string;
  dbPath: string;
}): Promise<{ hydrated: boolean; sections: number }> {
  const { workspaceDir, dbPath } = params;

  // Only hydrate if the index doesn't exist (cold boot scenario)
  try {
    await fs.access(dbPath);
    return { hydrated: false, sections: 0 };
  } catch {
    // Index doesn't exist — proceed with hydration
  }

  const snapshotPath = path.join(workspaceDir, SNAPSHOT_FILE);
  let snapshotContent: string;
  try {
    snapshotContent = await fs.readFile(snapshotPath, "utf-8");
  } catch {
    return { hydrated: false, sections: 0 };
  }

  // Parse sections
  const parts = snapshotContent.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);
  let restoredSections = 0;

  for (const part of parts) {
    const coreMatch = part.match(/^# Core Memory/m);
    const dailyMatch = part.match(/^# Daily Notes: (.+)$/m);
    if (!coreMatch && !dailyMatch) continue;

    const content = part.replace(/^# .+\n\n?/, "").trim();
    if (!content) continue;

    if (coreMatch) {
      const memPath = path.join(workspaceDir, MEMORY_FILE);
      try {
        await fs.access(memPath);
        // MEMORY.md already exists — don't overwrite
      } catch {
        await fs.writeFile(memPath, content + "\n", "utf-8");
        restoredSections++;
        log.info("hydrated MEMORY.md from snapshot");
      }
    } else if (dailyMatch && dailyMatch[1]) {
      const dateStr = dailyMatch[1].trim();
      const memDir = path.join(workspaceDir, "memory");
      const notePath = path.join(memDir, `${dateStr}.md`);
      try {
        await fs.access(notePath);
        // Already exists — skip
      } catch {
        await fs.mkdir(memDir, { recursive: true });
        await fs.writeFile(notePath, content + "\n", "utf-8");
        restoredSections++;
        log.info(`hydrated memory/${dateStr}.md from snapshot`);
      }
    }
  }

  if (restoredSections > 0) {
    log.info(`hydration complete: ${restoredSections} sections restored`);
  }

  return { hydrated: restoredSections > 0, sections: restoredSections };
}

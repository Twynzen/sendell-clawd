import fs from "node:fs/promises";
import path from "node:path";

const log = {
  info: (...args: unknown[]) => console.log("[memory:hygiene]", ...args),
  warn: (...args: unknown[]) => console.warn("[memory:hygiene]", ...args),
};

export type HygieneConfig = {
  enabled: boolean;
  archiveDays: number;
  purgeDays: number;
};

export type HygieneResult = {
  archived: string[];
  purged: string[];
  skipped: boolean;
};

/**
 * Date pattern matching daily memory files like `2026-02-21.md`.
 */
const DAILY_NOTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.md$/;

/**
 * Run memory hygiene: archive old daily notes and purge very old archived files.
 *
 * - Archive: move `memory/YYYY-MM-DD.md` files older than `archiveDays` to `memory/archive/`
 * - Purge: delete `memory/archive/YYYY-MM-DD.md` files older than `purgeDays`
 * - Throttled: runs at most once per 24 hours (state file tracks last run)
 */
export async function runHygiene(params: {
  workspaceDir: string;
  config: HygieneConfig;
  stateDir: string;
  force?: boolean;
}): Promise<HygieneResult> {
  const { workspaceDir, config, stateDir } = params;

  if (!config.enabled) {
    return { archived: [], purged: [], skipped: true };
  }

  // Throttle: check last run time
  const stateFile = path.join(stateDir, "memory-hygiene-state.json");
  if (!params.force) {
    try {
      const raw = await fs.readFile(stateFile, "utf-8");
      const state = JSON.parse(raw) as { lastRunMs?: number };
      if (state.lastRunMs && Date.now() - state.lastRunMs < 24 * 60 * 60 * 1000) {
        return { archived: [], purged: [], skipped: true };
      }
    } catch {
      // No state file or invalid — proceed
    }
  }

  const memoryDir = path.join(workspaceDir, "memory");
  const archiveDir = path.join(memoryDir, "archive");

  const now = Date.now();
  const archiveCutoff = now - config.archiveDays * 24 * 60 * 60 * 1000;
  const purgeCutoff = now - config.purgeDays * 24 * 60 * 60 * 1000;

  const archived: string[] = [];
  const purged: string[] = [];

  // Phase 1: Archive old daily notes from memory/
  try {
    const files = await fs.readdir(memoryDir);
    for (const file of files) {
      const match = file.match(DAILY_NOTE_PATTERN);
      if (!match) continue;
      const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`);
      if (isNaN(fileDate.getTime())) continue;
      if (fileDate.getTime() < archiveCutoff) {
        await fs.mkdir(archiveDir, { recursive: true });
        const src = path.join(memoryDir, file);
        const dst = path.join(archiveDir, file);
        await fs.rename(src, dst);
        archived.push(file);
        log.info(`archived: ${file}`);
      }
    }
  } catch (err) {
    log.warn(`archive phase failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Phase 2: Purge very old archived files
  try {
    const archivedFiles = await fs.readdir(archiveDir);
    for (const file of archivedFiles) {
      const match = file.match(DAILY_NOTE_PATTERN);
      if (!match) continue;
      const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`);
      if (isNaN(fileDate.getTime())) continue;
      if (fileDate.getTime() < purgeCutoff) {
        await fs.unlink(path.join(archiveDir, file));
        purged.push(file);
        log.info(`purged: ${file}`);
      }
    }
  } catch {
    // Archive dir may not exist — that's fine
  }

  // Update state file
  try {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ lastRunMs: now }), "utf-8");
  } catch (err) {
    log.warn(`state write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (archived.length > 0 || purged.length > 0) {
    log.info(`hygiene complete: ${archived.length} archived, ${purged.length} purged`);
  }

  return { archived, purged, skipped: false };
}

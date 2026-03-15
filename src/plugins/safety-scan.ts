/**
 * Lightweight safety scanner for plugin source files.
 * Checks for dangerous code patterns and logs warnings.
 * Does NOT block loading — plugins are treated as trusted code,
 * but warnings help operators catch accidental or malicious patterns.
 */

import fs from "node:fs";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("plugins");

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\beval\s*\(/, description: "eval() — arbitrary code execution" },
  { pattern: /new\s+Function\s*\(/, description: "new Function() — dynamic code execution" },
  {
    pattern: /require\s*\(\s*['"]child_process['"]\s*\)/,
    description: "child_process require — OS command execution",
  },
  {
    pattern: /from\s+['"](?:node:)?child_process['"]/,
    description: "child_process import — OS command execution",
  },
  {
    pattern: /\bfs\s*\.\s*(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/,
    description: "destructive fs operation",
  },
  { pattern: /\bprocess\.exit\s*\(/, description: "process.exit() — terminates daemon" },
  { pattern: /\bprocess\.kill\s*\(/, description: "process.kill() — sends signals to processes" },
  { pattern: /__proto__/, description: "__proto__ — prototype pollution risk" },
];

/**
 * Scans a plugin source file for dangerous code patterns.
 * Logs a warning for each match. Non-blocking.
 */
export function scanPluginSourceFile(filePath: string): void {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return; // unreadable — let jiti handle it
  }

  const hits: string[] = [];
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      hits.push(description);
    }
  }

  if (hits.length > 0) {
    log.warn(`[plugins] safety scan warning: ${filePath}`, { patterns: hits });
  }
}

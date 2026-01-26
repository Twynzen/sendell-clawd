import os from "node:os";
import path from "node:path";
import type { SendellConfig } from "./types.js";

/**
 * Nix mode detection: When SENDELL_NIX_MODE=1, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SENDELL_NIX_MODE === "1";
}

export const isNixMode = resolveIsNixMode();

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via SENDELL_STATE_DIR environment variable.
 * Default: ~/.sendell
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override = env.SENDELL_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(homedir(), ".sendell");
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

export const STATE_DIR_SENDELL = resolveStateDir();

/**
 * Config file path (JSON5).
 * Can be overridden via SENDELL_CONFIG_PATH environment variable.
 * Default: ~/.sendell/sendell.json (or $SENDELL_STATE_DIR/sendell.json)
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.SENDELL_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, "sendell.json");
}

export const CONFIG_PATH_SENDELL = resolveConfigPath();

export const DEFAULT_GATEWAY_PORT = 18789;

/**
 * Gateway lock directory (ephemeral).
 * Default: os.tmpdir()/sendell-<uid> (uid suffix when available).
 */
export function resolveGatewayLockDir(tmpdir: () => string = os.tmpdir): string {
  const base = tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const suffix = uid != null ? `sendell-${uid}` : "sendell";
  return path.join(base, suffix);
}

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `SENDELL_OAUTH_DIR` (explicit override)
 * - `SENDELL_STATE_DIR/credentials` (canonical server/default)
 * - `~/.sendell/credentials` (legacy default)
 */
export function resolveOAuthDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.SENDELL_OAUTH_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, "credentials");
}

export function resolveOAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  return path.join(resolveOAuthDir(env, stateDir), OAUTH_FILENAME);
}

export function resolveGatewayPort(
  cfg?: SendellConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.SENDELL_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}

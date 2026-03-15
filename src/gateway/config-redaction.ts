/**
 * Redacts sensitive values from config objects to prevent credential leakage
 * via config.get RPC or CLI commands.
 *
 * Applies to: gateway config.get handler, CLI config get command.
 */

import type { ConfigFileSnapshot } from "../config/types.sendell.js";

// A key is considered sensitive if its lowercase form matches any of these.
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.endsWith("key") || // apiKey, secretKey, authKey
    lower.includes("token") || // token, botToken, accessToken
    lower.includes("secret") || // secret, webhookSecret
    lower.includes("password") || // password, adminPassword
    lower.includes("passphrase") || // passphrase
    lower.includes("credential") // credential, credentials
  );
}

/** Returns true if any segment of the config path points to a sensitive key. */
export function isSensitivePath(pathSegments: string[]): boolean {
  return pathSegments.some((seg) => isSensitiveKey(seg));
}

/**
 * Recursively walks a config object and replaces string values of sensitive
 * keys with the placeholder "***REDACTED***".
 */
export function redactSensitiveConfig(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveConfig);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveKey(k) && typeof v === "string" && v.length > 0) {
        result[k] = "***REDACTED***";
      } else {
        result[k] = redactSensitiveConfig(v);
      }
    }
    return result;
  }
  return obj;
}

/**
 * Returns a redacted copy of a ConfigFileSnapshot safe to expose via RPC.
 * - raw: omitted (contains full plaintext config including tokens)
 * - parsed: sensitive string values replaced with ***REDACTED***
 * - config: sensitive string values replaced with ***REDACTED***
 */
export function redactConfigSnapshot(
  snapshot: ConfigFileSnapshot,
): Record<string, unknown> {
  return {
    path: snapshot.path,
    exists: snapshot.exists,
    raw: null,
    parsed: redactSensitiveConfig(snapshot.parsed),
    valid: snapshot.valid,
    config: redactSensitiveConfig(snapshot.config),
    hash: snapshot.hash,
    issues: snapshot.issues,
    warnings: snapshot.warnings,
    legacyIssues: snapshot.legacyIssues,
  };
}

import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";

import { Agent, type Dispatcher } from "undici";

export class SsrFBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrFBlockedError";
  }
}

export type LookupFn = typeof dnsLookup;

export type SsrFPolicy = {
  allowPrivateNetwork?: boolean;
  dangerouslyAllowPrivateNetwork?: boolean;
  allowRfc2544BenchmarkRange?: boolean;
  allowedHostnames?: string[];
  hostnameAllowlist?: string[];
};

const PRIVATE_IPV6_PREFIXES = ["fe80:", "fec0:", "fc", "fd"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function normalizeHostnameSet(values?: string[]): Set<string> {
  if (!values || values.length === 0) {
    return new Set<string>();
  }
  return new Set(values.map((value) => normalizeHostname(value)).filter(Boolean));
}

function normalizeHostnameAllowlist(values?: string[]): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeHostname(value))
        .filter((value) => value !== "*" && value !== "*." && value.length > 0),
    ),
  );
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return null;
  return numbers;
}

function parseIpv4FromMappedIpv6(mapped: string): number[] | null {
  if (mapped.includes(".")) {
    return parseIpv4(mapped);
  }
  const parts = mapped.split(":").filter(Boolean);
  if (parts.length === 1) {
    const value = Number.parseInt(parts[0], 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff_ffff) return null;
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  }
  if (parts.length !== 2) return null;
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    high < 0 ||
    low < 0 ||
    high > 0xffff ||
    low > 0xffff
  ) {
    return null;
  }
  const value = (high << 16) + low;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function isPrivateIpv4(parts: number[], policy?: SsrFPolicy): boolean {
  const [octet1, octet2, octet3] = parts;
  if (octet1 === 0) return true;
  if (octet1 === 10) return true; // RFC1918
  if (octet1 === 127) return true; // Loopback
  if (octet1 === 169 && octet2 === 254) return true; // Link-local
  if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true; // RFC1918
  if (octet1 === 192 && octet2 === 168) return true; // RFC1918
  if (octet1 === 100 && octet2 >= 64 && octet2 <= 127) return true; // Carrier-grade NAT

  // RFC2544 Benchmark range: 198.18.0.0/15
  if (octet1 === 198 && (octet2 === 18 || octet2 === 19)) {
    return policy?.allowRfc2544BenchmarkRange !== true;
  }

  return false;
}

export function isPrivateIpAddress(address: string, policy?: SsrFPolicy): boolean {
  let normalized = address.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (!normalized) return false;

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    const ipv4 = parseIpv4FromMappedIpv6(mapped);
    if (ipv4) return isPrivateIpv4(ipv4, policy);
  }

  if (normalized.includes(":")) {
    if (normalized === "::" || normalized === "::1") return true;
    return PRIVATE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  const ipv4 = parseIpv4(normalized);
  if (!ipv4) return false;
  return isPrivateIpv4(ipv4, policy);
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  return (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function matchesHostnameAllowlist(hostname: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  return allowlist.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      if (!suffix || hostname === suffix) return false;
      return hostname.endsWith(`.${suffix}`);
    }
    return hostname === pattern;
  });
}

export function isPrivateNetworkAllowedByPolicy(policy?: SsrFPolicy): boolean {
  return policy?.dangerouslyAllowPrivateNetwork === true || policy?.allowPrivateNetwork === true;
}

export function createPinnedLookup(params: {
  hostname: string;
  addresses: string[];
  fallback?: typeof dnsLookupCb;
}): typeof dnsLookupCb {
  const normalizedHost = normalizeHostname(params.hostname);
  const fallback = (params.fallback ?? dnsLookupCb) as any;
  const records = params.addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  let index = 0;

  return ((host: string, options?: any, callback?: any) => {
    const cb = typeof options === "function" ? options : callback;
    if (!cb) return;

    const normalized = normalizeHostname(host);
    if (!normalized || normalized !== normalizedHost) {
      return fallback(host, options, callback);
    }

    const opts = typeof options === "object" && options !== null ? options : {};
    const requestedFamily = typeof options === "number" ? options : opts.family ?? 0;
    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((r) => r.family === requestedFamily)
        : records;
    const usable = candidates.length > 0 ? candidates : records;

    if (opts.all) {
      cb(null, usable as LookupAddress[]);
      return;
    }

    const chosen = usable[index % usable.length];
    index += 1;
    cb(null, chosen.address, chosen.family);
  }) as any;
}

export type PinnedHostname = {
  hostname: string;
  addresses: string[];
  lookup: typeof dnsLookupCb;
};

function dedupeAndPreferIpv4(results: readonly LookupAddress[]): string[] {
  const seen = new Set<string>();
  const ipv4: string[] = [];
  const other: string[] = [];
  for (const entry of results) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    if (entry.family === 4) {
      ipv4.push(entry.address);
    } else {
      other.push(entry.address);
    }
  }
  return [...ipv4, ...other];
}

export async function resolvePinnedHostnameWithPolicy(
  hostname: string,
  params: { lookupFn?: LookupFn; policy?: SsrFPolicy } = {},
): Promise<PinnedHostname> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) throw new Error("Invalid hostname");

  const policy = params.policy;
  const skipChecks =
    isPrivateNetworkAllowedByPolicy(policy) ||
    normalizeHostnameSet(policy?.allowedHostnames).has(normalized);

  if (!matchesHostnameAllowlist(normalized, normalizeHostnameAllowlist(policy?.hostnameAllowlist))) {
    throw new SsrFBlockedError(`Blocked hostname (not in allowlist): ${hostname}`);
  }

  if (!skipChecks) {
    if (isBlockedHostname(normalized) || isPrivateIpAddress(normalized, policy)) {
      throw new SsrFBlockedError("Blocked hostname or private/internal IP address");
    }
  }

  const lookupFn = params.lookupFn ?? dnsLookup;
  const results = await lookupFn(normalized, { all: true });
  if (results.length === 0) throw new Error(`Unable to resolve hostname: ${hostname}`);

  if (!skipChecks) {
    for (const entry of results) {
      if (isPrivateIpAddress(entry.address, policy)) {
        throw new SsrFBlockedError("Blocked: resolves to private/internal IP address");
      }
    }
  }

  const addresses = dedupeAndPreferIpv4(results);
  return {
    hostname: normalized,
    addresses,
    lookup: createPinnedLookup({ hostname: normalized, addresses }),
  };
}

export function createPinnedDispatcher(pinned: PinnedHostname): Dispatcher {
  return new Agent({
    connect: {
      lookup: pinned.lookup,
    },
  });
}

export async function closeDispatcher(dispatcher?: Dispatcher | null): Promise<void> {
  if (!dispatcher) return;
  try {
    if (typeof (dispatcher as any).close === "function") {
      await (dispatcher as any).close();
    } else if (typeof (dispatcher as any).destroy === "function") {
      (dispatcher as any).destroy();
    }
  } catch {
    // ignore
  }
}

export async function assertPublicHostname(
  hostname: string,
  lookupFn: LookupFn = dnsLookup,
): Promise<void> {
  await resolvePinnedHostnameWithPolicy(hostname, { lookupFn });
}

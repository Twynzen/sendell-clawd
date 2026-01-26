import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".sendell"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", SENDELL_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".sendell-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", SENDELL_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".sendell"));
  });

  it("uses SENDELL_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", SENDELL_STATE_DIR: "/var/lib/sendell" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/sendell"));
  });

  it("expands ~ in SENDELL_STATE_DIR", () => {
    const env = { HOME: "/Users/test", SENDELL_STATE_DIR: "~/sendell-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/sendell-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { SENDELL_STATE_DIR: "C:\\State\\sendell" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\sendell");
  });
});

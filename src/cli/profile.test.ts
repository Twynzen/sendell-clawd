import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "sendell",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "sendell", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "sendell", "--dev", "gateway"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "sendell", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "sendell", "--profile", "work", "status"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "sendell", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "sendell", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "sendell", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "sendell", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".sendell-dev");
    expect(env.SENDELL_PROFILE).toBe("dev");
    expect(env.SENDELL_STATE_DIR).toBe(expectedStateDir);
    expect(env.SENDELL_CONFIG_PATH).toBe(path.join(expectedStateDir, "sendell.json"));
    expect(env.SENDELL_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      SENDELL_STATE_DIR: "/custom",
      SENDELL_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.SENDELL_STATE_DIR).toBe("/custom");
    expect(env.SENDELL_GATEWAY_PORT).toBe("19099");
    expect(env.SENDELL_CONFIG_PATH).toBe(path.join("/custom", "sendell.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("sendell doctor --fix", {})).toBe("sendell doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("sendell doctor --fix", { SENDELL_PROFILE: "default" })).toBe(
      "sendell doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("sendell doctor --fix", { SENDELL_PROFILE: "Default" })).toBe(
      "sendell doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("sendell doctor --fix", { SENDELL_PROFILE: "bad profile" })).toBe(
      "sendell doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("sendell --profile work doctor --fix", { SENDELL_PROFILE: "work" }),
    ).toBe("sendell --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("sendell --dev doctor", { SENDELL_PROFILE: "dev" })).toBe(
      "sendell --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("sendell doctor --fix", { SENDELL_PROFILE: "work" })).toBe(
      "sendell --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("sendell doctor --fix", { SENDELL_PROFILE: "  jbclawd  " })).toBe(
      "sendell --profile jbclawd doctor --fix",
    );
  });

  it("handles command with no args after sendell", () => {
    expect(formatCliCommand("sendell", { SENDELL_PROFILE: "test" })).toBe("sendell --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm sendell doctor", { SENDELL_PROFILE: "work" })).toBe(
      "pnpm sendell --profile work doctor",
    );
  });
});

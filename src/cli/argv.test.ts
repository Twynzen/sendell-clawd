import { describe, expect, it } from "vitest";

import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "sendell", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "sendell", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "sendell", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "sendell", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "sendell", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "sendell", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "sendell", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "sendell"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "sendell", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "sendell", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "sendell", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "sendell", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "sendell", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "sendell", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "sendell", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "sendell", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "sendell", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "sendell", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "sendell", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "sendell", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "sendell", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "sendell", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "sendell",
      rawArgs: ["node", "sendell", "status"],
    });
    expect(nodeArgv).toEqual(["node", "sendell", "status"]);

    const directArgv = buildParseArgv({
      programName: "sendell",
      rawArgs: ["sendell", "status"],
    });
    expect(directArgv).toEqual(["node", "sendell", "status"]);

    const bunArgv = buildParseArgv({
      programName: "sendell",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "sendell",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "sendell", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "sendell", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "sendell", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "sendell", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "sendell", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "sendell", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "sendell", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "sendell", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});

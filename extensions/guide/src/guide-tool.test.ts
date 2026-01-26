import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { SendellPluginApi, SendellPluginToolContext } from "../../../src/plugins/types.js";
import { createGuideTool } from "./guide-tool.js";

async function writeFakeGuideScript(scriptBody: string, prefix = "sendell-guide-plugin-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const isWindows = process.platform === "win32";

  if (isWindows) {
    const scriptPath = path.join(dir, "guide.js");
    const cmdPath = path.join(dir, "guide.cmd");
    await fs.writeFile(scriptPath, scriptBody, { encoding: "utf8" });
    const cmd = `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`;
    await fs.writeFile(cmdPath, cmd, { encoding: "utf8" });
    return { dir, binPath: cmdPath };
  }

  const binPath = path.join(dir, "guide");
  const file = `#!/usr/bin/env node\n${scriptBody}\n`;
  await fs.writeFile(binPath, file, { encoding: "utf8", mode: 0o755 });
  return { dir, binPath };
}

async function writeFakeGuide(params: { payload: unknown }) {
  const scriptBody =
    `const payload = ${JSON.stringify(params.payload)};\n` +
    `process.stdout.write(JSON.stringify(payload));\n`;
  return await writeFakeGuideScript(scriptBody);
}

function fakeApi(): SendellPluginApi {
  return {
    id: "guide",
    name: "guide",
    source: "test",
    config: {} as any,
    runtime: { version: "test" } as any,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerTool() {},
    registerHttpHandler() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerProvider() {},
    resolvePath: (p) => p,
  };
}

function fakeCtx(overrides: Partial<SendellPluginToolContext> = {}): SendellPluginToolContext {
  return {
    config: {} as any,
    workspaceDir: "/tmp",
    agentDir: "/tmp",
    agentId: "main",
    sessionKey: "main",
    messageChannel: undefined,
    agentAccountId: undefined,
    sandboxed: false,
    ...overrides,
  };
}

describe("guide plugin tool", () => {
  it("runs guide and returns parsed envelope in details", async () => {
    const fake = await writeFakeGuide({
      payload: { ok: true, status: "ok", output: [{ hello: "world" }], requiresApproval: null },
    });

    const tool = createGuideTool(fakeApi());
    const res = await tool.execute("call1", {
      action: "run",
      pipeline: "noop",
      guidePath: fake.binPath,
      timeoutMs: 1000,
    });

    expect(res.details).toMatchObject({ ok: true, status: "ok" });
  });

  it("requires absolute guidePath when provided", async () => {
    const tool = createGuideTool(fakeApi());
    await expect(
      tool.execute("call2", {
        action: "run",
        pipeline: "noop",
        guidePath: "./guide",
      }),
    ).rejects.toThrow(/absolute path/);
  });

  it("rejects invalid JSON from guide", async () => {
    const { binPath } = await writeFakeGuideScript(
      `process.stdout.write("nope");\n`,
      "sendell-guide-plugin-bad-",
    );

    const tool = createGuideTool(fakeApi());
    await expect(
      tool.execute("call3", {
        action: "run",
        pipeline: "noop",
        guidePath: binPath,
      }),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("can be gated off in sandboxed contexts", async () => {
    const api = fakeApi();
    const factoryTool = (ctx: SendellPluginToolContext) => {
      if (ctx.sandboxed) return null;
      return createGuideTool(api);
    };

    expect(factoryTool(fakeCtx({ sandboxed: true }))).toBeNull();
    expect(factoryTool(fakeCtx({ sandboxed: false }))?.name).toBe("guide");
  });
});

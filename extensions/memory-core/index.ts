import type { SendellPluginApi } from "sendell/plugin-sdk";
import { emptyPluginConfigSchema } from "sendell/plugin-sdk";

const memoryCorePlugin = {
  id: "memory-core",
  name: "Memory (Core)",
  description: "File-backed memory search tools and CLI",
  kind: "memory",
  configSchema: emptyPluginConfigSchema(),
  register(api: SendellPluginApi) {
    api.registerTool(
      (ctx) => {
        const memorySearchTool = api.runtime.tools.createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const memoryGetTool = api.runtime.tools.createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const memorySaveTool = api.runtime.tools.createMemorySaveTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const memorySnapshotTool = api.runtime.tools.createMemorySnapshotTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        if (!memorySearchTool || !memoryGetTool) return null;
        const tools = [memorySearchTool, memoryGetTool];
        if (memorySaveTool) tools.push(memorySaveTool);
        if (memorySnapshotTool) tools.push(memorySnapshotTool);
        return tools;
      },
      { names: ["memory_search", "memory_get", "memory_save", "memory_snapshot"] },
    );

    api.registerCli(
      ({ program }) => {
        api.runtime.tools.registerMemoryCli(program);
      },
      { commands: ["memory"] },
    );
  },
};

export default memoryCorePlugin;

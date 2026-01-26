import type { SendellPluginApi } from "../../src/plugins/types.js";

import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: SendellPluginApi) {
  api.registerTool(createLlmTaskTool(api), { optional: true });
}

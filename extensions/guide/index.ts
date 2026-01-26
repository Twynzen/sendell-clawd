import type { SendellPluginApi } from "../../src/plugins/types.js";

import { createGuideTool } from "./src/guide-tool.js";

export default function register(api: SendellPluginApi) {
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) return null;
      return createGuideTool(api);
    },
    { optional: true },
  );
}

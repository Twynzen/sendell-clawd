import path from "node:path";
import fsp from "node:fs/promises";
import fs from "node:fs";
import { assertSandboxPath } from "./src/agents/sandbox-paths.js";

async function runTests() {
  const rootDir = path.resolve("./test-sandbox-root");
  
  // Setup
  if (!fs.existsSync(rootDir)) await fsp.mkdir(rootDir);
  
  console.log("--- Starting Sandbox Path Tests ---");
  
  // 1. Valid path
  try {
    const res = await assertSandboxPath({ filePath: "valid.txt", cwd: rootDir, root: rootDir });
    console.log("Test 1 (Valid): PASS - Resolved: " + res.resolved);
  } catch (e) {
    console.error("Test 1 (Valid): FAIL - " + e.message);
  }
  
  // 2. Escape path
  try {
    await assertSandboxPath({ filePath: "../outside.txt", cwd: rootDir, root: rootDir });
    console.error("Test 2 (Escape): FAIL - Should have blocked access");
  } catch (e) {
    console.log("Test 2 (Escape): PASS - Correctly blocked: " + e.message);
  }

  // Cleanup
  await fsp.rm(rootDir, { recursive: true, force: true });
  
  console.log("--- Tests Completed ---");
}

runTests().catch((e) => {
    console.error("Global Catch: " + e.message);
});

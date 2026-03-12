import path from "node:path";
import fsp from "node:fs/promises";
import fs from "node:fs";
import { readFileWithinRoot } from "./src/infra/fs-safe.js";

async function runTests() {
  const rootDir = path.resolve("./test-workspace");
  const outsideFile = path.resolve("./outside-file.txt");
  
  // Setup
  if (!fs.existsSync(rootDir)) await fsp.mkdir(rootDir);
  await fsp.writeFile(outsideFile, "Sensitive data");
  await fsp.writeFile(path.join(rootDir, "inside.txt"), "Safe data");
  
  console.log("--- Starting Boundary Tests ---");
  
  // 1. Valid read
  try {
    const res = await readFileWithinRoot({ rootDir, relativePath: "inside.txt" });
    console.log("Test 1 (Inside): PASS - Read content: " + res.buffer.toString());
  } catch (e) {
    console.error("Test 1 (Inside): FAIL - " + e.message);
  }
  
  // 2. Outside read
  try {
    await readFileWithinRoot({ rootDir, relativePath: "../outside-file.txt" });
    console.error("Test 2 (Outside): FAIL - Should have blocked access");
  } catch (e) {
    console.log("Test 2 (Outside): PASS - Correctly blocked: " + e.message);
  }
  
  // 3. Symlink escape
  const symlinkPath = path.join(rootDir, "link-escape");
  if (fs.existsSync(symlinkPath)) await fsp.unlink(symlinkPath);
  try {
    // Note: On Windows, symlink creation might require admin privileges or Developer Mode.
    // If it fails, we'll skip this specific test.
    await fsp.symlink(outsideFile, symlinkPath);
    await readFileWithinRoot({ rootDir, relativePath: "link-escape" });
    console.error("Test 3 (Symlink Escape): FAIL - Should have blocked access");
  } catch (e) {
    console.log("Test 3 (Symlink Escape): PASS - Correctly blocked: " + e.message);
  }

  // Cleanup
  await fsp.rm(rootDir, { recursive: true, force: true });
  await fsp.rm(outsideFile, { force: true });
  
  console.log("--- Tests Completed ---");
}

runTests().catch((e) => {
    console.error("Global Catch: " + e.message);
    if (e.cause) console.error("Cause: ", e.cause);
});

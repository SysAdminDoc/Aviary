import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFile = path.join(root, "tests", "visual", "settings-visual-regression.test.mjs");
const child = spawn(process.execPath, ["--test", testFile], {
  cwd: root,
  env: { ...process.env, AVIARY_UPDATE_VISUALS: "1" },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`visual baseline update stopped by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
